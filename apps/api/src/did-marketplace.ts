import type { FastifyBaseLogger } from "fastify";
import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { applyPbxConfiguration, serializedPbxMutation } from "./pbx.js";

const RENEWAL_INTERVAL_MS = 15 * 60_000;
let didConfigurationRetryPending = false;

export interface DidInventoryBody {
  didNumber?: string;
  trunkId?: string;
  countryCode?: string;
  region?: string;
  locality?: string;
  currency?: string;
  setupPrice?: number;
  monthlyPrice?: number;
  enabled?: boolean;
}

export interface DidInventoryValues {
  didNumber: string;
  trunkId: string;
  countryCode: string;
  region: string;
  locality: string;
  currency: string;
  setupPrice: number;
  monthlyPrice: number;
  enabled: boolean;
}

export interface DidPurchaseResult {
  purchaseId: string;
  inventoryId: string;
  didRouteId: string;
  didNumber: string;
  destinationExtension: string;
  currency: string;
  chargedAmount: number;
  balance: number;
  nextRenewalAt: Date;
}

interface CommittedPurchase extends DidPurchaseResult {
  customerId: string;
}

export class DidMarketplaceError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
  }
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeLabel(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > 100 || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new DidMarketplaceError(`Enter a valid ${label}`);
  }
  return text;
}

function price(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new DidMarketplaceError(`Enter a valid ${label}`);
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function didInventoryValues(body: DidInventoryBody): DidInventoryValues {
  const didNumber = typeof body.didNumber === "string"
    ? body.didNumber.trim().replace(/[\s().-]/g, "")
    : "";
  const trunkId = body.trunkId?.trim() ?? "";
  const countryCode = body.countryCode?.trim().toUpperCase() ?? "";
  const currency = body.currency?.trim().toUpperCase() ?? "";
  const enabled = body.enabled ?? true;
  if (!/^\+?[0-9]{3,20}$/.test(didNumber)) {
    throw new DidMarketplaceError("Enter a valid inbound telephone number");
  }
  if (!validUuid(trunkId)) throw new DidMarketplaceError("Choose a valid SIP trunk");
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new DidMarketplaceError("Country must use a two-letter code such as ZA or GB");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new DidMarketplaceError("Currency must use a three-letter code such as ZAR or USD");
  }
  if (typeof enabled !== "boolean") throw new DidMarketplaceError("Invalid stock status");
  const setupPrice = price(body.setupPrice, "setup price");
  const monthlyPrice = price(body.monthlyPrice, "monthly price");
  if (purchaseTotal(setupPrice, monthlyPrice) > 1_000_000) {
    throw new DidMarketplaceError("Setup and first-month charges cannot exceed 1,000,000 in total");
  }
  return {
    didNumber,
    trunkId,
    countryCode,
    region: safeLabel(body.region, "region"),
    locality: safeLabel(body.locality, "locality"),
    currency,
    setupPrice,
    monthlyPrice,
    enabled,
  };
}

export function purchaseTotal(setupPrice: number, monthlyPrice: number): number {
  return Math.round((setupPrice + monthlyPrice) * 1_000_000) / 1_000_000;
}

export function balanceAfterPurchase(
  balance: number,
  total: number,
  billingMode: "prepaid" | "postpaid",
  creditLimit: number,
): number {
  const next = Math.round((balance - total) * 1_000_000) / 1_000_000;
  const minimum = billingMode === "prepaid" ? 0 : -creditLimit;
  if (next < minimum) {
    throw new DidMarketplaceError(
      billingMode === "prepaid"
        ? "Your prepaid wallet does not have enough funds for this number"
        : "This purchase would exceed your postpaid credit limit",
      409,
    );
  }
  return next;
}

function databaseCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null
    ? (error as { code?: string }).code
    : undefined;
}

async function insertWalletCharge(
  client: PoolClient,
  customerId: string,
  currency: string,
  amount: number,
  balance: number,
  note: string,
  createdBy: string | null,
): Promise<string | null> {
  if (amount === 0) return null;
  const result = await client.query<{ id: string }>(
    `INSERT INTO customer_wallet_transactions
       (customer_id, transaction_type, currency, amount, balance_after, note, created_by)
     VALUES ($1,'charge',$2,$3,$4,$5,$6)
     RETURNING id::text`,
    [customerId, currency, -amount, balance, note, createdBy],
  );
  return result.rows[0]?.id ?? null;
}

async function commitPurchase(
  actorUserId: string,
  customerId: string,
  inventoryId: string,
  extensionId: string,
): Promise<CommittedPurchase> {
  if (!validUuid(inventoryId)) throw new DidMarketplaceError("Number not found", 404);
  if (!validUuid(extensionId)) throw new DidMarketplaceError("Choose a valid destination extension");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [`reseller:${customerId}`],
    );
    const inventoryResult = await client.query<{
      id: string; did_number: string; trunk_id: string; currency: string;
      setup_price: string; monthly_price: string; status: string; trunk_enabled: boolean;
    }>(
      `SELECT inventory.id, inventory.did_number, inventory.trunk_id,
              inventory.currency, inventory.setup_price::text,
              inventory.monthly_price::text, inventory.status,
              trunks.enabled AS trunk_enabled
         FROM did_inventory AS inventory
         JOIN sip_trunks AS trunks ON trunks.id=inventory.trunk_id
        WHERE inventory.id=$1
          AND NOT EXISTS (
            SELECT 1 FROM did_routes WHERE did_number=inventory.did_number
          )
        FOR UPDATE OF inventory`,
      [inventoryId],
    );
    const inventory = inventoryResult.rows[0];
    if (!inventory || inventory.status !== "available") {
      throw new DidMarketplaceError("That number is no longer available", 409);
    }
    if (!inventory.trunk_enabled) {
      throw new DidMarketplaceError("That number's provider trunk is currently disabled", 409);
    }

    const customerResult = await client.query<{
      id: string; currency: string; billing_mode: "prepaid" | "postpaid";
      credit_limit: string; active: boolean; parent_active: boolean;
      balance: string; plan_enabled: boolean | null; max_dids: number | null;
      delegated_dids: string;
    }>(
      `SELECT customers.id, customers.currency, customers.billing_mode,
              customers.credit_limit::text, customers.active,
              COALESCE(parent.active, true) AS parent_active,
              wallets.balance::text, plans.enabled AS plan_enabled, plans.max_dids,
              (SELECT COALESCE(sum(child_plans.max_dids),0)::text
                 FROM customers AS child_accounts
                 JOIN customer_service_plans AS child_plans
                   ON child_plans.id=child_accounts.service_plan_id
                WHERE child_accounts.parent_customer_id=customers.id
              ) AS delegated_dids
         FROM customers
         JOIN customer_wallets AS wallets ON wallets.customer_id=customers.id
         LEFT JOIN customers AS parent ON parent.id=customers.parent_customer_id
         LEFT JOIN customer_service_plans AS plans ON plans.id=customers.service_plan_id
        WHERE customers.id=$1
        FOR UPDATE OF wallets`,
      [customerId],
    );
    const customer = customerResult.rows[0];
    if (!customer) throw new DidMarketplaceError("Customer account not found", 404);
    if (!customer.active || !customer.parent_active) {
      throw new DidMarketplaceError("This customer account is disabled", 403);
    }
    if (!customer.plan_enabled || customer.max_dids === null) {
      throw new DidMarketplaceError("An active service plan is required to purchase numbers", 409);
    }
    if (customer.currency !== inventory.currency) {
      throw new DidMarketplaceError("This number is sold in a different account currency", 409);
    }
    const assignedCount = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM customer_did_routes WHERE customer_id=$1",
      [customerId],
    );
    if (
      Number(assignedCount.rows[0]?.count ?? 0) + Number(customer.delegated_dids)
      >= customer.max_dids
    ) {
      throw new DidMarketplaceError("Your service plan's DID allowance is fully used or delegated", 409);
    }
    const extensionResult = await client.query<{ extension_number: string }>(
      `SELECT extensions.extension_number
         FROM customer_extensions
         JOIN extensions ON extensions.id=customer_extensions.extension_id
        WHERE customer_extensions.customer_id=$1
          AND customer_extensions.extension_id=$2
          AND extensions.enabled=true`,
      [customerId, extensionId],
    );
    const extension = extensionResult.rows[0];
    if (!extension) {
      throw new DidMarketplaceError("Choose one of your enabled extensions as the destination", 409);
    }

    const setupAmount = Number(inventory.setup_price);
    const monthlyAmount = Number(inventory.monthly_price);
    const total = purchaseTotal(setupAmount, monthlyAmount);
    const balance = balanceAfterPurchase(
      Number(customer.balance), total, customer.billing_mode, Number(customer.credit_limit),
    );
    const routeResult = await client.query<{ id: string }>(
      `INSERT INTO did_routes
         (did_number, trunk_id, destination_type, extension_id, ivr_menu_id, enabled)
       VALUES ($1,$2,'extension',$3,NULL,true)
       RETURNING id`,
      [inventory.did_number, inventory.trunk_id, extensionId],
    );
    const routeId = routeResult.rows[0]?.id;
    if (!routeId) throw new Error("DID route creation returned no id");
    await client.query(
      `INSERT INTO customer_did_routes(customer_id, did_route_id, assigned_by)
       VALUES ($1,$2,$3)`,
      [customerId, routeId, actorUserId],
    );
    if (total > 0) {
      await client.query(
        "UPDATE customer_wallets SET balance=$2, updated_at=now() WHERE customer_id=$1",
        [customerId, balance],
      );
    }
    const walletTransactionId = await insertWalletCharge(
      client, customerId, customer.currency, total, balance,
      `DID ${inventory.did_number} setup and first month`, actorUserId,
    );
    const purchaseResult = await client.query<{
      id: string; purchased_at: Date; next_renewal_at: Date;
    }>(
      `INSERT INTO did_purchases
         (inventory_id, customer_id, did_route_id, currency, billing_mode,
          setup_amount, monthly_amount, initial_total, status,
          next_renewal_at, purchased_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',now() + interval '1 month',$9)
       RETURNING id, purchased_at, next_renewal_at`,
      [inventory.id, customerId, routeId, customer.currency, customer.billing_mode,
        setupAmount, monthlyAmount, total, actorUserId],
    );
    const purchase = purchaseResult.rows[0];
    if (!purchase) throw new Error("DID purchase creation returned no id");
    await client.query(
      `INSERT INTO did_purchase_charges
         (purchase_id, wallet_transaction_id, charge_type, currency, amount,
          period_start, period_end)
       VALUES ($1,$2,'initial',$3,$4,$5,$6)`,
      [purchase.id, walletTransactionId, customer.currency, total,
        purchase.purchased_at, purchase.next_renewal_at],
    );
    await client.query(
      `UPDATE did_inventory
          SET status='assigned', customer_id=$2, did_route_id=$3,
              assigned_at=now(), updated_at=now()
        WHERE id=$1`,
      [inventory.id, customerId, routeId],
    );
    await client.query("COMMIT");
    return {
      purchaseId: purchase.id,
      inventoryId: inventory.id,
      didRouteId: routeId,
      didNumber: inventory.did_number,
      destinationExtension: extension.extension_number,
      currency: customer.currency,
      chargedAmount: total,
      balance,
      nextRenewalAt: purchase.next_renewal_at,
      customerId,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof DidMarketplaceError) throw error;
    if (databaseCode(error) === "23505") {
      throw new DidMarketplaceError("That number was purchased or provisioned by another account", 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function reverseFailedProvisioning(purchase: CommittedPurchase): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<{ status: string }>(
      "SELECT status FROM did_purchases WHERE id=$1 FOR UPDATE",
      [purchase.purchaseId],
    );
    if (locked.rows[0]?.status !== "active") {
      await client.query("ROLLBACK");
      return;
    }
    const wallet = await client.query<{ balance: string }>(
      "SELECT balance::text FROM customer_wallets WHERE customer_id=$1 FOR UPDATE",
      [purchase.customerId],
    );
    const currentBalance = Number(wallet.rows[0]?.balance ?? purchase.balance);
    const refundedBalance = Math.round((currentBalance + purchase.chargedAmount) * 1_000_000) / 1_000_000;
    await client.query(
      `UPDATE did_inventory
          SET status='available', customer_id=NULL, did_route_id=NULL,
              assigned_at=NULL, updated_at=now()
        WHERE id=$1 AND customer_id=$2`,
      [purchase.inventoryId, purchase.customerId],
    );
    await client.query(
      `UPDATE did_purchases
          SET status='failed', did_route_id=NULL,
              failure_reason='Asterisk provisioning failed', updated_at=now()
        WHERE id=$1`,
      [purchase.purchaseId],
    );
    await client.query(
      "DELETE FROM customer_did_routes WHERE customer_id=$1 AND did_route_id=$2",
      [purchase.customerId, purchase.didRouteId],
    );
    await client.query("DELETE FROM did_routes WHERE id=$1", [purchase.didRouteId]);
    if (purchase.chargedAmount > 0) {
      await client.query(
        "UPDATE customer_wallets SET balance=$2, updated_at=now() WHERE customer_id=$1",
        [purchase.customerId, refundedBalance],
      );
      await client.query(
        `INSERT INTO customer_wallet_transactions
           (customer_id, transaction_type, currency, amount, balance_after, note)
         VALUES ($1,'refund',$2,$3,$4,$5)`,
        [purchase.customerId, purchase.currency, purchase.chargedAmount,
          refundedBalance, `Refund for DID ${purchase.didNumber} provisioning failure`],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function purchaseDid(
  actorUserId: string,
  customerId: string,
  inventoryId: string,
  extensionId: string,
): Promise<DidPurchaseResult> {
  return serializedPbxMutation(async () => {
    const purchase = await commitPurchase(actorUserId, customerId, inventoryId, extensionId);
    try {
      await applyPbxConfiguration();
      return purchase;
    } catch (error) {
      await reverseFailedProvisioning(purchase);
      await applyPbxConfiguration().catch(() => undefined);
      throw new DidMarketplaceError(
        "The number could not be activated. The charge was automatically refunded.",
        502,
      );
    }
  });
}

async function renewPurchase(purchaseId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      id: string; customer_id: string; currency: string; monthly_amount: string;
      next_renewal_at: Date; did_route_id: string | null; did_number: string;
      billing_mode: "prepaid" | "postpaid"; credit_limit: string;
      balance: string; customer_active: boolean; parent_active: boolean;
      route_enabled: boolean | null;
    }>(
      `SELECT purchases.id, purchases.customer_id, purchases.currency,
              purchases.monthly_amount::text, purchases.next_renewal_at,
              purchases.did_route_id, inventory.did_number,
              customers.billing_mode, customers.credit_limit::text,
              wallets.balance::text, customers.active AS customer_active,
              COALESCE(parent.active, true) AS parent_active,
              routes.enabled AS route_enabled
         FROM did_purchases AS purchases
         JOIN did_inventory AS inventory ON inventory.id=purchases.inventory_id
         JOIN customers ON customers.id=purchases.customer_id
         LEFT JOIN customers AS parent ON parent.id=customers.parent_customer_id
         JOIN customer_wallets AS wallets ON wallets.customer_id=customers.id
         LEFT JOIN did_routes AS routes ON routes.id=purchases.did_route_id
        WHERE purchases.id=$1
          AND purchases.status IN ('active','past_due')
          AND purchases.next_renewal_at <= now()
        FOR UPDATE OF purchases, wallets`,
      [purchaseId],
    );
    const purchase = result.rows[0];
    if (!purchase || !purchase.did_route_id) {
      await client.query("ROLLBACK");
      return false;
    }
    const monthly = Number(purchase.monthly_amount);
    let nextBalance: number;
    try {
      if (!purchase.customer_active || !purchase.parent_active) {
        throw new DidMarketplaceError("Customer account is disabled", 409);
      }
      nextBalance = balanceAfterPurchase(
        Number(purchase.balance), monthly, purchase.billing_mode, Number(purchase.credit_limit),
      );
    } catch (error) {
      await client.query(
        `UPDATE did_purchases SET status='past_due', failure_reason=$2, updated_at=now()
          WHERE id=$1`,
        [purchase.id, error instanceof Error ? error.message.slice(0, 200) : "Renewal payment failed"],
      );
      await client.query("UPDATE did_routes SET enabled=false, updated_at=now() WHERE id=$1", [purchase.did_route_id]);
      await client.query("COMMIT");
      return purchase.route_enabled === true;
    }
    if (monthly > 0) {
      await client.query(
        "UPDATE customer_wallets SET balance=$2, updated_at=now() WHERE customer_id=$1",
        [purchase.customer_id, nextBalance],
      );
    }
    const walletTransactionId = await insertWalletCharge(
      client, purchase.customer_id, purchase.currency, monthly, nextBalance,
      `DID ${purchase.did_number} monthly renewal`, null,
    );
    const renewed = await client.query<{ next_renewal_at: Date }>(
      `UPDATE did_purchases
          SET status='active', failure_reason=NULL,
              next_renewal_at=next_renewal_at + interval '1 month', updated_at=now()
        WHERE id=$1
        RETURNING next_renewal_at`,
      [purchase.id],
    );
    const nextRenewal = renewed.rows[0]?.next_renewal_at;
    if (!nextRenewal) throw new Error("DID renewal returned no next date");
    await client.query(
      `INSERT INTO did_purchase_charges
         (purchase_id, wallet_transaction_id, charge_type, currency, amount,
          period_start, period_end)
       VALUES ($1,$2,'renewal',$3,$4,$5,$6)`,
      [purchase.id, walletTransactionId, purchase.currency, monthly,
        purchase.next_renewal_at, nextRenewal],
    );
    await client.query("UPDATE did_routes SET enabled=true, updated_at=now() WHERE id=$1", [purchase.did_route_id]);
    await client.query("COMMIT");
    return purchase.route_enabled !== true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function processDueDidRenewals(limit = 25): Promise<{
  scanned: number; renewed: number; configurationChanged: boolean;
}> {
  const due = await pool.query<{ id: string }>(
    `SELECT id FROM did_purchases
      WHERE status IN ('active','past_due') AND next_renewal_at <= now()
      ORDER BY next_renewal_at, id
      LIMIT $1`,
    [Math.max(1, Math.min(100, limit))],
  );
  let renewed = 0;
  let configurationChanged = false;
  for (const row of due.rows) {
    const changed = await renewPurchase(row.id);
    configurationChanged ||= changed;
    renewed += 1;
  }
  if (configurationChanged) didConfigurationRetryPending = true;
  if (didConfigurationRetryPending) {
    await serializedPbxMutation(() => applyPbxConfiguration());
    didConfigurationRetryPending = false;
  }
  return { scanned: due.rows.length, renewed, configurationChanged };
}

export function startDidRenewalWorker(logger: FastifyBaseLogger): NodeJS.Timeout {
  const run = () => {
    void processDueDidRenewals().then((result) => {
      if (result.scanned > 0) logger.info(result, "Processed DID subscription renewals");
    }).catch((error) => logger.warn({ error }, "DID subscription renewal failed"));
  };
  run();
  return setInterval(run, RENEWAL_INTERVAL_MS);
}

export function stopDidRenewalWorker(timer: NodeJS.Timeout | undefined): void {
  if (timer) clearInterval(timer);
}
