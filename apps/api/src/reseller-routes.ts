import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { hashPassword, requireCustomer } from "./auth.js";
import { customerAccountLabel, validCustomerEmail } from "./customers.js";
import { audit, pool } from "./database.js";
import { customerExtensionRange } from "./customer-plans.js";
import { validUuid } from "./queue-agent-state.js";

interface ResellerClientBody {
  name?: string;
  billingEmail?: string;
  billingMode?: "prepaid" | "postpaid";
  creditLimit?: number;
  extensionRangeStart?: number | string | null;
  extensionRangeEnd?: number | string | null;
  maxExtensions?: number;
  maxDids?: number;
  recordingStorageMb?: number;
  loginDisplayName?: string;
  loginEmail?: string;
  loginPassword?: string;
}

interface IdParams { id: string }
interface StatusBody { active?: boolean }
interface PasswordBody { password?: string }

interface ResellerEntitlement {
  id: string;
  account_number: string;
  name: string;
  currency: string;
  active: boolean;
  account_type: "retail" | "wholesale";
  extension_range_start: number | null;
  extension_range_end: number | null;
  max_extensions: number;
  max_dids: number;
  recording_storage_mb: number;
  self_service_extensions: boolean;
  recording_enabled: boolean;
  plan_enabled: boolean;
  own_extensions: string;
  own_dids: string;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function clientIdentity(body: ResellerClientBody) {
  const name = body.name?.trim() ?? "";
  const billingEmail = body.billingEmail?.trim().toLowerCase() ?? "";
  const loginDisplayName = body.loginDisplayName?.trim() ?? "";
  const loginEmail = body.loginEmail?.trim().toLowerCase() ?? "";
  const loginPassword = body.loginPassword ?? "";
  if (name.length < 2 || name.length > 120) throw new Error("Enter a valid client name");
  if (!validCustomerEmail(billingEmail)) throw new Error("Enter a valid billing email");
  if (loginDisplayName.length < 2 || loginDisplayName.length > 100) {
    throw new Error("Enter a valid client login name");
  }
  if (!validCustomerEmail(loginEmail)) throw new Error("Enter a valid client login email");
  if (loginPassword.length < 12) throw new Error("Client password must be at least 12 characters");
  const billingMode = body.billingMode === "postpaid" ? "postpaid" : "prepaid";
  const creditLimit = billingMode === "postpaid"
    ? boundedInteger(body.creditLimit ?? 0, "Credit limit", 0, 100_000_000)
    : 0;
  return {
    name, billingEmail, loginDisplayName, loginEmail, loginPassword,
    billingMode, creditLimit,
  };
}

async function resellerEntitlement(customerId: string): Promise<ResellerEntitlement | undefined> {
  const result = await pool.query<ResellerEntitlement>(
    `SELECT customers.id, customers.account_number::text, customers.name,
            customers.currency, customers.active, customers.account_type,
            customers.extension_range_start, customers.extension_range_end,
            plans.max_extensions, plans.max_dids, plans.recording_storage_mb,
            plans.self_service_extensions, plans.recording_enabled,
            plans.enabled AS plan_enabled,
            (SELECT count(*) FROM customer_extensions
              WHERE customer_id=customers.id)::text AS own_extensions,
            (SELECT count(*) FROM customer_did_routes
              WHERE customer_id=customers.id)::text AS own_dids
       FROM customers
       JOIN customer_service_plans AS plans ON plans.id=customers.service_plan_id
      WHERE customers.id=$1`,
    [customerId],
  );
  return result.rows[0];
}

function assertResellerAvailable(reseller: ResellerEntitlement): void {
  if (reseller.account_type !== "wholesale") throw new Error("A wholesale reseller account is required");
  if (!reseller.active) throw new Error("The reseller account is disabled");
  if (!reseller.plan_enabled) throw new Error("The reseller service plan is disabled");
  if (reseller.extension_range_start === null || reseller.extension_range_end === null) {
    throw new Error("An administrator must assign the reseller extension range first");
  }
}

async function delegatedTotals(customerId: string) {
  const result = await pool.query<{
    max_extensions: string; max_dids: string; recording_storage_mb: string;
  }>(
    `SELECT COALESCE(sum(plans.max_extensions),0)::text AS max_extensions,
            COALESCE(sum(plans.max_dids),0)::text AS max_dids,
            COALESCE(sum(plans.recording_storage_mb),0)::text AS recording_storage_mb
       FROM customers AS clients
       JOIN customer_service_plans AS plans ON plans.id=clients.service_plan_id
      WHERE clients.parent_customer_id=$1`,
    [customerId],
  );
  return {
    maxExtensions: Number(result.rows[0]?.max_extensions ?? 0),
    maxDids: Number(result.rows[0]?.max_dids ?? 0),
    recordingStorageMb: Number(result.rows[0]?.recording_storage_mb ?? 0),
  };
}

export function registerResellerRoutes(app: FastifyInstance): void {
  app.get("/api/customer/reseller/clients", async (request, reply) => {
    const user = await requireCustomer(request, reply);
    if (!user?.customerId) return;
    const reseller = await resellerEntitlement(user.customerId);
    if (!reseller) return reply.code(409).send({ error: "Assign a reseller service plan first" });
    try { assertResellerAvailable(reseller); }
    catch (error) { return reply.code(403).send({ error: (error as Error).message }); }
    const [clients, totals] = await Promise.all([
      pool.query<{
        id: string; account_number: string; name: string; billing_email: string;
        billing_mode: "prepaid" | "postpaid"; credit_limit: string; active: boolean;
        balance: string; extension_range_start: number; extension_range_end: number;
        max_extensions: number; max_dids: number; recording_storage_mb: number;
        extension_count: string; did_count: string; login_email: string | null;
        created_at: Date;
      }>(
        `SELECT clients.id, clients.account_number::text, clients.name,
                clients.billing_email, clients.billing_mode,
                clients.credit_limit::text, clients.active, wallets.balance::text,
                clients.extension_range_start, clients.extension_range_end,
                plans.max_extensions, plans.max_dids, plans.recording_storage_mb,
                (SELECT count(*) FROM customer_extensions
                  WHERE customer_id=clients.id)::text AS extension_count,
                (SELECT count(*) FROM customer_did_routes
                  WHERE customer_id=clients.id)::text AS did_count,
                (SELECT email FROM users WHERE customer_id=clients.id
                  AND role='customer_admin' ORDER BY created_at LIMIT 1) AS login_email,
                clients.created_at
           FROM customers AS clients
           JOIN customer_wallets AS wallets ON wallets.customer_id=clients.id
           JOIN customer_service_plans AS plans ON plans.id=clients.service_plan_id
          WHERE clients.parent_customer_id=$1
          ORDER BY clients.created_at DESC`,
        [user.customerId],
      ),
      delegatedTotals(user.customerId),
    ]);
    return {
      reseller: {
        accountNumber: customerAccountLabel(reseller.account_number),
        currency: reseller.currency,
        extensionRangeStart: reseller.extension_range_start,
        extensionRangeEnd: reseller.extension_range_end,
      },
      capacity: {
        maxExtensions: reseller.max_extensions,
        allocatedExtensions: totals.maxExtensions,
        ownExtensions: Number(reseller.own_extensions),
        remainingExtensions: Math.max(
          0, reseller.max_extensions - totals.maxExtensions - Number(reseller.own_extensions),
        ),
        maxDids: reseller.max_dids,
        allocatedDids: totals.maxDids,
        ownDids: Number(reseller.own_dids),
        remainingDids: Math.max(0, reseller.max_dids - totals.maxDids - Number(reseller.own_dids)),
        recordingStorageMb: reseller.recording_storage_mb,
        allocatedRecordingStorageMb: totals.recordingStorageMb,
        remainingRecordingStorageMb: Math.max(
          0, reseller.recording_storage_mb - totals.recordingStorageMb,
        ),
      },
      clients: clients.rows.map((client) => ({
        id: client.id,
        accountNumber: customerAccountLabel(client.account_number),
        name: client.name,
        billingEmail: client.billing_email,
        billingMode: client.billing_mode,
        creditLimit: Number(client.credit_limit),
        balance: Number(client.balance),
        active: client.active,
        extensionRangeStart: client.extension_range_start,
        extensionRangeEnd: client.extension_range_end,
        maxExtensions: client.max_extensions,
        maxDids: client.max_dids,
        recordingStorageMb: client.recording_storage_mb,
        extensionCount: Number(client.extension_count),
        didCount: Number(client.did_count),
        loginEmail: client.login_email,
        createdAt: client.created_at,
      })),
    };
  });

  app.post<{ Body: ResellerClientBody }>(
    "/api/customer/reseller/clients",
    async (request, reply) => {
      const user = await requireCustomer(request, reply);
      if (!user?.customerId) return;
      const reseller = await resellerEntitlement(user.customerId);
      if (!reseller) return reply.code(409).send({ error: "Assign a reseller service plan first" });
      let identity: ReturnType<typeof clientIdentity>;
      let range: ReturnType<typeof customerExtensionRange>;
      let maxExtensions: number;
      let maxDids: number;
      let recordingStorageMb: number;
      try {
        assertResellerAvailable(reseller);
        identity = clientIdentity(request.body ?? {});
        range = customerExtensionRange(
          request.body?.extensionRangeStart,
          request.body?.extensionRangeEnd,
        );
        if (range.start === null || range.end === null) throw new Error("Assign a client extension sub-range");
        if (range.start < reseller.extension_range_start! || range.end > reseller.extension_range_end!) {
          throw new Error("The client range must remain inside the reseller's assigned range");
        }
        maxExtensions = boundedInteger(request.body?.maxExtensions ?? 1, "Extension allowance", 1, 10_000);
        maxDids = boundedInteger(request.body?.maxDids ?? 0, "DID allowance", 0, 10_000);
        recordingStorageMb = boundedInteger(
          request.body?.recordingStorageMb ?? 0,
          "Recording allowance", 0, 1_000_000,
        );
        if (range.end - range.start + 1 < maxExtensions) {
          throw new Error("The sub-range must contain at least the extension allowance");
        }
        if (recordingStorageMb > 0 && !reseller.recording_enabled) {
          throw new Error("Call recording is not included in the reseller plan");
        }
        const totals = await delegatedTotals(user.customerId);
        if (Number(reseller.own_extensions) + totals.maxExtensions + maxExtensions > reseller.max_extensions) {
          throw new Error("The reseller does not have enough remaining extension allowance");
        }
        if (Number(reseller.own_dids) + totals.maxDids + maxDids > reseller.max_dids) {
          throw new Error("The reseller does not have enough remaining DID allowance");
        }
        if (totals.recordingStorageMb + recordingStorageMb > reseller.recording_storage_mb) {
          throw new Error("The reseller does not have enough remaining recording storage");
        }
        const overlap = await pool.query<{ name: string }>(
          `SELECT name FROM customers
            WHERE parent_customer_id=$1
              AND extension_range_start IS NOT NULL AND extension_range_end IS NOT NULL
              AND NOT ($3 < extension_range_start OR $2 > extension_range_end)
            LIMIT 1`,
          [user.customerId, range.start, range.end],
        );
        if (overlap.rows[0]) throw new Error(`That sub-range overlaps ${overlap.rows[0].name}`);
        const occupied = await pool.query<{ number: string }>(
          `SELECT extension_number AS number FROM extensions
            WHERE extension_number::integer BETWEEN $1 AND $2
           UNION ALL
           SELECT extension_number FROM ivr_menus
            WHERE extension_number::integer BETWEEN $1 AND $2
           UNION ALL
           SELECT extension_number FROM ai_receptionists
            WHERE extension_number::integer BETWEEN $1 AND $2
           UNION ALL
           SELECT extension_number FROM call_groups
            WHERE extension_number::integer BETWEEN $1 AND $2
           LIMIT 1`,
          [range.start, range.end],
        );
        if (occupied.rows[0]) {
          throw new Error(`Extension number ${occupied.rows[0].number} is already in use inside that sub-range`);
        }
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`reseller:${user.customerId}`]);
        await client.query("SELECT id FROM customers WHERE id=$1 FOR UPDATE", [user.customerId]);
        const committedTotals = await client.query<{
          max_extensions: string; max_dids: string; recording_storage_mb: string;
          own_extensions: string; own_dids: string;
        }>(
          `SELECT COALESCE(sum(plans.max_extensions),0)::text AS max_extensions,
                  COALESCE(sum(plans.max_dids),0)::text AS max_dids,
                  COALESCE(sum(plans.recording_storage_mb),0)::text AS recording_storage_mb,
                  (SELECT count(*)::text FROM customer_extensions
                    WHERE customer_id=$1) AS own_extensions,
                  (SELECT count(*)::text FROM customer_did_routes
                    WHERE customer_id=$1) AS own_dids
             FROM customers AS children
             JOIN customer_service_plans AS plans ON plans.id=children.service_plan_id
            WHERE children.parent_customer_id=$1`,
          [user.customerId],
        );
        const committed = committedTotals.rows[0]!;
        if (Number(committed.own_extensions) + Number(committed.max_extensions) + maxExtensions > reseller.max_extensions) {
          throw new Error("The reseller extension allowance changed; refresh and try again");
        }
        if (Number(committed.own_dids) + Number(committed.max_dids) + maxDids > reseller.max_dids) {
          throw new Error("The reseller DID allowance changed; refresh and try again");
        }
        if (Number(committed.recording_storage_mb) + recordingStorageMb > reseller.recording_storage_mb) {
          throw new Error("The reseller recording allowance changed; refresh and try again");
        }
        const committedOverlap = await client.query(
          `SELECT 1 FROM customers
            WHERE parent_customer_id=$1
              AND extension_range_start IS NOT NULL AND extension_range_end IS NOT NULL
              AND NOT ($3 < extension_range_start OR $2 > extension_range_end)
            LIMIT 1`,
          [user.customerId, range.start, range.end],
        );
        if (committedOverlap.rowCount) {
          throw new Error("The extension sub-range was just allocated; refresh and try again");
        }
        const committedOccupied = await client.query(
          `SELECT 1 FROM extensions
            WHERE extension_number::integer BETWEEN $1 AND $2
           UNION ALL SELECT 1 FROM ivr_menus
            WHERE extension_number::integer BETWEEN $1 AND $2
           UNION ALL SELECT 1 FROM ai_receptionists
            WHERE extension_number::integer BETWEEN $1 AND $2
           UNION ALL SELECT 1 FROM call_groups
            WHERE extension_number::integer BETWEEN $1 AND $2
           LIMIT 1`,
          [range.start, range.end],
        );
        if (committedOccupied.rowCount) {
          throw new Error("An extension number inside that sub-range was just reserved; refresh and try again");
        }
        const planName = `${customerAccountLabel(reseller.account_number)} · client · ${randomUUID().slice(0, 8)}`;
        const plan = await client.query<{ id: string }>(
          `INSERT INTO customer_service_plans
             (name, description, max_extensions, max_dids, recording_storage_mb,
              max_ai_receptionists, max_campaigns, self_service_extensions,
              recording_enabled, ai_receptionist_enabled, campaigns_enabled,
              enabled, owner_customer_id, created_by)
           VALUES ($1,$2,$3,$4,$5,0,0,true,$6,false,false,true,$7,$8)
           RETURNING id`,
          [
            planName, `Delegated by ${reseller.name}`,
            maxExtensions, maxDids, recordingStorageMb,
            recordingStorageMb > 0, user.customerId, user.id,
          ],
        );
        const inserted = await client.query<{ id: string; account_number: string }>(
          `INSERT INTO customers
             (name, billing_email, currency, account_type, billing_mode,
              credit_limit, active, service_plan_id, extension_range_start,
              extension_range_end, parent_customer_id,
              created_by_customer_user_id)
           VALUES ($1,$2,$3,'retail',$4,$5,true,$6,$7,$8,$9,$10)
           RETURNING id, account_number::text`,
          [
            identity.name, identity.billingEmail, reseller.currency,
            identity.billingMode, identity.creditLimit, plan.rows[0]!.id,
            range.start, range.end, user.customerId, user.id,
          ],
        );
        const created = inserted.rows[0]!;
        await client.query("INSERT INTO customer_wallets(customer_id) VALUES ($1)", [created.id]);
        await client.query(
          `INSERT INTO users
             (email, display_name, password_hash, role, active, customer_id)
           VALUES ($1,$2,$3,'customer_admin',true,$4)`,
          [
            identity.loginEmail, identity.loginDisplayName,
            hashPassword(identity.loginPassword), created.id,
          ],
        );
        await client.query("COMMIT");
        await audit("reseller.client.created", user.id, {
          resellerCustomerId: user.customerId,
          clientCustomerId: created.id,
          clientAccount: customerAccountLabel(created.account_number),
          extensionRangeStart: range.start,
          extensionRangeEnd: range.end,
        }, request.ip);
        return reply.code(201).send({
          id: created.id,
          accountNumber: customerAccountLabel(created.account_number),
        });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if ((error as { code?: string }).code === "23505") {
          return reply.code(409).send({ error: "That client login email is already in use" });
        }
        if (error instanceof Error && /allowance changed|just allocated|just reserved/.test(error.message)) {
          return reply.code(409).send({ error: error.message });
        }
        request.log.error({ error }, "Reseller client creation failed");
        return reply.code(500).send({ error: "The client account could not be created" });
      } finally {
        client.release();
      }
    },
  );

  app.patch<{ Params: IdParams; Body: StatusBody }>(
    "/api/customer/reseller/clients/:id/status",
    async (request, reply) => {
      const user = await requireCustomer(request, reply);
      if (!user?.customerId) return;
      if (!validUuid(request.params.id) || typeof request.body?.active !== "boolean") {
        return reply.code(400).send({ error: "Choose a valid client status" });
      }
      const result = await pool.query(
        `UPDATE customers SET active=$3, updated_at=now()
          WHERE id=$1 AND parent_customer_id=$2`,
        [request.params.id, user.customerId, request.body.active],
      );
      if (result.rowCount !== 1) return reply.code(404).send({ error: "Client not found" });
      if (!request.body.active) {
        await pool.query(
          `DELETE FROM sessions WHERE user_id IN
             (SELECT id FROM users WHERE customer_id=$1)`,
          [request.params.id],
        );
      }
      await audit("reseller.client.status", user.id, {
        resellerCustomerId: user.customerId,
        clientCustomerId: request.params.id,
        active: request.body.active,
      }, request.ip);
      return { ok: true };
    },
  );

  app.post<{ Params: IdParams; Body: PasswordBody }>(
    "/api/customer/reseller/clients/:id/reset-password",
    async (request, reply) => {
      const user = await requireCustomer(request, reply);
      if (!user?.customerId) return;
      const password = request.body?.password ?? "";
      if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Client not found" });
      if (password.length < 12) return reply.code(400).send({ error: "Password must be at least 12 characters" });
      const result = await pool.query(
        `UPDATE users SET password_hash=$3, updated_at=now()
          WHERE customer_id=$1 AND role='customer_admin'
            AND EXISTS (
              SELECT 1 FROM customers
               WHERE id=$1 AND parent_customer_id=$2
            )`,
        [request.params.id, user.customerId, hashPassword(password)],
      );
      if (result.rowCount !== 1) return reply.code(404).send({ error: "Client login not found" });
      await pool.query(
        `DELETE FROM sessions WHERE user_id IN
           (SELECT id FROM users WHERE customer_id=$1)`,
        [request.params.id],
      );
      await audit("reseller.client.password.reset", user.id, {
        resellerCustomerId: user.customerId,
        clientCustomerId: request.params.id,
      }, request.ip);
      return { ok: true };
    },
  );
}
