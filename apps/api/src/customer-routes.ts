import type { FastifyInstance } from "fastify";
import { hashPassword, requireAdministrator, requireCustomer } from "./auth.js";
import { callDirection, normalizeDisposition } from "./calls.js";
import {
  customerAccountLabel,
  customerValues,
  validCustomerEmail,
  walletAdjustment,
  type BillingMode,
  type CustomerAccountType,
  type CustomerValues,
} from "./customers.js";
import { audit, pool } from "./database.js";
import { customerExtensionRange } from "./customer-plans.js";
import { getExtensionRegistrationStatuses } from "./pbx.js";
import { validUuid } from "./queue-agent-state.js";
import { listInvoices } from "./invoices.js";
import { effectiveBrandingForCustomer } from "./branding-routes.js";

interface CustomerBody {
  name?: string;
  billingEmail?: string;
  currency?: string;
  accountType?: string;
  billingMode?: string;
  creditLimit?: number;
  active?: boolean;
  customerRateCardId?: string | null;
  servicePlanId?: string | null;
  extensionRangeStart?: number | string | null;
  extensionRangeEnd?: number | string | null;
  loginDisplayName?: string;
  loginEmail?: string;
  loginPassword?: string;
}

interface ServiceBody {
  extensionIds?: string[];
  didRouteIds?: string[];
}

interface WalletBody { amount?: number; note?: string }
interface PasswordBody { password?: string }
interface IdParams { id: string }

interface CustomerRow {
  id: string;
  account_number: string;
  name: string;
  billing_email: string;
  currency: string;
  account_type: CustomerAccountType;
  billing_mode: BillingMode;
  credit_limit: string;
  active: boolean;
  balance: string;
  extension_count: string;
  did_count: string;
  login_count: string;
  customer_rate_card_id: string | null;
  customer_rate_card_name: string | null;
  service_plan_id: string | null;
  service_plan_name: string | null;
  extension_range_start: number | null;
  extension_range_end: number | null;
  parent_customer_id: string | null;
  parent_customer_name: string | null;
  created_at: Date;
  updated_at: Date;
}

interface LoginRow {
  id: string;
  customer_id: string;
  email: string;
  display_name: string;
  active: boolean;
  created_at: Date;
}

function databaseCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null
    ? (error as { code?: string }).code
    : undefined;
}

function loginValues(body: CustomerBody) {
  const displayName = body.loginDisplayName?.trim() ?? "";
  const email = body.loginEmail?.trim().toLowerCase() ?? "";
  const password = body.loginPassword ?? "";
  if (displayName.length < 2 || displayName.length > 100) {
    throw new Error("Enter a valid customer login name");
  }
  if (!validCustomerEmail(email)) throw new Error("Enter a valid customer login email");
  if (password.length < 12) throw new Error("Customer password must be at least 12 characters");
  return { displayName, email, password };
}

function idList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error(`Invalid ${label} list`);
  const ids = [...new Set(value)];
  if (ids.some((id) => typeof id !== "string" || !validUuid(id))) {
    throw new Error(`Invalid ${label} selection`);
  }
  return ids;
}

function publicCustomer(row: CustomerRow) {
  return {
    id: row.id,
    accountNumber: customerAccountLabel(row.account_number),
    name: row.name,
    billingEmail: row.billing_email,
    currency: row.currency,
    accountType: row.account_type,
    billingMode: row.billing_mode,
    creditLimit: Number(row.credit_limit),
    active: row.active,
    balance: Number(row.balance),
    extensionCount: Number(row.extension_count),
    didCount: Number(row.did_count),
    loginCount: Number(row.login_count),
    customerRateCardId: row.customer_rate_card_id,
    customerRateCardName: row.customer_rate_card_name,
    servicePlanId: row.service_plan_id,
    servicePlanName: row.service_plan_name,
    extensionRangeStart: row.extension_range_start,
    extensionRangeEnd: row.extension_range_end,
    parentCustomerId: row.parent_customer_id,
    parentCustomerName: row.parent_customer_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function customerRow(id: string): Promise<CustomerRow | undefined> {
  if (!validUuid(id)) return undefined;
  const result = await pool.query<CustomerRow>(
    `SELECT customers.id, customers.account_number::text, customers.name,
            customers.billing_email, customers.currency, customers.account_type,
            customers.billing_mode,
            customers.credit_limit::text, customers.active,
            wallets.balance::text,
            (SELECT count(*) FROM customer_extensions
              WHERE customer_id = customers.id)::text AS extension_count,
            (SELECT count(*) FROM customer_did_routes
              WHERE customer_id = customers.id)::text AS did_count,
            (SELECT count(*) FROM users
              WHERE customer_id = customers.id AND role = 'customer_admin')::text AS login_count,
            customers.customer_rate_card_id,
            cards.name AS customer_rate_card_name,
            customers.service_plan_id, plans.name AS service_plan_name,
            customers.extension_range_start, customers.extension_range_end,
            customers.parent_customer_id, parent.name AS parent_customer_name,
            customers.created_at, customers.updated_at
       FROM customers
       JOIN customer_wallets AS wallets ON wallets.customer_id = customers.id
       LEFT JOIN customer_rate_cards AS cards ON cards.id = customers.customer_rate_card_id
       LEFT JOIN customer_service_plans AS plans ON plans.id = customers.service_plan_id
       LEFT JOIN customers AS parent ON parent.id=customers.parent_customer_id
      WHERE customers.id = $1`,
    [id],
  );
  return result.rows[0];
}

async function selectedCustomerRateCardId(value: unknown, currency: string): Promise<string | null> {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !validUuid(value)) throw new Error("Choose a valid customer rate card");
  const result = await pool.query<{ currency: string; enabled: boolean }>(
    "SELECT currency, enabled FROM customer_rate_cards WHERE id=$1",
    [value],
  );
  const card = result.rows[0];
  if (!card) throw new Error("The selected customer rate card no longer exists");
  if (!card.enabled) throw new Error("Enable the customer rate card before assigning it");
  if (card.currency !== currency) throw new Error("Customer and rate card must use the same currency");
  return value;
}

interface SelectedServicePlan {
  id: string;
  max_extensions: number;
  max_dids: number;
  self_service_extensions: boolean;
}

async function selectedServicePlan(value: unknown): Promise<SelectedServicePlan | null> {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !validUuid(value)) throw new Error("Choose a valid service plan");
  const result = await pool.query<SelectedServicePlan & { enabled: boolean }>(
    `SELECT id, max_extensions, max_dids, self_service_extensions, enabled
       FROM customer_service_plans WHERE id=$1`,
    [value],
  );
  const plan = result.rows[0];
  if (!plan) throw new Error("The selected service plan no longer exists");
  if (!plan.enabled) throw new Error("Enable the service plan before assigning it");
  return plan;
}

async function validateExtensionRangeAssignment(
  customerId: string | null,
  start: number | null,
  end: number | null,
  plan: SelectedServicePlan | null,
): Promise<void> {
  if (start === null || end === null) return;
  if (plan?.self_service_extensions && end - start + 1 < plan.max_extensions) {
    throw new Error("The extension range must contain at least the plan's extension limit");
  }
  let parentCustomerId: string | null = null;
  if (customerId) {
    const hierarchy = await pool.query<{
      parent_customer_id: string | null;
      parent_start: number | null;
      parent_end: number | null;
    }>(
      `SELECT customers.parent_customer_id,
              parent.extension_range_start AS parent_start,
              parent.extension_range_end AS parent_end
         FROM customers
         LEFT JOIN customers AS parent ON parent.id=customers.parent_customer_id
        WHERE customers.id=$1`,
      [customerId],
    );
    const target = hierarchy.rows[0];
    parentCustomerId = target?.parent_customer_id ?? null;
    if (
      parentCustomerId
      && (!target || target.parent_start === null || target.parent_end === null
        || start < target.parent_start || end > target.parent_end)
    ) {
      throw new Error("A reseller client range must remain inside its reseller's range");
    }
    const outsideChild = await pool.query<{ name: string }>(
      `SELECT name FROM customers
        WHERE parent_customer_id=$1
          AND extension_range_start IS NOT NULL
          AND extension_range_end IS NOT NULL
          AND (extension_range_start < $2 OR extension_range_end > $3)
        LIMIT 1`,
      [customerId, start, end],
    );
    if (outsideChild.rows[0]) {
      throw new Error(`The new range would exclude reseller client ${outsideChild.rows[0].name}`);
    }
  }
  const overlap = await pool.query<{ name: string }>(
    `SELECT name FROM customers
      WHERE extension_range_start IS NOT NULL
        AND extension_range_end IS NOT NULL
        AND ($3::uuid IS NULL OR id <> $3)
        AND NOT ($2 < extension_range_start OR $1 > extension_range_end)
        AND NOT (
          ($4::uuid IS NOT NULL AND id=$4
            AND $1 >= extension_range_start AND $2 <= extension_range_end)
          OR
          ($3::uuid IS NOT NULL AND parent_customer_id=$3
            AND extension_range_start >= $1 AND extension_range_end <= $2)
        )
      LIMIT 1`,
    [start, end, customerId, parentCustomerId],
  );
  if (overlap.rows[0]) throw new Error(`That extension range overlaps ${overlap.rows[0].name}`);
}

export function registerCustomerRoutes(app: FastifyInstance): void {
  app.get("/api/customers", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const [customers, accounts, extensions, dids, transactions, rateCards, servicePlans] = await Promise.all([
      pool.query<CustomerRow>(
        `SELECT customers.id, customers.account_number::text, customers.name,
                customers.billing_email, customers.currency, customers.account_type,
                customers.billing_mode,
                customers.credit_limit::text, customers.active,
                wallets.balance::text,
                (SELECT count(*) FROM customer_extensions
                  WHERE customer_id = customers.id)::text AS extension_count,
                (SELECT count(*) FROM customer_did_routes
                  WHERE customer_id = customers.id)::text AS did_count,
                (SELECT count(*) FROM users
                  WHERE customer_id = customers.id AND role = 'customer_admin')::text AS login_count,
                customers.customer_rate_card_id,
                cards.name AS customer_rate_card_name,
                customers.service_plan_id, plans.name AS service_plan_name,
                customers.extension_range_start, customers.extension_range_end,
                customers.parent_customer_id, parent.name AS parent_customer_name,
                customers.created_at, customers.updated_at
           FROM customers
           JOIN customer_wallets AS wallets ON wallets.customer_id = customers.id
           LEFT JOIN customer_rate_cards AS cards ON cards.id = customers.customer_rate_card_id
           LEFT JOIN customer_service_plans AS plans ON plans.id = customers.service_plan_id
           LEFT JOIN customers AS parent ON parent.id=customers.parent_customer_id
          ORDER BY customers.created_at DESC`,
      ),
      pool.query<LoginRow>(
        `SELECT id, customer_id, email, display_name, active, created_at
           FROM users
          WHERE role = 'customer_admin' AND customer_id IS NOT NULL
          ORDER BY display_name, email`,
      ),
      pool.query<{
        id: string; extension_number: string; display_name: string;
        enabled: boolean; customer_id: string | null;
      }>(
        `SELECT extensions.id, extensions.extension_number, extensions.display_name,
                extensions.enabled, assignments.customer_id
           FROM extensions
           LEFT JOIN customer_extensions AS assignments
             ON assignments.extension_id = extensions.id
          ORDER BY length(extensions.extension_number), extensions.extension_number`,
      ),
      pool.query<{
        id: string; did_number: string; enabled: boolean;
        trunk_name: string; customer_id: string | null;
      }>(
        `SELECT routes.id, routes.did_number, routes.enabled,
                trunks.name AS trunk_name, assignments.customer_id
           FROM did_routes AS routes
           JOIN sip_trunks AS trunks ON trunks.id = routes.trunk_id
           LEFT JOIN customer_did_routes AS assignments
             ON assignments.did_route_id = routes.id
          ORDER BY routes.did_number`,
      ),
      pool.query<{
        id: string; customer_id: string; transaction_type: string; currency: string;
        amount: string; balance_after: string; note: string; created_at: Date;
      }>(
        `SELECT id::text, customer_id, transaction_type, currency, amount::text,
                balance_after::text, note, created_at
           FROM customer_wallet_transactions
          ORDER BY created_at DESC, id DESC
          LIMIT 200`,
      ),
      pool.query<{
        id: string; name: string; currency: string; enabled: boolean; rate_count: string;
      }>(
        `SELECT cards.id, cards.name, cards.currency, cards.enabled,
                count(rates.id) FILTER (WHERE rates.enabled = true)::text AS rate_count
           FROM customer_rate_cards AS cards
           LEFT JOIN customer_rate_card_rates AS rates ON rates.rate_card_id = cards.id
          GROUP BY cards.id
          ORDER BY cards.name`,
      ),
      pool.query<{
        id: string; name: string; description: string; max_extensions: number;
        max_dids: number; recording_storage_mb: number; max_ai_receptionists: number;
        max_campaigns: number; self_service_extensions: boolean;
        recording_enabled: boolean; ai_receptionist_enabled: boolean;
        campaigns_enabled: boolean; enabled: boolean; customer_count: string;
      }>(
        `SELECT plans.id, plans.name, plans.description, plans.max_extensions,
                plans.max_dids, plans.recording_storage_mb,
                plans.max_ai_receptionists, plans.max_campaigns,
                plans.self_service_extensions, plans.recording_enabled,
                plans.ai_receptionist_enabled, plans.campaigns_enabled,
                plans.enabled, count(customers.id)::text AS customer_count
           FROM customer_service_plans AS plans
           LEFT JOIN customers ON customers.service_plan_id = plans.id
          GROUP BY plans.id
          ORDER BY plans.name`,
      ),
    ]);
    return {
      customers: customers.rows.map(publicCustomer),
      accounts: accounts.rows.map((row) => ({
        id: row.id,
        customerId: row.customer_id,
        email: row.email,
        displayName: row.display_name,
        active: row.active,
        createdAt: row.created_at,
      })),
      extensions: extensions.rows.map((row) => ({
        id: row.id,
        extensionNumber: row.extension_number,
        displayName: row.display_name,
        enabled: row.enabled,
        customerId: row.customer_id,
      })),
      dids: dids.rows.map((row) => ({
        id: row.id,
        didNumber: row.did_number,
        trunkName: row.trunk_name,
        enabled: row.enabled,
        customerId: row.customer_id,
      })),
      transactions: transactions.rows.map((row) => ({
        id: row.id,
        customerId: row.customer_id,
        type: row.transaction_type,
        currency: row.currency,
        amount: Number(row.amount),
        balanceAfter: Number(row.balance_after),
        note: row.note,
        createdAt: row.created_at,
      })),
      rateCards: rateCards.rows.map((row) => ({
        id: row.id,
        name: row.name,
        currency: row.currency,
        enabled: row.enabled,
        rateCount: Number(row.rate_count),
      })),
      servicePlans: servicePlans.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        maxExtensions: row.max_extensions,
        maxDids: row.max_dids,
        recordingStorageMb: row.recording_storage_mb,
        maxAiReceptionists: row.max_ai_receptionists,
        maxCampaigns: row.max_campaigns,
        selfServiceExtensions: row.self_service_extensions,
        recordingEnabled: row.recording_enabled,
        aiReceptionistEnabled: row.ai_receptionist_enabled,
        campaignsEnabled: row.campaigns_enabled,
        enabled: row.enabled,
        customerCount: Number(row.customer_count),
      })),
    };
  });

  app.post<{ Body: CustomerBody }>("/api/customers", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    let values: CustomerValues;
    let login;
    let customerRateCardId: string | null;
    let servicePlan: SelectedServicePlan;
    let extensionRange: ReturnType<typeof customerExtensionRange>;
    try {
      values = customerValues(request.body ?? {});
      login = loginValues(request.body ?? {});
      customerRateCardId = await selectedCustomerRateCardId(
        request.body?.customerRateCardId,
        values.currency,
      );
      const selectedPlan = await selectedServicePlan(request.body?.servicePlanId);
      if (!selectedPlan) throw new Error("Choose a service plan");
      servicePlan = selectedPlan;
      extensionRange = customerExtensionRange(
        request.body?.extensionRangeStart,
        request.body?.extensionRangeEnd,
      );
      await validateExtensionRangeAssignment(
        null, extensionRange.start, extensionRange.end, servicePlan,
      );
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ id: string; account_number: string }>(
         `INSERT INTO customers
           (name, billing_email, currency, account_type, billing_mode, credit_limit,
            active, customer_rate_card_id, service_plan_id,
            extension_range_start, extension_range_end, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, account_number::text`,
        [
          values.name, values.billingEmail, values.currency, values.accountType,
          values.billingMode, values.creditLimit, values.active, customerRateCardId,
          servicePlan.id, extensionRange.start, extensionRange.end, user.id,
        ],
      );
      const customer = inserted.rows[0];
      if (!customer) throw new Error("Customer insert returned no id");
      await client.query("INSERT INTO customer_wallets (customer_id) VALUES ($1)", [customer.id]);
      const account = await client.query<{ id: string }>(
        `INSERT INTO users
           (email, display_name, password_hash, role, active, customer_id)
         VALUES ($1,$2,$3,'customer_admin',true,$4)
         RETURNING id`,
        [login.email, login.displayName, hashPassword(login.password), customer.id],
      );
      await client.query("COMMIT");
      await audit("customer.created", user.id, {
        customerId: customer.id,
        customerAccount: customerAccountLabel(customer.account_number),
        customerUserId: account.rows[0]?.id,
      }, request.ip);
      return reply.code(201).send({
        id: customer.id,
        accountNumber: customerAccountLabel(customer.account_number),
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (databaseCode(error) === "23505") {
        return reply.code(409).send({ error: "That customer login email is already in use" });
      }
      request.log.error({ error }, "Customer creation failed");
      return reply.code(500).send({ error: "The customer could not be created" });
    } finally {
      client.release();
    }
  });

  app.patch<{ Params: IdParams; Body: CustomerBody }>(
    "/api/customers/:id",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const current = await customerRow(request.params.id);
      if (!current) return reply.code(404).send({ error: "Customer not found" });
      let values: CustomerValues;
      let customerRateCardId: string | null;
      let servicePlan: SelectedServicePlan;
      let extensionRange: ReturnType<typeof customerExtensionRange>;
      try {
        values = customerValues(request.body ?? {}, {
          name: current.name,
          billingEmail: current.billing_email,
          currency: current.currency,
          accountType: current.account_type,
          billingMode: current.billing_mode,
          creditLimit: Number(current.credit_limit),
          active: current.active,
        });
        customerRateCardId = await selectedCustomerRateCardId(
          request.body?.customerRateCardId === undefined
            ? current.customer_rate_card_id
            : request.body.customerRateCardId,
          values.currency,
        );
        const selectedPlan = await selectedServicePlan(
          request.body?.servicePlanId === undefined
            ? current.service_plan_id
            : request.body.servicePlanId,
        );
        if (!selectedPlan) throw new Error("Choose a service plan");
        servicePlan = selectedPlan;
        extensionRange = customerExtensionRange(
          request.body?.extensionRangeStart === undefined
            ? current.extension_range_start
            : request.body.extensionRangeStart,
          request.body?.extensionRangeEnd === undefined
            ? current.extension_range_end
            : request.body.extensionRangeEnd,
        );
        await validateExtensionRangeAssignment(
          current.id, extensionRange.start, extensionRange.end, servicePlan,
        );
        if (Number(current.extension_count) > servicePlan.max_extensions) {
          throw new Error("The selected plan allows fewer extensions than this customer currently has");
        }
        if (Number(current.did_count) > servicePlan.max_dids) {
          throw new Error("The selected plan allows fewer DIDs than this customer currently has");
        }
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
      const balance = Number(current.balance);
      if (values.billingMode === "prepaid" && balance < 0) {
        return reply.code(409).send({ error: "Clear the negative balance before changing to prepaid" });
      }
      if (values.billingMode === "postpaid" && balance < -values.creditLimit) {
        return reply.code(409).send({ error: "Credit limit cannot be lower than the current balance" });
      }
      await pool.query(
        `UPDATE customers
            SET name=$2, billing_email=$3, currency=$4, account_type=$5,
                billing_mode=$6, credit_limit=$7, active=$8, customer_rate_card_id=$9,
                service_plan_id=$10, extension_range_start=$11, extension_range_end=$12,
                updated_at=now()
          WHERE id=$1`,
        [
          current.id, values.name, values.billingEmail, values.currency,
          values.accountType, values.billingMode, values.creditLimit, values.active,
          customerRateCardId, servicePlan.id, extensionRange.start, extensionRange.end,
        ],
      );
      await audit("customer.updated", user.id, { customerId: current.id }, request.ip);
      return { ok: true };
    },
  );

  app.put<{ Params: IdParams; Body: ServiceBody }>(
    "/api/customers/:id/services",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const customer = await customerRow(request.params.id);
      if (!customer) return reply.code(404).send({ error: "Customer not found" });
      let extensionIds: string[];
      let didRouteIds: string[];
      try {
        extensionIds = idList(request.body?.extensionIds ?? [], "extension");
        didRouteIds = idList(request.body?.didRouteIds ?? [], "DID route");
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
      const planResult = await pool.query<{ max_extensions: number; max_dids: number }>(
        `SELECT plans.max_extensions, plans.max_dids
           FROM customer_service_plans AS plans
           JOIN customers ON customers.service_plan_id = plans.id
          WHERE customers.id=$1 AND plans.enabled=true`,
        [customer.id],
      );
      const plan = planResult.rows[0];
      if (!plan) return reply.code(409).send({ error: "Assign an enabled service plan first" });
      if (extensionIds.length > plan.max_extensions) {
        return reply.code(409).send({ error: `This plan permits ${plan.max_extensions} extensions` });
      }
      if (didRouteIds.length > plan.max_dids) {
        return reply.code(409).send({ error: `This plan permits ${plan.max_dids} DIDs` });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (extensionIds.length) {
          const extensions = await client.query<{ id: string; customer_id: string | null }>(
            `SELECT extensions.id, assignments.customer_id
               FROM extensions
               LEFT JOIN customer_extensions AS assignments
                 ON assignments.extension_id = extensions.id
              WHERE extensions.id = ANY($1::uuid[])`,
            [extensionIds],
          );
          if (extensions.rowCount !== extensionIds.length) throw new Error("One or more extensions no longer exist");
          if (extensions.rows.some((row) => row.customer_id && row.customer_id !== customer.id)) {
            throw new Error("One or more extensions belong to another customer");
          }
        }
        if (didRouteIds.length) {
          const dids = await client.query<{ id: string; customer_id: string | null }>(
            `SELECT routes.id, assignments.customer_id
               FROM did_routes AS routes
               LEFT JOIN customer_did_routes AS assignments
                 ON assignments.did_route_id = routes.id
              WHERE routes.id = ANY($1::uuid[])`,
            [didRouteIds],
          );
          if (dids.rowCount !== didRouteIds.length) throw new Error("One or more DID routes no longer exist");
          if (dids.rows.some((row) => row.customer_id && row.customer_id !== customer.id)) {
            throw new Error("One or more DID routes belong to another customer");
          }
        }
        await client.query("DELETE FROM customer_extensions WHERE customer_id=$1", [customer.id]);
        await client.query("DELETE FROM customer_did_routes WHERE customer_id=$1", [customer.id]);
        if (extensionIds.length) {
          await client.query(
            `INSERT INTO customer_extensions (customer_id, extension_id, assigned_by)
             SELECT $1, unnest($2::uuid[]), $3`,
            [customer.id, extensionIds, user.id],
          );
        }
        if (didRouteIds.length) {
          await client.query(
            `INSERT INTO customer_did_routes (customer_id, did_route_id, assigned_by)
             SELECT $1, unnest($2::uuid[]), $3`,
            [customer.id, didRouteIds, user.id],
          );
        }
        await client.query("COMMIT");
        await audit("customer.services.updated", user.id, {
          customerId: customer.id,
          extensionCount: extensionIds.length,
          didCount: didRouteIds.length,
        }, request.ip);
        return { ok: true };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        const message = error instanceof Error ? error.message : "Service assignments could not be updated";
        return reply.code(databaseCode(error) === "23505" ? 409 : 400).send({ error: message });
      } finally {
        client.release();
      }
    },
  );

  app.post<{ Params: IdParams; Body: WalletBody }>(
    "/api/customers/:id/wallet-transactions",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Customer not found" });
      let amount: number;
      const note = request.body?.note?.trim() ?? "";
      try {
        amount = walletAdjustment(request.body?.amount);
        if (note.length < 2 || note.length > 200) throw new Error("Enter a wallet transaction note");
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query<{
          billing_mode: BillingMode; credit_limit: string; currency: string; balance: string;
        }>(
          `SELECT customers.billing_mode, customers.credit_limit::text,
                  customers.currency,
                  wallets.balance::text
             FROM customers
             JOIN customer_wallets AS wallets ON wallets.customer_id = customers.id
            WHERE customers.id = $1
            FOR UPDATE OF wallets`,
          [request.params.id],
        );
        const row = locked.rows[0];
        if (!row) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Customer not found" });
        }
        const balance = Math.round((Number(row.balance) + amount) * 1_000_000) / 1_000_000;
        const minimum = row.billing_mode === "prepaid" ? 0 : -Number(row.credit_limit);
        if (balance < minimum) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "This adjustment would exceed the customer's available credit" });
        }
        await client.query(
          "UPDATE customer_wallets SET balance=$2, updated_at=now() WHERE customer_id=$1",
          [request.params.id, balance],
        );
        await client.query(
          `INSERT INTO customer_wallet_transactions
             (customer_id, transaction_type, currency, amount, balance_after, note, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            request.params.id, amount > 0 ? "topup" : "adjustment",
            row.currency, amount, balance, note, user.id,
          ],
        );
        await client.query("COMMIT");
        await audit("customer.wallet.adjusted", user.id, {
          customerId: request.params.id, amount, balance,
        }, request.ip);
        return { ok: true, balance };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        request.log.error({ error }, "Customer wallet adjustment failed");
        return reply.code(500).send({ error: "The wallet transaction could not be posted" });
      } finally {
        client.release();
      }
    },
  );

  app.post<{ Params: IdParams; Body: PasswordBody }>(
    "/api/customers/:id/reset-password",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const password = request.body?.password ?? "";
      if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Customer not found" });
      if (password.length < 12) return reply.code(400).send({ error: "Password must be at least 12 characters" });
      const result = await pool.query(
        `UPDATE users SET password_hash=$2, updated_at=now()
          WHERE customer_id=$1 AND role='customer_admin'`,
        [request.params.id, hashPassword(password)],
      );
      if (result.rowCount !== 1) return reply.code(404).send({ error: "Customer login not found" });
      await pool.query(
        `DELETE FROM sessions
          WHERE user_id IN (
            SELECT id FROM users WHERE customer_id=$1 AND role='customer_admin'
          )`,
        [request.params.id],
      );
      await audit("customer.password.reset", user.id, { customerId: request.params.id }, request.ip);
      return { ok: true };
    },
  );

  app.get("/api/customer/rate-card", async (request, reply) => {
    const user = await requireCustomer(request, reply);
    if (!user?.customerId) return;
    const cardResult = await pool.query<{
      id: string; name: string; currency: string; enabled: boolean; updated_at: Date;
    }>(
      `SELECT cards.id, cards.name, cards.currency, cards.enabled, cards.updated_at
         FROM customers
         JOIN customer_rate_cards AS cards ON cards.id = customers.customer_rate_card_id
        WHERE customers.id = $1`,
      [user.customerId],
    );
    const card = cardResult.rows[0];
    if (!card) return { rateCard: null, rates: [] };
    const rates = await pool.query<{
      id: string; prefix: string; destination_name: string; price_per_minute: string;
      billing_increment_seconds: number; minimum_seconds: number; updated_at: Date;
    }>(
      `SELECT id::text, prefix, destination_name, price_per_minute::text,
              billing_increment_seconds, minimum_seconds, updated_at
         FROM customer_rate_card_rates
        WHERE rate_card_id = $1 AND enabled = true
        ORDER BY length(prefix), prefix
        LIMIT 5000`,
      [card.id],
    );
    return {
      rateCard: {
        id: card.id,
        name: card.name,
        currency: card.currency,
        enabled: card.enabled,
        updatedAt: card.updated_at,
      },
      rates: rates.rows.map((row) => ({
        id: row.id,
        prefix: row.prefix,
        destinationName: row.destination_name,
        ratePerMinute: Number(row.price_per_minute),
        billingIncrementSeconds: row.billing_increment_seconds,
        minimumSeconds: row.minimum_seconds,
        updatedAt: row.updated_at,
      })),
    };
  });

  app.get("/api/customer/rated-calls", async (request, reply) => {
    const user = await requireCustomer(request, reply);
    if (!user?.customerId) return;
    const charges = await pool.query<{
      id: string; call_started_at: Date; source: string; destination: string;
      destination_name: string; original_billsec: number; charged_seconds: number;
      sell_matched_prefix: string; sell_per_minute: string;
      billing_increment_seconds: number; minimum_seconds: number;
      sell_amount: string; currency: string;
    }>(
      `SELECT charges.id::text, charges.call_started_at, records.src AS source,
              charges.destination, charges.destination_name,
              charges.original_billsec, charges.charged_seconds,
              charges.sell_matched_prefix, charges.sell_per_minute::text,
              charges.billing_increment_seconds, charges.minimum_seconds,
              charges.sell_amount::text, charges.currency
         FROM billing_call_charges AS charges
         JOIN call_detail_records AS records ON records.id = charges.cdr_id
        WHERE charges.customer_id = $1
        ORDER BY charges.call_started_at DESC, charges.id DESC
        LIMIT 100`,
      [user.customerId],
    );
    return {
      calls: charges.rows.map((row) => ({
        id: row.id,
        callStartedAt: row.call_started_at,
        source: row.source,
        destination: row.destination,
        destinationName: row.destination_name,
        originalBillsec: row.original_billsec,
        chargedSeconds: row.charged_seconds,
        matchedPrefix: row.sell_matched_prefix,
        ratePerMinute: Number(row.sell_per_minute),
        billingIncrementSeconds: row.billing_increment_seconds,
        minimumSeconds: row.minimum_seconds,
        amount: Number(row.sell_amount),
        currency: row.currency,
      })),
    };
  });

  app.get("/api/customer/portal", async (request, reply) => {
    const user = await requireCustomer(request, reply);
    if (!user?.customerId) return;
    const [customerResult, extensionsResult, didsResult, transactionsResult, usageResult, invoices, branding] = await Promise.all([
      pool.query<{
        id: string; account_number: string; name: string; billing_email: string;
        currency: string; account_type: CustomerAccountType;
        billing_mode: BillingMode; credit_limit: string;
        active: boolean; balance: string;
        service_plan_id: string | null; service_plan_name: string | null;
        service_plan_description: string | null; plan_enabled: boolean | null;
        max_extensions: number | null; max_dids: number | null;
        recording_storage_mb: number | null; max_ai_receptionists: number | null;
        max_campaigns: number | null; self_service_extensions: boolean | null;
        recording_enabled: boolean | null; ai_receptionist_enabled: boolean | null;
        campaigns_enabled: boolean | null;
        extension_range_start: number | null; extension_range_end: number | null;
        delegated_extensions: string;
      }>(
        `SELECT customers.id, customers.account_number::text, customers.name,
                customers.billing_email, customers.currency, customers.account_type,
                customers.billing_mode,
                customers.credit_limit::text, customers.active, wallets.balance::text,
                customers.service_plan_id, plans.name AS service_plan_name,
                plans.description AS service_plan_description,
                plans.enabled AS plan_enabled, plans.max_extensions, plans.max_dids,
                plans.recording_storage_mb, plans.max_ai_receptionists,
                plans.max_campaigns, plans.self_service_extensions,
                plans.recording_enabled, plans.ai_receptionist_enabled,
                plans.campaigns_enabled, customers.extension_range_start,
                customers.extension_range_end,
                (SELECT COALESCE(sum(child_plans.max_extensions),0)::text
                   FROM customers AS child_accounts
                   JOIN customer_service_plans AS child_plans
                     ON child_plans.id=child_accounts.service_plan_id
                  WHERE child_accounts.parent_customer_id=customers.id
                ) AS delegated_extensions
           FROM customers
           JOIN customer_wallets AS wallets ON wallets.customer_id = customers.id
           LEFT JOIN customer_service_plans AS plans ON plans.id=customers.service_plan_id
          WHERE customers.id = $1`,
        [user.customerId],
      ),
      pool.query<{
        id: string; extension_number: string; display_name: string; enabled: boolean;
        max_contacts: number; ring_timeout_seconds: number;
        voicemail_enabled: boolean; voicemail_configured: boolean;
        dnd_enabled: boolean; call_waiting: boolean; record_calls: boolean;
        forward_mode: string; forward_extension_id: string | null;
        forward_extension_number: string | null;
      }>(
        `SELECT extensions.id, extensions.extension_number,
                extensions.display_name, extensions.enabled, extensions.max_contacts,
                extensions.ring_timeout_seconds, extensions.voicemail_enabled,
                (extensions.voicemail_pin_ciphertext IS NOT NULL) AS voicemail_configured,
                extensions.dnd_enabled, extensions.call_waiting, extensions.record_calls,
                extensions.forward_mode, extensions.forward_extension_id,
                forwarded.extension_number AS forward_extension_number
           FROM customer_extensions AS assignments
           JOIN extensions ON extensions.id = assignments.extension_id
           LEFT JOIN extensions AS forwarded ON forwarded.id=extensions.forward_extension_id
          WHERE assignments.customer_id = $1
          ORDER BY length(extensions.extension_number), extensions.extension_number`,
        [user.customerId],
      ),
      pool.query<{
        id: string; did_number: string; enabled: boolean; destination_number: string;
      }>(
        `SELECT routes.id, routes.did_number, routes.enabled,
                COALESCE(extensions.extension_number, ivrs.extension_number, '') AS destination_number
           FROM customer_did_routes AS assignments
           JOIN did_routes AS routes ON routes.id = assignments.did_route_id
           LEFT JOIN extensions ON extensions.id = routes.extension_id
           LEFT JOIN ivr_menus AS ivrs ON ivrs.id = routes.ivr_menu_id
          WHERE assignments.customer_id = $1
          ORDER BY routes.did_number`,
        [user.customerId],
      ),
      pool.query<{
        id: string; transaction_type: string; currency: string; amount: string;
        balance_after: string; note: string; created_at: Date;
      }>(
        `SELECT id::text, transaction_type, currency, amount::text, balance_after::text,
                note, created_at
           FROM customer_wallet_transactions
          WHERE customer_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 50`,
        [user.customerId],
      ),
      pool.query<{
        today_usage: string; month_usage: string; rated_calls: string;
      }>(
        `SELECT COALESCE(sum(sell_amount) FILTER (
                  WHERE call_started_at >= date_trunc('day', now())
                ), 0)::text AS today_usage,
                COALESCE(sum(sell_amount) FILTER (
                  WHERE call_started_at >= date_trunc('month', now())
                ), 0)::text AS month_usage,
                count(*)::text AS rated_calls
           FROM billing_call_charges
          WHERE customer_id = $1`,
        [user.customerId],
      ),
      listInvoices(user.customerId),
      effectiveBrandingForCustomer(user.customerId),
    ]);
    const customer = customerResult.rows[0];
    if (!customer) return reply.code(404).send({ error: "Customer account not found" });
    const planAvailable = customer.plan_enabled === true;
    const selfServiceEnabled = planAvailable && customer.self_service_extensions === true;
    const hasRange = customer.extension_range_start !== null && customer.extension_range_end !== null;
    const maxExtensions = customer.max_extensions ?? 0;
    const delegatedExtensions = Number(customer.delegated_extensions);
    const maxDids = customer.max_dids ?? 0;
    let createExtensionReason = "";
    if (!customer.active) createExtensionReason = "Customer account is disabled";
    else if (!customer.service_plan_id) createExtensionReason = "An administrator must assign a service plan";
    else if (!planAvailable) createExtensionReason = "Service plan is disabled";
    else if (!selfServiceEnabled) createExtensionReason = "Extension self-service is not included in this plan";
    else if (!hasRange) createExtensionReason = "An administrator must assign an extension number range";
    else if (extensionsResult.rows.length + delegatedExtensions >= maxExtensions) {
      createExtensionReason = "Extension allowance is fully used or delegated to clients";
    }
    const extensionNumbers = extensionsResult.rows.map((row) => row.extension_number);
    const [registrationStatuses, callsResult] = await Promise.all([
      getExtensionRegistrationStatuses(extensionNumbers).catch(() => new Map()),
      pool.query<{
        id: string; calldate: Date; clid: string; src: string; dst: string;
        dcontext: string; duration: number; billsec: number; disposition: string;
        peeraccount: string;
      }>(
        `WITH ranked AS (
           SELECT records.*,
                  row_number() OVER (
                    PARTITION BY COALESCE(
                      NULLIF(records.linkedid, ''), NULLIF(records.uniqueid, ''), records.id::text
                    )
                    ORDER BY records.sequence, records.id
                  ) AS leg_rank
             FROM call_detail_records AS records
            WHERE records.src = ANY($1::text[]) OR records.dst = ANY($1::text[])
         )
         SELECT id::text, calldate, clid, src, dst, dcontext, duration,
                billsec, disposition, peeraccount
           FROM ranked
          WHERE leg_rank = 1
          ORDER BY calldate DESC, id DESC
          LIMIT 30`,
        [extensionNumbers],
      ),
    ]);
    const usage = usageResult.rows[0];
    return {
      user,
      branding,
      customer: {
        id: customer.id,
        accountNumber: customerAccountLabel(customer.account_number),
        name: customer.name,
        billingEmail: customer.billing_email,
        currency: customer.currency,
        accountType: customer.account_type,
        billingMode: customer.billing_mode,
        creditLimit: Number(customer.credit_limit),
        active: customer.active,
        balance: Number(customer.balance),
      },
      entitlements: {
        servicePlanId: customer.service_plan_id,
        servicePlanName: customer.service_plan_name,
        servicePlanDescription: customer.service_plan_description,
        planEnabled: planAvailable,
        maxExtensions,
        maxDids,
        recordingStorageMb: customer.recording_storage_mb ?? 0,
        maxAiReceptionists: customer.max_ai_receptionists ?? 0,
        maxCampaigns: customer.max_campaigns ?? 0,
        selfServiceExtensions: selfServiceEnabled,
        recordingEnabled: planAvailable && customer.recording_enabled === true,
        aiReceptionistEnabled: planAvailable && customer.ai_receptionist_enabled === true,
        campaignsEnabled: planAvailable && customer.campaigns_enabled === true,
        extensionRangeStart: customer.extension_range_start,
        extensionRangeEnd: customer.extension_range_end,
        createExtension: {
          allowed: createExtensionReason === "",
          reason: createExtensionReason,
          remaining: Math.max(
            0,
            maxExtensions - extensionsResult.rows.length - delegatedExtensions,
          ),
        },
        availability: {
          recording: {
            enabled: planAvailable && customer.recording_enabled === true,
            reason: planAvailable && customer.recording_enabled === true
              ? "" : "Call recording is not included in this service plan",
          },
          aiReceptionist: {
            enabled: planAvailable && customer.ai_receptionist_enabled === true,
            reason: planAvailable && customer.ai_receptionist_enabled === true
              ? "" : "AI receptionist is not included in this service plan",
          },
          campaigns: {
            enabled: planAvailable && customer.campaigns_enabled === true,
            reason: planAvailable && customer.campaigns_enabled === true
              ? "" : "Campaigns are not included in this service plan",
          },
        },
      },
      extensions: extensionsResult.rows.map((row) => ({
        id: row.id,
        extensionNumber: row.extension_number,
        displayName: row.display_name,
        enabled: row.enabled,
        registrationState: row.enabled
          ? registrationStatuses.get(row.extension_number)?.state ?? "unknown"
          : "disabled",
        maxContacts: row.max_contacts,
        ringTimeoutSeconds: row.ring_timeout_seconds,
        voicemailEnabled: row.voicemail_enabled,
        voicemailConfigured: row.voicemail_configured,
        dndEnabled: row.dnd_enabled,
        callWaiting: row.call_waiting,
        recordCalls: row.record_calls,
        forwardMode: row.forward_mode,
        forwardExtensionId: row.forward_extension_id,
        forwardExtensionNumber: row.forward_extension_number,
      })),
      dids: didsResult.rows.map((row) => ({
        id: row.id,
        didNumber: row.did_number,
        destinationNumber: row.destination_number,
        enabled: row.enabled,
      })),
      transactions: transactionsResult.rows.map((row) => ({
        id: row.id,
        type: row.transaction_type,
        currency: row.currency,
        amount: Number(row.amount),
        balanceAfter: Number(row.balance_after),
        note: row.note,
        createdAt: row.created_at,
      })),
      usage: {
        today: Number(usage?.today_usage ?? 0),
        month: Number(usage?.month_usage ?? 0),
        ratedCalls: Number(usage?.rated_calls ?? 0),
      },
      invoices,
      calls: callsResult.rows.map((row) => ({
        id: row.id,
        startedAt: row.calldate,
        source: row.src || "Unknown",
        destination: row.dst || "Unknown",
        direction: callDirection(row.dcontext, row.src, row.dst),
        status: normalizeDisposition(
          row.disposition, row.peeraccount, Number(row.duration), row.dcontext,
        ),
        durationSeconds: Math.max(0, Number(row.duration)),
        billableSeconds: Math.max(0, Number(row.billsec)),
      })),
    };
  });
}
