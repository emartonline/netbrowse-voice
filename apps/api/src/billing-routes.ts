import type { FastifyInstance } from "fastify";
import { requireAdministrator } from "./auth.js";
import {
  normalizeBillingDestination,
  parseCustomerRateImport,
  parseRateImport,
  runBillingRatingTick,
} from "./billing.js";
import { normalizeDisposition } from "./calls.js";
import { audit, pool } from "./database.js";
import { validUuid } from "./queue-agent-state.js";
import { trunkSectionName } from "./trunks.js";

interface IdParams { id: string }
interface DeckBody {
  name?: string;
  sipTrunkId?: string;
  currency?: string;
  enabled?: boolean;
}
interface ImportBody {
  rates?: string;
  replace?: boolean;
}

interface CustomerRateCardBody {
  name?: string;
  currency?: string;
  enabled?: boolean;
}

function deckValues(body: DeckBody) {
  const name = body.name?.trim() ?? "";
  const sipTrunkId = body.sipTrunkId?.trim() ?? "";
  const currency = body.currency?.trim().toUpperCase() ?? "ZAR";
  const enabled = body.enabled ?? true;
  if (name.length < 2 || name.length > 100) throw new Error("Enter a valid rate deck name");
  if (!validUuid(sipTrunkId)) throw new Error("Choose a valid SIP trunk");
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must use a three-letter code such as ZAR or USD");
  if (typeof enabled !== "boolean") throw new Error("Invalid rate deck status");
  return { name, sipTrunkId, currency, enabled };
}

function customerRateCardValues(body: CustomerRateCardBody) {
  const name = body.name?.trim() ?? "";
  const currency = body.currency?.trim().toUpperCase() ?? "ZAR";
  const enabled = body.enabled ?? true;
  if (name.length < 2 || name.length > 100) throw new Error("Enter a valid customer rate card name");
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must use a three-letter code such as ZAR or USD");
  if (typeof enabled !== "boolean") throw new Error("Invalid customer rate card status");
  return { name, currency, enabled };
}

async function trunkAvailable(id: string): Promise<boolean> {
  const result = await pool.query<{ available: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM sip_trunks WHERE id=$1) AS available",
    [id],
  );
  return result.rows[0]?.available ?? false;
}

function databaseError(error: unknown): { code?: string } {
  return typeof error === "object" && error !== null ? error as { code?: string } : {};
}

export function registerBillingRoutes(app: FastifyInstance): void {
  app.get("/api/billing", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const rating = await runBillingRatingTick(request.log).catch((error) => {
      request.log.warn({ error }, "On-demand call rating failed");
      return { scanned: 0, rated: 0, unmatched: 0 };
    });
    const [decks, rates, customerRateCards, customerRates, charges, summaries, trunks, attempts] = await Promise.all([
      pool.query<{
        id: string;
        name: string;
        sip_trunk_id: string;
        trunk_name: string;
        dial_prefix: string;
        currency: string;
        enabled: boolean;
        rate_count: string;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT decks.id, decks.name, decks.sip_trunk_id,
                trunks.name AS trunk_name, trunks.dial_prefix,
                decks.currency, decks.enabled,
                count(rates.id)::text AS rate_count,
                decks.created_at, decks.updated_at
           FROM billing_rate_decks AS decks
           JOIN sip_trunks AS trunks ON trunks.id = decks.sip_trunk_id
           LEFT JOIN billing_rates AS rates ON rates.rate_deck_id = decks.id
          GROUP BY decks.id, trunks.name, trunks.dial_prefix
          ORDER BY decks.created_at`,
      ),
      pool.query<{
        id: string;
        rate_deck_id: string;
        prefix: string;
        destination_name: string;
        cost_per_minute: string;
        sell_per_minute: string;
        billing_increment_seconds: number;
        minimum_seconds: number;
      }>(
        `SELECT id::text, rate_deck_id, prefix, destination_name,
                cost_per_minute::text, sell_per_minute::text,
                billing_increment_seconds, minimum_seconds
           FROM billing_rates
          WHERE enabled = true
          ORDER BY rate_deck_id, length(prefix) DESC, prefix
          LIMIT 2000`,
      ),
      pool.query<{
        id: string;
        name: string;
        currency: string;
        enabled: boolean;
        rate_count: string;
        assigned_customer_count: string;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT cards.id, cards.name, cards.currency, cards.enabled,
                count(DISTINCT rates.id)::text AS rate_count,
                count(DISTINCT customers.id)::text AS assigned_customer_count,
                cards.created_at, cards.updated_at
           FROM customer_rate_cards AS cards
           LEFT JOIN customer_rate_card_rates AS rates ON rates.rate_card_id = cards.id
           LEFT JOIN customers ON customers.customer_rate_card_id = cards.id
          GROUP BY cards.id
          ORDER BY cards.created_at, cards.name`,
      ),
      pool.query<{
        id: string;
        rate_card_id: string;
        prefix: string;
        destination_name: string;
        price_per_minute: string;
        billing_increment_seconds: number;
        minimum_seconds: number;
      }>(
        `SELECT id::text, rate_card_id, prefix, destination_name,
                price_per_minute::text, billing_increment_seconds, minimum_seconds
           FROM customer_rate_card_rates
          WHERE enabled = true
          ORDER BY rate_card_id, length(prefix) DESC, prefix
          LIMIT 5000`,
      ),
      pool.query<{
        id: string;
        call_started_at: Date;
        source: string;
        destination: string;
        destination_name: string;
        trunk_name: string | null;
        original_billsec: number;
        charged_seconds: number;
        cost_amount: string;
        sell_amount: string;
        margin_amount: string;
        currency: string;
      }>(
        `SELECT charges.id::text, charges.call_started_at, records.src AS source,
                charges.destination, charges.destination_name,
                trunks.name AS trunk_name, charges.original_billsec,
                charges.charged_seconds, charges.cost_amount::text,
                charges.sell_amount::text, charges.margin_amount::text,
                charges.currency
           FROM billing_call_charges AS charges
           JOIN call_detail_records AS records ON records.id = charges.cdr_id
           LEFT JOIN sip_trunks AS trunks ON trunks.id = charges.sip_trunk_id
          ORDER BY charges.call_started_at DESC, charges.id DESC
          LIMIT 100`,
      ),
      pool.query<{
        currency: string;
        today_cost: string;
        today_revenue: string;
        today_margin: string;
        month_cost: string;
        month_revenue: string;
        month_margin: string;
        rated_calls: string;
      }>(
        `SELECT currency,
                COALESCE(sum(cost_amount) FILTER (
                  WHERE call_started_at >= date_trunc('day', now())
                ), 0)::text AS today_cost,
                COALESCE(sum(sell_amount) FILTER (
                  WHERE call_started_at >= date_trunc('day', now())
                ), 0)::text AS today_revenue,
                COALESCE(sum(margin_amount) FILTER (
                  WHERE call_started_at >= date_trunc('day', now())
                ), 0)::text AS today_margin,
                COALESCE(sum(cost_amount) FILTER (
                  WHERE call_started_at >= date_trunc('month', now())
                ), 0)::text AS month_cost,
                COALESCE(sum(sell_amount) FILTER (
                  WHERE call_started_at >= date_trunc('month', now())
                ), 0)::text AS month_revenue,
                COALESCE(sum(margin_amount) FILTER (
                  WHERE call_started_at >= date_trunc('month', now())
                ), 0)::text AS month_margin,
                count(*)::text AS rated_calls
           FROM billing_call_charges
          GROUP BY currency
          ORDER BY currency`,
      ),
      pool.query<{ id: string; name: string; enabled: boolean; dial_prefix: string }>(
        "SELECT id, name, enabled, dial_prefix FROM sip_trunks ORDER BY name",
      ),
      pool.query<{
        id: string;
        calldate: Date;
        src: string;
        dst: string;
        dcontext: string;
        channel: string;
        dstchannel: string;
        lastdata: string;
        duration: number;
        billsec: number;
        disposition: string;
        peeraccount: string;
        call_key: string;
        charge_id: string | null;
        charged_destination: string | null;
        cost_amount: string | null;
        sell_amount: string | null;
        margin_amount: string | null;
        currency: string | null;
        charged_seconds: number | null;
      }>(
        `WITH outbound_legs AS (
           SELECT records.*,
                  COALESCE(
                    NULLIF(records.linkedid, ''), NULLIF(records.uniqueid, ''),
                    'cdr:' || records.id::text
                  ) AS call_key,
                  row_number() OVER (
                    PARTITION BY COALESCE(
                      NULLIF(records.linkedid, ''), NULLIF(records.uniqueid, ''),
                      'cdr:' || records.id::text
                    )
                    ORDER BY
                      CASE
                        WHEN charges.cdr_id = records.id THEN 0
                        WHEN upper(COALESCE(records.peeraccount, '')) LIKE 'NBVOICE:%' THEN 1
                        WHEN records.lastdata ~* '^PJSIP/\\+?[0-9]{8,21}@nbvt-' THEN 2
                        WHEN records.dcontext LIKE 'nbvoice-outbound-%' THEN 3
                        ELSE 4
                      END,
                      records.sequence DESC,
                      records.id DESC
                  ) AS leg_rank
             FROM call_detail_records AS records
             LEFT JOIN billing_call_charges AS charges
               ON charges.call_key = COALESCE(
                 NULLIF(records.linkedid, ''), NULLIF(records.uniqueid, ''),
                 'cdr:' || records.id::text
               )
            WHERE records.calldate >= now() - interval '90 days'
              AND (
                records.dcontext LIKE 'nbvoice-outbound-%'
                OR records.dcontext = 'nbvoice-campaign-originate'
                OR records.lastdata ~* '^PJSIP/\\+?[0-9]{8,21}@nbvt-'
              )
         )
         SELECT records.id::text, records.calldate, records.src, records.dst,
                records.dcontext, records.channel, records.dstchannel,
                records.lastdata, records.duration, records.billsec,
                records.disposition, records.peeraccount, records.call_key,
                charges.id::text AS charge_id,
                charges.destination AS charged_destination,
                charges.cost_amount::text, charges.sell_amount::text,
                charges.margin_amount::text, charges.currency,
                charges.charged_seconds
           FROM outbound_legs AS records
           LEFT JOIN billing_call_charges AS charges
             ON charges.call_key = records.call_key
          WHERE records.leg_rank = 1
          ORDER BY records.calldate DESC, records.id DESC
          LIMIT 100`,
      ),
    ]);
    const attemptRows = attempts.rows.map((row) => {
      const evidence = [row.dcontext, row.channel, row.dstchannel, row.lastdata].join(" ");
      const trunk = trunks.rows.find((item) => evidence.includes(trunkSectionName(item.id)));
      const deck = trunk ? decks.rows.find((item) => item.sip_trunk_id === trunk.id) : undefined;
      const providerNumber = row.lastdata.match(/PJSIP\/(\+?[0-9]{8,21})@nbvt-/i)?.[1];
      const normalizedDestination = normalizeBillingDestination(
        providerNumber ?? row.dst,
        trunk?.dial_prefix ?? deck?.dial_prefix ?? "",
      );
      const status = normalizeDisposition(
        row.disposition,
        row.peeraccount,
        Number(row.duration),
        row.dcontext,
      );
      const dialStatus = row.peeraccount.match(/^NBVOICE:([A-Z_]{2,32})$/i)?.[1]?.toUpperCase() ?? null;
      const billingState = row.charge_id
        ? "rated"
        : status === "answered" ? "unmatched_rate" : "not_chargeable";
      const billingReason = billingState === "rated"
        ? "Rated"
        : dialStatus === "BILLING_BLOCKED"
          ? "Blocked by customer credit control"
        : billingState === "unmatched_rate"
          ? "No matching enabled rate"
          : status === "failed"
            ? "Failed before answer"
            : status === "busy"
              ? "Destination busy"
              : status === "missed"
                ? "Not answered"
                : "Not chargeable";
      return {
        id: row.id,
        callStartedAt: row.calldate,
        source: row.src || "Unknown",
        destination: row.charged_destination ?? normalizedDestination ?? (row.dst || "Unknown"),
        trunkName: trunk?.name ?? "Unknown trunk",
        status,
        dialStatus,
        billingState,
        billingReason,
        originalBillsec: Math.max(0, Number(row.billsec)),
        chargedSeconds: Math.max(0, Number(row.charged_seconds ?? 0)),
        costAmount: Number(row.cost_amount ?? 0),
        sellAmount: Number(row.sell_amount ?? 0),
        marginAmount: Number(row.margin_amount ?? 0),
        currency: row.currency ?? deck?.currency ?? null,
      };
    });
    return {
      decks: decks.rows.map((row) => ({
        id: row.id,
        name: row.name,
        sipTrunkId: row.sip_trunk_id,
        trunkName: row.trunk_name,
        currency: row.currency,
        enabled: row.enabled,
        rateCount: Number(row.rate_count),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      rates: rates.rows.map((row) => ({
        id: row.id,
        rateDeckId: row.rate_deck_id,
        prefix: row.prefix,
        destinationName: row.destination_name,
        costPerMinute: Number(row.cost_per_minute),
        sellPerMinute: Number(row.sell_per_minute),
        billingIncrementSeconds: row.billing_increment_seconds,
        minimumSeconds: row.minimum_seconds,
      })),
      customerRateCards: customerRateCards.rows.map((row) => ({
        id: row.id,
        name: row.name,
        currency: row.currency,
        enabled: row.enabled,
        rateCount: Number(row.rate_count),
        assignedCustomerCount: Number(row.assigned_customer_count),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      customerRates: customerRates.rows.map((row) => ({
        id: row.id,
        rateCardId: row.rate_card_id,
        prefix: row.prefix,
        destinationName: row.destination_name,
        pricePerMinute: Number(row.price_per_minute),
        billingIncrementSeconds: row.billing_increment_seconds,
        minimumSeconds: row.minimum_seconds,
      })),
      charges: charges.rows.map((row) => ({
        id: row.id,
        callStartedAt: row.call_started_at,
        source: row.source,
        destination: row.destination,
        destinationName: row.destination_name,
        trunkName: row.trunk_name ?? "Deleted trunk",
        originalBillsec: row.original_billsec,
        chargedSeconds: row.charged_seconds,
        costAmount: Number(row.cost_amount),
        sellAmount: Number(row.sell_amount),
        marginAmount: Number(row.margin_amount),
        currency: row.currency,
      })),
      attempts: attemptRows,
      summaries: summaries.rows.map((row) => ({
        currency: row.currency,
        todayCost: Number(row.today_cost),
        todayRevenue: Number(row.today_revenue),
        todayMargin: Number(row.today_margin),
        monthCost: Number(row.month_cost),
        monthRevenue: Number(row.month_revenue),
        monthMargin: Number(row.month_margin),
        ratedCalls: Number(row.rated_calls),
      })),
      rating,
      trunks: trunks.rows.map((row) => ({ id: row.id, name: row.name, enabled: row.enabled })),
    };
  });

  app.post<{ Body: DeckBody }>("/api/billing/rate-decks", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    try {
      const values = deckValues(request.body ?? {});
      if (!await trunkAvailable(values.sipTrunkId)) {
        return reply.code(404).send({ error: "SIP trunk not found" });
      }
      const result = await pool.query<{ id: string }>(
        `INSERT INTO billing_rate_decks
           (name, sip_trunk_id, currency, enabled, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [values.name, values.sipTrunkId, values.currency, values.enabled, user.id],
      );
      const id = result.rows[0]?.id;
      await audit("billing.rate_deck.created", user.id, { rateDeckId: id }, request.ip);
      return reply.code(201).send({ id });
    } catch (error) {
      if (databaseError(error).code === "23505") {
        return reply.code(409).send({ error: "That SIP trunk already has a rate deck" });
      }
      const message = error instanceof Error ? error.message : "The rate deck could not be created";
      return reply.code(400).send({ error: message });
    }
  });

  app.patch<{ Params: IdParams; Body: DeckBody }>(
    "/api/billing/rate-decks/:id",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Rate deck not found" });
      try {
        const values = deckValues(request.body ?? {});
        if (!await trunkAvailable(values.sipTrunkId)) {
          return reply.code(404).send({ error: "SIP trunk not found" });
        }
        const result = await pool.query(
          `UPDATE billing_rate_decks
              SET name=$2, sip_trunk_id=$3, currency=$4, enabled=$5, updated_at=now()
            WHERE id=$1`,
          [request.params.id, values.name, values.sipTrunkId, values.currency, values.enabled],
        );
        if (result.rowCount !== 1) return reply.code(404).send({ error: "Rate deck not found" });
        await audit("billing.rate_deck.updated", user.id, { rateDeckId: request.params.id }, request.ip);
        return { ok: true };
      } catch (error) {
        if (databaseError(error).code === "23505") {
          return reply.code(409).send({ error: "That SIP trunk already has a rate deck" });
        }
        const message = error instanceof Error ? error.message : "The rate deck could not be updated";
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.delete<{ Params: IdParams }>("/api/billing/rate-decks/:id", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Rate deck not found" });
    const result = await pool.query("DELETE FROM billing_rate_decks WHERE id=$1", [request.params.id]);
    if (result.rowCount !== 1) return reply.code(404).send({ error: "Rate deck not found" });
    await audit("billing.rate_deck.deleted", user.id, { rateDeckId: request.params.id }, request.ip);
    return reply.code(204).send();
  });

  app.post<{ Params: IdParams; Body: ImportBody }>(
    "/api/billing/rate-decks/:id/rates/import",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Rate deck not found" });
      const deck = await pool.query("SELECT id FROM billing_rate_decks WHERE id=$1", [request.params.id]);
      if (deck.rowCount !== 1) return reply.code(404).send({ error: "Rate deck not found" });
      const parsed = parseRateImport(request.body?.rates ?? "");
      if (parsed.rates.length === 0) {
        return reply.code(400).send({ error: "No valid rate rows were found" });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (request.body?.replace !== false) {
          await client.query("DELETE FROM billing_rates WHERE rate_deck_id=$1", [request.params.id]);
        }
        const inserted = await client.query(
          `INSERT INTO billing_rates
             (rate_deck_id, prefix, destination_name, cost_per_minute,
              sell_per_minute, billing_increment_seconds, minimum_seconds)
           SELECT $1, imported.prefix, imported.destination_name,
                  imported.cost_per_minute, imported.sell_per_minute,
                  imported.increment_seconds, imported.minimum_seconds
             FROM unnest(
               $2::text[], $3::text[], $4::numeric[], $5::numeric[],
               $6::integer[], $7::integer[]
             ) AS imported(
               prefix, destination_name, cost_per_minute, sell_per_minute,
               increment_seconds, minimum_seconds
             )
           ON CONFLICT (rate_deck_id, prefix) DO UPDATE SET
             destination_name=EXCLUDED.destination_name,
             cost_per_minute=EXCLUDED.cost_per_minute,
             sell_per_minute=EXCLUDED.sell_per_minute,
             billing_increment_seconds=EXCLUDED.billing_increment_seconds,
             minimum_seconds=EXCLUDED.minimum_seconds,
             enabled=true,
             updated_at=now()`,
          [
            request.params.id,
            parsed.rates.map((rate) => rate.prefix),
            parsed.rates.map((rate) => rate.destinationName),
            parsed.rates.map((rate) => rate.costPerMinute),
            parsed.rates.map((rate) => rate.sellPerMinute),
            parsed.rates.map((rate) => rate.billingIncrementSeconds),
            parsed.rates.map((rate) => rate.minimumSeconds),
          ],
        );
        await client.query(
          "UPDATE billing_rate_decks SET updated_at=now() WHERE id=$1",
          [request.params.id],
        );
        await client.query("COMMIT");
        await audit("billing.rates.imported", user.id, {
          rateDeckId: request.params.id,
          inserted: inserted.rowCount,
          invalid: parsed.invalidLines,
          duplicates: parsed.duplicateLines,
        }, request.ip);
        return {
          inserted: inserted.rowCount ?? parsed.rates.length,
          invalid: parsed.invalidLines,
          duplicates: parsed.duplicateLines,
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        request.log.error({ error }, "Rate import failed");
        return reply.code(500).send({ error: "The rate deck import failed" });
      } finally {
        client.release();
      }
    },
  );

  app.post<{ Body: CustomerRateCardBody }>(
    "/api/billing/customer-rate-cards",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      try {
        const values = customerRateCardValues(request.body ?? {});
        const result = await pool.query<{ id: string }>(
          `INSERT INTO customer_rate_cards (name, currency, enabled, created_by)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [values.name, values.currency, values.enabled, user.id],
        );
        const id = result.rows[0]?.id;
        await audit("billing.customer_rate_card.created", user.id, { customerRateCardId: id }, request.ip);
        return reply.code(201).send({ id });
      } catch (error) {
        const message = error instanceof Error ? error.message : "The customer rate card could not be created";
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.patch<{ Params: IdParams; Body: CustomerRateCardBody }>(
    "/api/billing/customer-rate-cards/:id",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Customer rate card not found" });
      try {
        const values = customerRateCardValues(request.body ?? {});
        const incompatibleCustomers = await pool.query<{ assigned: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM customers
              WHERE customer_rate_card_id = $1 AND currency <> $2
           ) AS assigned`,
          [request.params.id, values.currency],
        );
        if (incompatibleCustomers.rows[0]?.assigned) {
          return reply.code(409).send({
            error: "Move assigned customers to a matching rate card before changing this currency",
          });
        }
        const result = await pool.query(
          `UPDATE customer_rate_cards
              SET name=$2, currency=$3, enabled=$4, updated_at=now()
            WHERE id=$1`,
          [request.params.id, values.name, values.currency, values.enabled],
        );
        if (result.rowCount !== 1) return reply.code(404).send({ error: "Customer rate card not found" });
        await audit("billing.customer_rate_card.updated", user.id, {
          customerRateCardId: request.params.id,
        }, request.ip);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "The customer rate card could not be updated";
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.delete<{ Params: IdParams }>(
    "/api/billing/customer-rate-cards/:id",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Customer rate card not found" });
      const assigned = await pool.query<{ assigned: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM customers WHERE customer_rate_card_id=$1) AS assigned",
        [request.params.id],
      );
      if (assigned.rows[0]?.assigned) {
        return reply.code(409).send({ error: "Move assigned customers to another rate card before deleting this one" });
      }
      const result = await pool.query("DELETE FROM customer_rate_cards WHERE id=$1", [request.params.id]);
      if (result.rowCount !== 1) return reply.code(404).send({ error: "Customer rate card not found" });
      await audit("billing.customer_rate_card.deleted", user.id, {
        customerRateCardId: request.params.id,
      }, request.ip);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: IdParams; Body: ImportBody }>(
    "/api/billing/customer-rate-cards/:id/rates/import",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Customer rate card not found" });
      const card = await pool.query("SELECT id FROM customer_rate_cards WHERE id=$1", [request.params.id]);
      if (card.rowCount !== 1) return reply.code(404).send({ error: "Customer rate card not found" });
      const parsed = parseCustomerRateImport(request.body?.rates ?? "");
      if (parsed.rates.length === 0) return reply.code(400).send({ error: "No valid customer rate rows were found" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (request.body?.replace !== false) {
          await client.query("DELETE FROM customer_rate_card_rates WHERE rate_card_id=$1", [request.params.id]);
        }
        const inserted = await client.query(
          `INSERT INTO customer_rate_card_rates
             (rate_card_id, prefix, destination_name, price_per_minute,
              billing_increment_seconds, minimum_seconds)
           SELECT $1, imported.prefix, imported.destination_name,
                  imported.price_per_minute, imported.increment_seconds, imported.minimum_seconds
             FROM unnest(
               $2::text[], $3::text[], $4::numeric[], $5::integer[], $6::integer[]
             ) AS imported(
               prefix, destination_name, price_per_minute, increment_seconds, minimum_seconds
             )
           ON CONFLICT (rate_card_id, prefix) DO UPDATE SET
             destination_name=EXCLUDED.destination_name,
             price_per_minute=EXCLUDED.price_per_minute,
             billing_increment_seconds=EXCLUDED.billing_increment_seconds,
             minimum_seconds=EXCLUDED.minimum_seconds,
             enabled=true,
             updated_at=now()`,
          [
            request.params.id,
            parsed.rates.map((rate) => rate.prefix),
            parsed.rates.map((rate) => rate.destinationName),
            parsed.rates.map((rate) => rate.pricePerMinute),
            parsed.rates.map((rate) => rate.billingIncrementSeconds),
            parsed.rates.map((rate) => rate.minimumSeconds),
          ],
        );
        await client.query("UPDATE customer_rate_cards SET updated_at=now() WHERE id=$1", [request.params.id]);
        await client.query("COMMIT");
        await audit("billing.customer_rates.imported", user.id, {
          customerRateCardId: request.params.id,
          inserted: inserted.rowCount,
          invalid: parsed.invalidLines,
          duplicates: parsed.duplicateLines,
        }, request.ip);
        return {
          inserted: inserted.rowCount ?? parsed.rates.length,
          invalid: parsed.invalidLines,
          duplicates: parsed.duplicateLines,
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        request.log.error({ error }, "Customer rate import failed");
        return reply.code(500).send({ error: "The customer rate card import failed" });
      } finally {
        client.release();
      }
    },
  );

  app.post("/api/billing/rate-now", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const result = await runBillingRatingTick(request.log);
    await audit("billing.rating.requested", user.id, result, request.ip);
    return result;
  });
}
