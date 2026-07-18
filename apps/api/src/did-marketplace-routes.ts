import type { FastifyInstance } from "fastify";
import { requireAdministrator, requireCustomer } from "./auth.js";
import { audit, pool } from "./database.js";
import {
  DidMarketplaceError,
  didInventoryValues,
  purchaseDid,
  purchaseTotal,
  type DidInventoryBody,
} from "./did-marketplace.js";

interface IdParams { id: string }
interface PurchaseBody { destinationExtensionId?: string }

interface InventoryRow {
  id: string;
  did_number: string;
  trunk_id: string;
  trunk_name: string;
  country_code: string;
  region: string;
  locality: string;
  currency: string;
  setup_price: string;
  monthly_price: string;
  status: "available" | "disabled" | "assigned";
  customer_id: string | null;
  customer_name: string | null;
  did_route_id: string | null;
  assigned_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface CatalogRow {
  id: string;
  did_number: string;
  country_code: string;
  region: string;
  locality: string;
  currency: string;
  setup_price: string;
  monthly_price: string;
}

function publicInventory(row: InventoryRow) {
  const setupPrice = Number(row.setup_price);
  const monthlyPrice = Number(row.monthly_price);
  return {
    id: row.id,
    didNumber: row.did_number,
    trunkId: row.trunk_id,
    trunkName: row.trunk_name,
    countryCode: row.country_code,
    region: row.region,
    locality: row.locality,
    currency: row.currency,
    setupPrice,
    monthlyPrice,
    dueToday: purchaseTotal(setupPrice, monthlyPrice),
    status: row.status,
    customerId: row.customer_id,
    customerName: row.customer_name,
    didRouteId: row.did_route_id,
    assignedAt: row.assigned_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function customerInventory(row: CatalogRow) {
  const setupPrice = Number(row.setup_price);
  const monthlyPrice = Number(row.monthly_price);
  return {
    id: row.id,
    didNumber: row.did_number,
    countryCode: row.country_code,
    region: row.region,
    locality: row.locality,
    currency: row.currency,
    setupPrice,
    monthlyPrice,
    dueToday: purchaseTotal(setupPrice, monthlyPrice),
  };
}

const inventoryColumns = `inventory.id, inventory.did_number, inventory.trunk_id,
  trunks.name AS trunk_name, inventory.country_code, inventory.region,
  inventory.locality, inventory.currency, inventory.setup_price::text,
  inventory.monthly_price::text, inventory.status, inventory.customer_id,
  customers.name AS customer_name, inventory.did_route_id, inventory.assigned_at,
  inventory.created_at, inventory.updated_at`;

async function inventoryById(id: string): Promise<InventoryRow | undefined> {
  const result = await pool.query<InventoryRow>(
    `SELECT ${inventoryColumns}
       FROM did_inventory AS inventory
       JOIN sip_trunks AS trunks ON trunks.id=inventory.trunk_id
       LEFT JOIN customers ON customers.id=inventory.customer_id
      WHERE inventory.id=$1`,
    [id],
  );
  return result.rows[0];
}

async function assertTrunkAndNumberAvailable(trunkId: string, didNumber: string): Promise<void> {
  const result = await pool.query<{ trunk_exists: boolean; route_exists: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM sip_trunks WHERE id=$1) AS trunk_exists,
       EXISTS (SELECT 1 FROM did_routes WHERE did_number=$2) AS route_exists`,
    [trunkId, didNumber],
  );
  if (!result.rows[0]?.trunk_exists) throw new DidMarketplaceError("The selected SIP trunk no longer exists");
  if (result.rows[0]?.route_exists) {
    throw new DidMarketplaceError("That number already has an inbound route", 409);
  }
}

async function customerMarketplace(customerId: string) {
  const [accountResult, extensionsResult, catalogResult, ownedResult] = await Promise.all([
    pool.query<{
      currency: string; billing_mode: "prepaid" | "postpaid";
      credit_limit: string; balance: string; active: boolean;
      parent_active: boolean; plan_enabled: boolean | null; max_dids: number | null;
      assigned_dids: string; delegated_dids: string;
    }>(
      `SELECT customers.currency, customers.billing_mode,
              customers.credit_limit::text, wallets.balance::text,
              customers.active, COALESCE(parent.active, true) AS parent_active,
              plans.enabled AS plan_enabled, plans.max_dids,
              (SELECT count(*)::text FROM customer_did_routes
                WHERE customer_id=customers.id) AS assigned_dids,
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
        WHERE customers.id=$1`,
      [customerId],
    ),
    pool.query<{ id: string; extension_number: string; display_name: string }>(
      `SELECT extensions.id, extensions.extension_number, extensions.display_name
         FROM customer_extensions
         JOIN extensions ON extensions.id=customer_extensions.extension_id
        WHERE customer_extensions.customer_id=$1 AND extensions.enabled=true
        ORDER BY length(extensions.extension_number), extensions.extension_number`,
      [customerId],
    ),
    pool.query<CatalogRow>(
      `SELECT inventory.id, inventory.did_number, inventory.country_code,
              inventory.region, inventory.locality, inventory.currency,
              inventory.setup_price::text, inventory.monthly_price::text
         FROM did_inventory AS inventory
         JOIN sip_trunks AS trunks ON trunks.id=inventory.trunk_id
        WHERE inventory.status='available'
          AND trunks.enabled=true
          AND NOT EXISTS (
            SELECT 1 FROM did_routes WHERE did_number=inventory.did_number
          )
          AND inventory.currency=(SELECT currency FROM customers WHERE id=$1)
        ORDER BY inventory.country_code, inventory.locality, inventory.did_number`,
      [customerId],
    ),
    pool.query<{
      purchase_id: string; inventory_id: string; did_number: string;
      country_code: string; region: string; locality: string; currency: string;
      monthly_amount: string; status: "active" | "past_due";
      next_renewal_at: Date; destination_number: string | null;
      failure_reason: string | null;
    }>(
      `SELECT purchases.id AS purchase_id, inventory.id AS inventory_id,
              inventory.did_number, inventory.country_code, inventory.region,
              inventory.locality, purchases.currency,
              purchases.monthly_amount::text, purchases.status,
              purchases.next_renewal_at, extensions.extension_number AS destination_number,
              purchases.failure_reason
         FROM did_purchases AS purchases
         JOIN did_inventory AS inventory ON inventory.id=purchases.inventory_id
         LEFT JOIN did_routes AS routes ON routes.id=purchases.did_route_id
         LEFT JOIN extensions ON extensions.id=routes.extension_id
        WHERE purchases.customer_id=$1
          AND purchases.status IN ('active','past_due')
        ORDER BY inventory.did_number`,
      [customerId],
    ),
  ]);
  const account = accountResult.rows[0];
  if (!account) throw new DidMarketplaceError("Customer account not found", 404);
  const assigned = Number(account.assigned_dids);
  const delegated = Number(account.delegated_dids);
  const maximum = account.max_dids ?? 0;
  const used = assigned + delegated;
  const remaining = Math.max(0, maximum - used);
  let unavailableReason = "";
  if (!account.active || !account.parent_active) unavailableReason = "Customer account is disabled";
  else if (!account.plan_enabled) unavailableReason = "An active service plan is required";
  else if (remaining === 0) unavailableReason = "Your DID allowance is fully used or delegated";
  else if (extensionsResult.rows.length === 0) unavailableReason = "Create or assign an enabled extension first";
  return {
    account: {
      currency: account.currency,
      billingMode: account.billing_mode,
      balance: Number(account.balance),
      creditLimit: Number(account.credit_limit),
      availableCredit: account.billing_mode === "postpaid"
        ? Number(account.balance) + Number(account.credit_limit)
        : Number(account.balance),
    },
    allowance: { maximum, assigned, delegated, used, remaining },
    purchase: { allowed: unavailableReason === "", reason: unavailableReason },
    extensions: extensionsResult.rows.map((row) => ({
      id: row.id,
      extensionNumber: row.extension_number,
      displayName: row.display_name,
    })),
    numbers: catalogResult.rows.map(customerInventory),
    ownedNumbers: ownedResult.rows.map((row) => ({
      purchaseId: row.purchase_id,
      inventoryId: row.inventory_id,
      didNumber: row.did_number,
      countryCode: row.country_code,
      region: row.region,
      locality: row.locality,
      currency: row.currency,
      monthlyPrice: Number(row.monthly_amount),
      status: row.status,
      nextRenewalAt: row.next_renewal_at,
      destinationNumber: row.destination_number,
      failureReason: row.failure_reason,
    })),
  };
}

function databaseCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null
    ? (error as { code?: string }).code
    : undefined;
}

export function registerDidMarketplaceRoutes(app: FastifyInstance): void {
  app.get("/api/did-marketplace/admin", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const [inventory, trunks] = await Promise.all([
      pool.query<InventoryRow>(
        `SELECT ${inventoryColumns}
           FROM did_inventory AS inventory
           JOIN sip_trunks AS trunks ON trunks.id=inventory.trunk_id
           LEFT JOIN customers ON customers.id=inventory.customer_id
          ORDER BY inventory.created_at DESC, inventory.did_number`,
      ),
      pool.query<{ id: string; name: string; enabled: boolean }>(
        "SELECT id, name, enabled FROM sip_trunks ORDER BY name",
      ),
    ]);
    const numbers = inventory.rows.map(publicInventory);
    return {
      numbers,
      trunks: trunks.rows,
      summary: {
        available: numbers.filter((number) => number.status === "available").length,
        assigned: numbers.filter((number) => number.status === "assigned").length,
        disabled: numbers.filter((number) => number.status === "disabled").length,
      },
    };
  });

  app.post<{ Body: DidInventoryBody }>("/api/did-marketplace/admin", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    try {
      const values = didInventoryValues(request.body ?? {});
      await assertTrunkAndNumberAvailable(values.trunkId, values.didNumber);
      const result = await pool.query<{ id: string }>(
        `INSERT INTO did_inventory
           (did_number, trunk_id, country_code, region, locality, currency,
            setup_price, monthly_price, status, listed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
        [values.didNumber, values.trunkId, values.countryCode, values.region,
          values.locality, values.currency, values.setupPrice, values.monthlyPrice,
          values.enabled ? "available" : "disabled", user.id],
      );
      const row = result.rows[0];
      if (!row) throw new Error("DID inventory insert returned no id");
      await audit("did.inventory.created", user.id, {
        inventoryId: row.id, didNumber: values.didNumber,
        setupPrice: values.setupPrice, monthlyPrice: values.monthlyPrice,
        currency: values.currency,
      }, request.ip);
      return reply.code(201).send({ number: publicInventory((await inventoryById(row.id))!) });
    } catch (error) {
      if (error instanceof DidMarketplaceError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      if (databaseCode(error) === "23505") {
        return reply.code(409).send({ error: "That number is already in inventory" });
      }
      request.log.error({ error }, "DID inventory creation failed");
      return reply.code(500).send({ error: "The number could not be added to inventory" });
    }
  });

  app.patch<{ Params: IdParams; Body: DidInventoryBody }>(
    "/api/did-marketplace/admin/:id",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const existing = await inventoryById(request.params.id);
      if (!existing) return reply.code(404).send({ error: "Inventory number not found" });
      if (existing.status === "assigned") {
        return reply.code(409).send({ error: "An assigned number cannot be edited" });
      }
      try {
        const values = didInventoryValues({
          didNumber: request.body?.didNumber ?? existing.did_number,
          trunkId: request.body?.trunkId ?? existing.trunk_id,
          countryCode: request.body?.countryCode ?? existing.country_code,
          region: request.body?.region ?? existing.region,
          locality: request.body?.locality ?? existing.locality,
          currency: request.body?.currency ?? existing.currency,
          setupPrice: request.body?.setupPrice ?? Number(existing.setup_price),
          monthlyPrice: request.body?.monthlyPrice ?? Number(existing.monthly_price),
          enabled: request.body?.enabled ?? existing.status === "available",
        });
        if (values.didNumber !== existing.did_number || values.trunkId !== existing.trunk_id) {
          await assertTrunkAndNumberAvailable(values.trunkId, values.didNumber);
        }
        await pool.query(
          `UPDATE did_inventory
              SET did_number=$2, trunk_id=$3, country_code=$4, region=$5,
                  locality=$6, currency=$7, setup_price=$8, monthly_price=$9,
                  status=$10, updated_at=now()
            WHERE id=$1`,
          [existing.id, values.didNumber, values.trunkId, values.countryCode,
            values.region, values.locality, values.currency, values.setupPrice,
            values.monthlyPrice, values.enabled ? "available" : "disabled"],
        );
        await audit("did.inventory.updated", user.id, {
          inventoryId: existing.id, didNumber: values.didNumber,
        }, request.ip);
        return { number: publicInventory((await inventoryById(existing.id))!) };
      } catch (error) {
        if (error instanceof DidMarketplaceError) {
          return reply.code(error.statusCode).send({ error: error.message });
        }
        if (databaseCode(error) === "23505") {
          return reply.code(409).send({ error: "That number is already in inventory" });
        }
        request.log.error({ error }, "DID inventory update failed");
        return reply.code(500).send({ error: "The inventory number could not be updated" });
      }
    },
  );

  app.delete<{ Params: IdParams }>("/api/did-marketplace/admin/:id", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const result = await pool.query<{ did_number: string }>(
      `DELETE FROM did_inventory AS inventory
        WHERE inventory.id=$1
          AND inventory.status IN ('available','disabled')
          AND NOT EXISTS (
            SELECT 1 FROM did_purchases WHERE inventory_id=inventory.id
          )
      RETURNING inventory.did_number`,
      [request.params.id],
    );
    const row = result.rows[0];
    if (!row) {
      return reply.code(409).send({ error: "Assigned or previously purchased numbers cannot be deleted" });
    }
    await audit("did.inventory.deleted", user.id, { didNumber: row.did_number }, request.ip);
    return reply.code(204).send();
  });

  app.get("/api/customer/did-marketplace", async (request, reply) => {
    const user = await requireCustomer(request, reply);
    if (!user?.customerId) return;
    try {
      return await customerMarketplace(user.customerId);
    } catch (error) {
      if (error instanceof DidMarketplaceError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      request.log.error({ error }, "Customer DID marketplace load failed");
      return reply.code(500).send({ error: "The number marketplace could not be loaded" });
    }
  });

  app.post<{ Params: IdParams; Body: PurchaseBody }>(
    "/api/customer/did-marketplace/:id/purchase",
    async (request, reply) => {
      const user = await requireCustomer(request, reply);
      if (!user?.customerId) return;
      try {
        const result = await purchaseDid(
          user.id,
          user.customerId,
          request.params.id,
          request.body?.destinationExtensionId ?? "",
        );
        await audit("did.purchase.completed", user.id, {
          customerId: user.customerId,
          purchaseId: result.purchaseId,
          didNumber: result.didNumber,
          destinationExtension: result.destinationExtension,
          chargedAmount: result.chargedAmount,
          currency: result.currency,
        }, request.ip).catch((error) => {
          request.log.warn({ error, purchaseId: result.purchaseId }, "DID purchase audit write failed");
        });
        return reply.code(201).send({ purchase: result });
      } catch (error) {
        if (error instanceof DidMarketplaceError) {
          return reply.code(error.statusCode).send({ error: error.message });
        }
        request.log.error({ error }, "DID marketplace purchase failed");
        return reply.code(500).send({ error: "The number purchase could not be completed" });
      }
    },
  );
}
