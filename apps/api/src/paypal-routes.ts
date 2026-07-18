import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { requireCustomer } from "./auth.js";
import { audit, pool } from "./database.js";
import {
  PayPalGatewayError,
  capturePayPalOrder,
  createPayPalOrder,
  paypalAvailability,
  paypalCurrencyDecimals,
  topupAmount,
  verifiedPayPalCapture,
} from "./paypal.js";
import { configuredPayPalSettings } from "./paypal-settings.js";

interface TopupBody { amount?: unknown }
interface CheckoutParams { checkoutId: string }

interface CustomerAccountRow {
  id: string;
  account_number: string;
  currency: string;
  billing_mode: "prepaid" | "postpaid";
  active: boolean;
  parent_active: boolean;
  balance: string;
}

interface CheckoutRow {
  id: string;
  customer_id: string;
  provider_order_id: string;
  capture_request_id: string;
  payment_capture_id: string | null;
  wallet_transaction_id: string | null;
  currency: string;
  amount: string;
  status: "created" | "capturing" | "captured" | "failed" | "cancelled";
  captured_at: Date | null;
  updated_at: Date;
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function paymentFailure(error: unknown): { message: string; statusCode: number } {
  if (error instanceof PayPalGatewayError) {
    if (
      error.statusCode === 400
      || error.statusCode === 403
      || error.statusCode === 404
      || error.statusCode === 409
    ) {
      return { message: error.message, statusCode: error.statusCode };
    }
  }
  return {
    message: "PayPal could not confirm this payment. You can retry the confirmation shortly.",
    statusCode: 502,
  };
}

async function customerAccount(customerId: string): Promise<CustomerAccountRow | undefined> {
  const result = await pool.query<CustomerAccountRow>(
    `SELECT customers.id, customers.account_number::text, customers.currency,
            customers.billing_mode, customers.active,
            COALESCE(parent_customer.active, true) AS parent_active,
            wallets.balance::text
       FROM customers
       JOIN customer_wallets AS wallets ON wallets.customer_id=customers.id
       LEFT JOIN customers AS parent_customer
         ON parent_customer.id=customers.parent_customer_id
      WHERE customers.id=$1`,
    [customerId],
  );
  return result.rows[0];
}

function accountAvailability(
  account: CustomerAccountRow,
  settings: Awaited<ReturnType<typeof configuredPayPalSettings>>,
) {
  const availability = paypalAvailability(
    settings,
    account.currency,
    account.billing_mode,
  );
  if (!account.active || !account.parent_active) {
    return { ...availability, available: false, reason: "This customer account is disabled" };
  }
  return availability;
}

function checkoutAmount(row: CheckoutRow): string {
  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    throw new PayPalGatewayError("The saved wallet top-up is invalid");
  }
  return amount.toFixed(paypalCurrencyDecimals(row.currency));
}

async function reserveCapture(
  checkoutId: string,
  customerId: string,
): Promise<CheckoutRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<CheckoutRow>(
      `SELECT id, customer_id, provider_order_id, capture_request_id,
              payment_capture_id, wallet_transaction_id, currency, amount::text,
              status, captured_at, updated_at
         FROM paypal_wallet_orders
        WHERE id=$1
        FOR UPDATE`,
      [checkoutId],
    );
    const row = result.rows[0];
    if (!row || row.customer_id !== customerId) {
      await client.query("ROLLBACK");
      throw new PayPalGatewayError("Payment checkout not found", 404);
    }
    if (row.status === "captured") {
      await client.query("COMMIT");
      return row;
    }
    if (
      row.status === "capturing"
      && row.updated_at.getTime() > Date.now() - 2 * 60_000
    ) {
      await client.query("ROLLBACK");
      throw new PayPalGatewayError("Your PayPal payment is still being confirmed", 409);
    }
    await client.query(
      `UPDATE paypal_wallet_orders
          SET status='capturing', failure_reason=NULL, updated_at=now()
        WHERE id=$1`,
      [checkoutId],
    );
    await client.query("COMMIT");
    return { ...row, status: "capturing", updated_at: new Date() };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function markCheckoutFailed(checkoutId: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE paypal_wallet_orders
        SET status='failed', failure_reason=$2, updated_at=now()
      WHERE id=$1 AND status <> 'captured'`,
    [checkoutId, reason.slice(0, 200)],
  );
}

async function creditCapturedCheckout(
  checkout: CheckoutRow,
  captureId: string,
): Promise<{ amount: number; balance: number; currency: string; alreadyCaptured: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query<CheckoutRow>(
      `SELECT id, customer_id, provider_order_id, capture_request_id,
              payment_capture_id, wallet_transaction_id, currency, amount::text,
              status, captured_at, updated_at
         FROM paypal_wallet_orders
        WHERE id=$1
        FOR UPDATE`,
      [checkout.id],
    );
    const order = orderResult.rows[0];
    if (!order) throw new PayPalGatewayError("Payment checkout not found", 404);
    if (order.status === "captured") {
      const wallet = await client.query<{ balance: string }>(
        "SELECT balance::text FROM customer_wallets WHERE customer_id=$1",
        [order.customer_id],
      );
      await client.query("COMMIT");
      return {
        amount: Number(order.amount),
        balance: Number(wallet.rows[0]?.balance ?? 0),
        currency: order.currency,
        alreadyCaptured: true,
      };
    }
    if (order.status !== "capturing") {
      throw new PayPalGatewayError("This PayPal checkout is not ready to be credited", 409);
    }
    const accountResult = await client.query<CustomerAccountRow>(
      `SELECT customers.id, customers.account_number::text, customers.currency,
              customers.billing_mode, customers.active,
              COALESCE(parent_customer.active, true) AS parent_active,
              wallets.balance::text
         FROM customers
         JOIN customer_wallets AS wallets ON wallets.customer_id=customers.id
         LEFT JOIN customers AS parent_customer
           ON parent_customer.id=customers.parent_customer_id
        WHERE customers.id=$1
        FOR UPDATE OF wallets`,
      [order.customer_id],
    );
    const account = accountResult.rows[0];
    if (!account) throw new PayPalGatewayError("Customer account not found", 404);
    if (account.currency !== order.currency || account.billing_mode !== "prepaid") {
      throw new PayPalGatewayError("This wallet can no longer receive this PayPal top-up", 409);
    }
    const amount = Number(order.amount);
    const balance = Math.round((Number(account.balance) + amount) * 1_000_000) / 1_000_000;
    const walletTransaction = await client.query<{ id: string }>(
      `INSERT INTO customer_wallet_transactions
         (customer_id, transaction_type, currency, amount, balance_after, note, created_by)
       VALUES ($1, 'topup', $2, $3, $4, $5, NULL)
       RETURNING id::text`,
      [
        account.id,
        account.currency,
        amount,
        balance,
        `PayPal wallet top-up · ${captureId}`,
      ],
    );
    const walletTransactionId = walletTransaction.rows[0]?.id;
    if (!walletTransactionId) throw new PayPalGatewayError("Wallet credit could not be recorded");
    await client.query(
      "UPDATE customer_wallets SET balance=$2, updated_at=now() WHERE customer_id=$1",
      [account.id, balance],
    );
    await client.query(
      `UPDATE paypal_wallet_orders
          SET status='captured', payment_capture_id=$2, wallet_transaction_id=$3,
              captured_at=now(), failure_reason=NULL, updated_at=now()
        WHERE id=$1`,
      [order.id, captureId, walletTransactionId],
    );
    await client.query("COMMIT");
    return { amount, balance, currency: account.currency, alreadyCaptured: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function registerPayPalRoutes(app: FastifyInstance): void {
  app.get("/api/customer/payments/paypal/config", async (request, reply) => {
    const user = await requireCustomer(request, reply);
    if (!user?.customerId) return;
    const account = await customerAccount(user.customerId);
    if (!account) return reply.code(404).send({ error: "Customer account not found" });
    const settings = await configuredPayPalSettings();
    const availability = accountAvailability(account, settings);
    return {
      available: availability.available,
      reason: availability.reason,
      mode: availability.mode,
      clientId: availability.available ? availability.clientId : null,
      currency: availability.currency,
      minimumTopup: availability.minimumTopup,
      maximumTopup: availability.maximumTopup,
    };
  });

  app.post<{ Body: TopupBody }>("/api/customer/payments/paypal/orders", async (request, reply) => {
    const user = await requireCustomer(request, reply);
    if (!user?.customerId) return;
    const account = await customerAccount(user.customerId);
    if (!account) return reply.code(404).send({ error: "Customer account not found" });
    const settings = await configuredPayPalSettings();
    const availability = accountAvailability(account, settings);
    if (!availability.available) {
      const statusCode = availability.reason.includes("configured") ? 503 : 409;
      return reply.code(statusCode).send({ error: availability.reason });
    }
    let amount;
    try {
      amount = topupAmount(
        request.body?.amount,
        account.currency,
        availability.minimumTopup,
        availability.maximumTopup,
      );
    } catch (error) {
      const failure = paymentFailure(error);
      return reply.code(failure.statusCode).send({ error: failure.message });
    }
    const checkoutId = randomUUID();
    const createRequestId = randomUUID();
    let providerOrderId: string;
    try {
      providerOrderId = await createPayPalOrder(
        settings,
        {
          checkoutId,
          requestId: createRequestId,
          amount,
          currency: account.currency,
          accountNumber: account.account_number,
        },
      );
    } catch (error) {
      request.log.warn({ error }, "PayPal order creation failed");
      const failure = paymentFailure(error);
      return reply.code(failure.statusCode).send({ error: failure.message });
    }
    try {
      await pool.query(
        `INSERT INTO paypal_wallet_orders
           (id, customer_id, initiated_by, provider_order_id, capture_request_id,
            currency, amount, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'created')`,
        [
          checkoutId,
          account.id,
          user.id,
          providerOrderId,
          randomUUID(),
          account.currency,
          amount.amount,
        ],
      );
    } catch (error) {
      request.log.error({ error }, "PayPal checkout could not be recorded");
      return reply.code(500).send({ error: "Payment checkout could not be prepared" });
    }
    await audit("customer.wallet.paypal.order_created", user.id, {
      customerId: account.id,
      checkoutId,
      amount: amount.amount,
      currency: account.currency,
      mode: settings.mode,
    }, request.ip).catch(() => undefined);
    return {
      checkoutId,
      orderId: providerOrderId,
      amount: amount.amount,
      currency: account.currency,
      mode: settings.mode,
    };
  });

  app.post<{ Params: CheckoutParams }>(
    "/api/customer/payments/paypal/orders/:checkoutId/capture",
    async (request, reply) => {
      const user = await requireCustomer(request, reply);
      if (!user?.customerId) return;
      if (!validUuid(request.params.checkoutId)) {
        return reply.code(404).send({ error: "Payment checkout not found" });
      }
      let checkout: CheckoutRow;
      try {
        checkout = await reserveCapture(request.params.checkoutId, user.customerId);
      } catch (error) {
        const failure = paymentFailure(error);
        return reply.code(failure.statusCode).send({ error: failure.message });
      }
      if (checkout.status === "captured") {
        return {
          ok: true,
          alreadyCaptured: true,
          amount: Number(checkout.amount),
          currency: checkout.currency,
        };
      }
      try {
        const settings = await configuredPayPalSettings();
        const availability = paypalAvailability(settings, checkout.currency, "prepaid");
        if (!availability.available) {
          await markCheckoutFailed(
            checkout.id,
            "PayPal checkout was unavailable during confirmation",
          ).catch(() => undefined);
          const statusCode = availability.reason.includes("configured") ? 503 : 409;
          return reply.code(statusCode).send({ error: availability.reason });
        }
        const capturePayload = await capturePayPalOrder(
          settings,
          checkout.provider_order_id,
          checkout.capture_request_id,
        );
        const capture = verifiedPayPalCapture(capturePayload, {
          amount: checkoutAmount(checkout),
          currency: checkout.currency,
        });
        const credited = await creditCapturedCheckout(checkout, capture.captureId);
        await audit("customer.wallet.paypal.captured", user.id, {
          customerId: user.customerId,
          checkoutId: checkout.id,
          captureId: capture.captureId,
          amount: credited.amount,
          currency: credited.currency,
          balance: credited.balance,
          alreadyCaptured: credited.alreadyCaptured,
        }, request.ip).catch(() => undefined);
        return { ok: true, ...credited };
      } catch (error) {
        request.log.warn({ error, checkoutId: checkout.id }, "PayPal capture failed");
        await markCheckoutFailed(
          checkout.id,
          "PayPal could not confirm this payment. Retry confirmation shortly.",
        ).catch(() => undefined);
        const failure = paymentFailure(error);
        return reply.code(failure.statusCode).send({ error: failure.message });
      }
    },
  );
}
