import type { FastifyBaseLogger } from "fastify";
import type { PoolClient } from "pg";
import { parseCsvLine } from "./campaigns.js";
import { pool } from "./database.js";
import { trunkSectionName } from "./trunks.js";

export interface ImportedRate {
  prefix: string;
  destinationName: string;
  costPerMinute: number;
  sellPerMinute: number;
  billingIncrementSeconds: number;
  minimumSeconds: number;
}

export interface RateImportResult {
  rates: ImportedRate[];
  invalidLines: number;
  duplicateLines: number;
  totalLines: number;
}

export interface ImportedCustomerRate {
  prefix: string;
  destinationName: string;
  pricePerMinute: number;
  billingIncrementSeconds: number;
  minimumSeconds: number;
}

export interface CustomerRateImportResult {
  rates: ImportedCustomerRate[];
  invalidLines: number;
  duplicateLines: number;
  totalLines: number;
}

export interface BillableRate {
  id: string;
  prefix: string;
  destinationName: string;
  costPerMinute: number;
  sellPerMinute: number;
  billingIncrementSeconds: number;
  minimumSeconds: number;
}

interface RatingDeck {
  id: string;
  sipTrunkId: string;
  currency: string;
  dialPrefix: string;
  rates: BillableRate[];
}

export interface CustomerPriceRate {
  id: string;
  prefix: string;
  destinationName: string;
  pricePerMinute: number;
  billingIncrementSeconds: number;
  minimumSeconds: number;
}

interface CustomerPricingCard {
  id: string;
  currency: string;
  rates: CustomerPriceRate[];
}

interface BillableCdr {
  id: string;
  calldate: Date;
  dst: string;
  dcontext: string;
  channel: string;
  dstchannel: string;
  lastdata: string;
  billsec: number;
  uniqueid: string;
  linkedid: string;
  customer_id: string | null;
}

export interface BillingAuthorizationRequest {
  routeId: string;
  extension: string;
  destination: string;
}

export type BillingAuthorizationReason =
  | "authorized"
  | "unassigned_extension"
  | "invalid_extension"
  | "customer_disabled"
  | "rate_unavailable"
  | "currency_mismatch"
  | "insufficient_credit";

export interface BillingAuthorizationDecision {
  allowed: boolean;
  reason: BillingAuthorizationReason;
  customerId: string | null;
  availableCredit: number | null;
}

interface AgiCommandTarget {
  command(value: string): Promise<number>;
}

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export function billingAuthorizationFromAgiEnvironment(
  environment: Record<string, string>,
): BillingAuthorizationRequest | undefined {
  const script = environment.agi_network_script ?? environment.agi_request ?? "";
  const match = script.match(new RegExp(
    `(?:^|/)billing-authorize/(${UUID_PATTERN})/([0-9]{2,8})/([1-9][0-9]{7,20})(?:$|\\?)`,
    "i",
  ));
  return match?.[1] && match[2] && match[3]
    ? {
        routeId: match[1].toLowerCase(),
        extension: match[2],
        destination: match[3],
      }
    : undefined;
}

export function availableCustomerCredit(
  billingMode: "prepaid" | "postpaid",
  balance: number,
  creditLimit: number,
): number {
  const available = billingMode === "postpaid" ? balance + creditLimit : balance;
  return Math.round(available * 1_000_000) / 1_000_000;
}

function decimal(value: string | undefined): number | null {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(value)) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 && result <= 10_000 ? result : null;
}

function integer(value: string | undefined, fallback: number, minimum: number, maximum: number): number | null {
  if (value === undefined || value === "") return fallback;
  if (!/^[0-9]+$/.test(value)) return null;
  const result = Number(value);
  return Number.isInteger(result) && result >= minimum && result <= maximum ? result : null;
}

export function parseRateImport(input: string, maximum = 5_000): RateImportResult {
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rates: ImportedRate[] = [];
  const seen = new Set<string>();
  let invalidLines = 0;
  let duplicateLines = 0;
  let totalLines = 0;

  for (const [index, line] of lines.entries()) {
    const fields = parseCsvLine(line);
    if (index === 0 && fields?.[0] && /^(prefix|dial_prefix)$/i.test(fields[0])) continue;
    totalLines += 1;
    if (totalLines > maximum || !fields || fields.length > 6) {
      invalidLines += 1;
      continue;
    }
    const prefix = fields[0] ?? "";
    const cost = decimal(fields[2]);
    const legacySixColumnFormat = fields.length >= 6;
    const sell = legacySixColumnFormat ? decimal(fields[3]) : cost;
    const increment = integer(fields[legacySixColumnFormat ? 4 : 3], 60, 1, 3_600);
    const minimum = integer(fields[legacySixColumnFormat ? 5 : 4], 0, 0, 3_600);
    if (!/^[0-9]{1,15}$/.test(prefix) || cost === null || sell === null || increment === null || minimum === null) {
      invalidLines += 1;
      continue;
    }
    if (seen.has(prefix)) {
      duplicateLines += 1;
      continue;
    }
    seen.add(prefix);
    rates.push({
      prefix,
      destinationName: (fields[1] ?? "").slice(0, 120),
      costPerMinute: cost,
      sellPerMinute: sell,
      billingIncrementSeconds: increment,
      minimumSeconds: minimum,
    });
  }
  return { rates, invalidLines, duplicateLines, totalLines };
}

export function parseCustomerRateImport(input: string, maximum = 5_000): CustomerRateImportResult {
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rates: ImportedCustomerRate[] = [];
  const seen = new Set<string>();
  let invalidLines = 0;
  let duplicateLines = 0;
  let totalLines = 0;

  for (const [index, line] of lines.entries()) {
    const fields = parseCsvLine(line);
    if (index === 0 && fields?.[0] && /^(prefix|dial_prefix)$/i.test(fields[0])) continue;
    totalLines += 1;
    if (totalLines > maximum || !fields || fields.length > 5) {
      invalidLines += 1;
      continue;
    }
    const prefix = fields[0] ?? "";
    const price = decimal(fields[2]);
    const increment = integer(fields[3], 60, 1, 3_600);
    const minimum = integer(fields[4], 0, 0, 3_600);
    if (!/^[0-9]{1,15}$/.test(prefix) || price === null || increment === null || minimum === null) {
      invalidLines += 1;
      continue;
    }
    if (seen.has(prefix)) {
      duplicateLines += 1;
      continue;
    }
    seen.add(prefix);
    rates.push({
      prefix,
      destinationName: (fields[1] ?? "").slice(0, 120),
      pricePerMinute: price,
      billingIncrementSeconds: increment,
      minimumSeconds: minimum,
    });
  }
  return { rates, invalidLines, duplicateLines, totalLines };
}

export function normalizeBillingDestination(value: string, dialPrefix = ""): string | null {
  const compact = value.trim().replace(/[\s().-]/g, "");
  let digits = compact.startsWith("+") ? compact.slice(1) : compact;
  if (dialPrefix && digits.startsWith(dialPrefix) && digits.length - dialPrefix.length >= 8) {
    digits = digits.slice(dialPrefix.length);
  } else if (digits.startsWith("00") && digits.length > 9) {
    digits = digits.slice(2);
  }
  return /^[1-9][0-9]{7,20}$/.test(digits) ? digits : null;
}

export function longestPrefixRate<T extends { prefix: string }>(destination: string, rates: T[]): T | undefined {
  return rates
    .filter((rate) => destination.startsWith(rate.prefix))
    .sort((left, right) => right.prefix.length - left.prefix.length)[0];
}

export function roundedBillingSeconds(
  billsec: number,
  incrementSeconds: number,
  minimumSeconds: number,
): number {
  if (!Number.isFinite(billsec) || billsec <= 0) return 0;
  const increment = Math.max(1, Math.trunc(incrementSeconds));
  const minimum = Math.max(0, Math.trunc(minimumSeconds));
  return Math.max(minimum, Math.ceil(Math.trunc(billsec) / increment) * increment);
}

export function ratedAmounts(chargedSeconds: number, costPerMinute: number, sellPerMinute: number) {
  const factor = chargedSeconds / 60;
  const cost = Math.round(factor * costPerMinute * 1_000_000) / 1_000_000;
  const sell = Math.round(factor * sellPerMinute * 1_000_000) / 1_000_000;
  return {
    cost,
    sell,
    margin: Math.round((sell - cost) * 1_000_000) / 1_000_000,
  };
}

export function splitRatedAmounts(
  costChargedSeconds: number,
  costPerMinute: number,
  sellChargedSeconds: number,
  sellPerMinute: number,
) {
  const cost = Math.round((costChargedSeconds / 60) * costPerMinute * 1_000_000) / 1_000_000;
  const sell = Math.round((sellChargedSeconds / 60) * sellPerMinute * 1_000_000) / 1_000_000;
  return {
    cost,
    sell,
    margin: Math.round((sell - cost) * 1_000_000) / 1_000_000,
  };
}

function extractDestination(cdr: BillableCdr, deck: RatingDeck): string | null {
  const section = trunkSectionName(deck.sipTrunkId);
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const providerDial = cdr.lastdata.match(new RegExp(`PJSIP/(\\+?[0-9]{8,21})@${escaped}`, "i"))?.[1];
  if (providerDial) return normalizeBillingDestination(providerDial, deck.dialPrefix);
  if (cdr.dcontext.startsWith("nbvoice-outbound-")) {
    return normalizeBillingDestination(cdr.dst, deck.dialPrefix);
  }
  return null;
}

async function enabledDecks(): Promise<RatingDeck[]> {
  const result = await pool.query<{
    deck_id: string;
    sip_trunk_id: string;
    currency: string;
    dial_prefix: string;
    rate_id: string | null;
    prefix: string | null;
    destination_name: string | null;
    cost_per_minute: string | null;
    sell_per_minute: string | null;
    billing_increment_seconds: number | null;
    minimum_seconds: number | null;
  }>(
    `SELECT decks.id AS deck_id, decks.sip_trunk_id, decks.currency,
            trunks.dial_prefix, rates.id::text AS rate_id, rates.prefix,
            rates.destination_name, rates.cost_per_minute::text,
            rates.sell_per_minute::text, rates.billing_increment_seconds,
            rates.minimum_seconds
       FROM billing_rate_decks AS decks
       JOIN sip_trunks AS trunks ON trunks.id = decks.sip_trunk_id
       LEFT JOIN billing_rates AS rates
         ON rates.rate_deck_id = decks.id AND rates.enabled = true
      WHERE decks.enabled = true AND trunks.enabled = true
      ORDER BY decks.id, length(rates.prefix) DESC NULLS LAST`,
  );
  const decks = new Map<string, RatingDeck>();
  for (const row of result.rows) {
    const deck = decks.get(row.deck_id) ?? {
      id: row.deck_id,
      sipTrunkId: row.sip_trunk_id,
      currency: row.currency,
      dialPrefix: row.dial_prefix,
      rates: [],
    };
    if (row.rate_id && row.prefix) {
      deck.rates.push({
        id: row.rate_id,
        prefix: row.prefix,
        destinationName: row.destination_name ?? "",
        costPerMinute: Number(row.cost_per_minute ?? 0),
        sellPerMinute: Number(row.sell_per_minute ?? 0),
        billingIncrementSeconds: Number(row.billing_increment_seconds ?? 60),
        minimumSeconds: Number(row.minimum_seconds ?? 0),
      });
    }
    decks.set(row.deck_id, deck);
  }
  return [...decks.values()];
}

async function enabledCustomerRateCards(): Promise<CustomerPricingCard[]> {
  const result = await pool.query<{
    card_id: string;
    currency: string;
    rate_id: string | null;
    prefix: string | null;
    destination_name: string | null;
    price_per_minute: string | null;
    billing_increment_seconds: number | null;
    minimum_seconds: number | null;
  }>(
    `SELECT cards.id AS card_id, cards.currency, rates.id::text AS rate_id,
            rates.prefix, rates.destination_name, rates.price_per_minute::text,
            rates.billing_increment_seconds, rates.minimum_seconds
       FROM customer_rate_cards AS cards
       LEFT JOIN customer_rate_card_rates AS rates
         ON rates.rate_card_id = cards.id AND rates.enabled = true
      WHERE cards.enabled = true
      ORDER BY cards.id, length(rates.prefix) DESC NULLS LAST`,
  );
  const cards = new Map<string, CustomerPricingCard>();
  for (const row of result.rows) {
    const card = cards.get(row.card_id) ?? {
      id: row.card_id,
      currency: row.currency,
      rates: [],
    };
    if (row.rate_id && row.prefix) {
      card.rates.push({
        id: row.rate_id,
        prefix: row.prefix,
        destinationName: row.destination_name ?? "",
        pricePerMinute: Number(row.price_per_minute ?? 0),
        billingIncrementSeconds: Number(row.billing_increment_seconds ?? 60),
        minimumSeconds: Number(row.minimum_seconds ?? 0),
      });
    }
    cards.set(row.card_id, card);
  }
  return [...cards.values()];
}

async function customerRateCardAssignments(): Promise<Map<string, string>> {
  const result = await pool.query<{ id: string; customer_rate_card_id: string }>(
    `SELECT id, customer_rate_card_id
       FROM customers
      WHERE active = true AND customer_rate_card_id IS NOT NULL`,
  );
  return new Map(result.rows.map((row) => [row.id, row.customer_rate_card_id]));
}

export async function authorizeCustomerOutboundCall(
  request: BillingAuthorizationRequest,
): Promise<BillingAuthorizationDecision> {
  const extensionResult = await pool.query<{
    extension_id: string;
    customer_id: string | null;
    active: boolean | null;
    currency: string | null;
    billing_mode: "prepaid" | "postpaid" | null;
    credit_limit: string | null;
    balance: string | null;
    customer_rate_card_id: string | null;
  }>(
    `SELECT extensions.id AS extension_id, assignments.customer_id,
            customers.active, customers.currency, customers.billing_mode,
            customers.credit_limit::text, wallets.balance::text,
            customers.customer_rate_card_id
       FROM extensions
       LEFT JOIN customer_extensions AS assignments
         ON assignments.extension_id = extensions.id
       LEFT JOIN customers ON customers.id = assignments.customer_id
       LEFT JOIN customer_wallets AS wallets ON wallets.customer_id = customers.id
      WHERE extensions.extension_number = $1 AND extensions.enabled = true`,
    [request.extension],
  );
  const customer = extensionResult.rows[0];
  if (!customer) {
    return { allowed: false, reason: "invalid_extension", customerId: null, availableCredit: null };
  }
  if (!customer.customer_id) {
    return { allowed: true, reason: "unassigned_extension", customerId: null, availableCredit: null };
  }
  if (
    customer.active !== true ||
    !customer.currency ||
    !customer.billing_mode ||
    customer.balance === null ||
    customer.credit_limit === null
  ) {
    return {
      allowed: false,
      reason: "customer_disabled",
      customerId: customer.customer_id,
      availableCredit: null,
    };
  }
  if (!customer.customer_rate_card_id) {
    return {
      allowed: false,
      reason: "rate_unavailable",
      customerId: customer.customer_id,
      availableCredit: null,
    };
  }
  const destination = normalizeBillingDestination(request.destination);
  if (!destination) {
    return {
      allowed: false,
      reason: "rate_unavailable",
      customerId: customer.customer_id,
      availableCredit: null,
    };
  }
  const rateResult = await pool.query<{
    provider_currency: string;
    customer_currency: string;
  }>(
    `SELECT provider_decks.currency AS provider_currency,
            customer_cards.currency AS customer_currency
       FROM outbound_routes AS routes
       JOIN sip_trunks AS trunks
         ON trunks.id = routes.sip_trunk_id AND trunks.enabled = true
       JOIN billing_rate_decks AS provider_decks
         ON provider_decks.sip_trunk_id = trunks.id AND provider_decks.enabled = true
       JOIN billing_rates AS provider_rates
         ON provider_rates.rate_deck_id = provider_decks.id AND provider_rates.enabled = true
       JOIN customer_rate_cards AS customer_cards
         ON customer_cards.id = $3::uuid AND customer_cards.enabled = true
       JOIN customer_rate_card_rates AS customer_rates
         ON customer_rates.rate_card_id = customer_cards.id AND customer_rates.enabled = true
      WHERE routes.id = $1 AND routes.enabled = true
        AND $2 LIKE provider_rates.prefix || '%'
        AND $2 LIKE customer_rates.prefix || '%'
      ORDER BY length(provider_rates.prefix) DESC, provider_rates.id,
               length(customer_rates.prefix) DESC, customer_rates.id
      LIMIT 1`,
    [request.routeId, destination, customer.customer_rate_card_id],
  );
  const rate = rateResult.rows[0];
  if (!rate) {
    return {
      allowed: false,
      reason: "rate_unavailable",
      customerId: customer.customer_id,
      availableCredit: null,
    };
  }
  if (rate.provider_currency !== customer.currency || rate.customer_currency !== customer.currency) {
    return {
      allowed: false,
      reason: "currency_mismatch",
      customerId: customer.customer_id,
      availableCredit: null,
    };
  }
  const availableCredit = availableCustomerCredit(
    customer.billing_mode,
    Number(customer.balance),
    Number(customer.credit_limit),
  );
  return {
    allowed: availableCredit > 0,
    reason: availableCredit > 0 ? "authorized" : "insufficient_credit",
    customerId: customer.customer_id,
    availableCredit,
  };
}

export async function handleBillingAuthorization(
  agi: AgiCommandTarget,
  request: BillingAuthorizationRequest,
): Promise<BillingAuthorizationDecision> {
  const decision = await authorizeCustomerOutboundCall(request);
  await agi.command(`SET VARIABLE NBVOICE_BILLING_ALLOWED ${decision.allowed ? "1" : "0"}`);
  await agi.command(`SET VARIABLE NBVOICE_BILLING_REASON ${decision.reason.toUpperCase()}`);
  await agi.command(
    `SET VARIABLE NBVOICE_BILLING_CUSTOMER_ID ${decision.customerId ?? "UNASSIGNED"}`,
  );
  return decision;
}

async function insertRatedCharge(
  client: PoolClient,
  cdr: BillableCdr,
  providerDeck: RatingDeck,
  providerRate: BillableRate,
  customerCard: CustomerPricingCard,
  customerRate: CustomerPriceRate,
  destination: string,
  originalBillsec: number,
  costChargedSeconds: number,
  sellChargedSeconds: number,
  amounts: ReturnType<typeof splitRatedAmounts>,
): Promise<"rated" | "duplicate" | "currency_mismatch"> {
  await client.query("BEGIN");
  try {
    if (cdr.customer_id) {
      const customerResult = await client.query<{
        currency: string;
        balance: string;
      }>(
        `SELECT customers.currency, wallets.balance::text
           FROM customers
           JOIN customer_wallets AS wallets ON wallets.customer_id = customers.id
          WHERE customers.id = $1
          FOR UPDATE OF wallets`,
        [cdr.customer_id],
      );
      const customer = customerResult.rows[0];
      if (!customer) throw new Error("Rated call customer wallet is unavailable");
      if (customer.currency !== providerDeck.currency || customer.currency !== customerCard.currency) {
        await client.query("ROLLBACK");
        return "currency_mismatch";
      }
    }
    const chargeResult = await client.query<{ id: string }>(
       `INSERT INTO billing_call_charges
         (cdr_id, call_key, call_started_at, rate_deck_id, rate_id, sip_trunk_id,
          customer_id, sell_rate_deck_id, sell_rate_id,
          customer_rate_card_id, customer_rate_id,
          direction, destination, destination_name, matched_prefix, sell_matched_prefix,
          original_billsec, cost_charged_seconds, charged_seconds,
          sell_per_minute, billing_increment_seconds, minimum_seconds,
          cost_amount, sell_amount, margin_amount, currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,$8,$9,'outbound',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       ON CONFLICT DO NOTHING
       RETURNING id::text`,
      [
        cdr.id,
        cdr.linkedid || cdr.uniqueid || `cdr:${cdr.id}`,
        cdr.calldate,
        providerDeck.id,
        providerRate.id,
        providerDeck.sipTrunkId,
        cdr.customer_id,
        customerCard.id,
        customerRate.id,
        destination,
        customerRate.destinationName || providerRate.destinationName,
        providerRate.prefix,
        customerRate.prefix,
        originalBillsec,
        costChargedSeconds,
        sellChargedSeconds,
        customerRate.pricePerMinute,
        customerRate.billingIncrementSeconds,
        customerRate.minimumSeconds,
        amounts.cost,
        amounts.sell,
        amounts.margin,
        customerCard.currency,
      ],
    );
    const charge = chargeResult.rows[0];
    if (!charge) {
      await client.query("ROLLBACK");
      return "duplicate";
    }
    if (cdr.customer_id && amounts.sell > 0) {
      const walletResult = await client.query<{ balance: string }>(
        `UPDATE customer_wallets
            SET balance = round(balance - $2::numeric, 6), updated_at = now()
          WHERE customer_id = $1
          RETURNING balance::text`,
        [cdr.customer_id, amounts.sell],
      );
      const balance = walletResult.rows[0]?.balance;
      if (balance === undefined) throw new Error("Rated call wallet update failed");
      await client.query(
        `INSERT INTO customer_wallet_transactions
           (customer_id, transaction_type, currency, amount, balance_after,
            note, billing_call_charge_id)
         VALUES ($1,'charge',$2,$3,$4,$5,$6)`,
        [
          cdr.customer_id,
          customerCard.currency,
          -amounts.sell,
          balance,
          `Outbound call to +${destination}`,
          charge.id,
        ],
      );
    }
    await client.query("COMMIT");
    return "rated";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function rateUnchargedCalls(): Promise<{ scanned: number; rated: number; unmatched: number }> {
  const decks = await enabledDecks();
  if (decks.length === 0) return { scanned: 0, rated: 0, unmatched: 0 };
  const customerCards = await enabledCustomerRateCards();
  const customerAssignments = await customerRateCardAssignments();
  const rows = await pool.query<BillableCdr>(
    `SELECT records.id::text, records.calldate, records.dst, records.dcontext,
            records.channel, records.dstchannel, records.lastdata, records.billsec,
            records.uniqueid, records.linkedid,
            COALESCE(
              CASE
                WHEN records.accountcode ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                THEN records.accountcode::uuid
              END,
              (SELECT assignments.customer_id
                 FROM customer_extensions AS assignments
                 JOIN extensions
                   ON extensions.id = assignments.extension_id
                WHERE extensions.extension_number = records.src
                LIMIT 1)
            ) AS customer_id
       FROM call_detail_records AS records
      WHERE upper(records.disposition) = 'ANSWERED'
        AND records.billsec > 0
        AND records.calldate >= now() - interval '90 days'
        AND (
          records.lastdata ~* '^PJSIP/\\+?[0-9]{8,21}@nbvt-'
          OR records.dcontext LIKE 'nbvoice-outbound-%'
        )
        AND NOT EXISTS (
          SELECT 1 FROM billing_call_charges AS charges
           WHERE charges.cdr_id = records.id
              OR charges.call_key = COALESCE(
                NULLIF(records.linkedid, ''), NULLIF(records.uniqueid, ''),
                'cdr:' || records.id::text
              )
        )
      ORDER BY records.id DESC
      LIMIT 500`,
  );
  let rated = 0;
  let unmatched = 0;
  for (const cdr of rows.rows) {
    const evidence = [cdr.dcontext, cdr.channel, cdr.dstchannel, cdr.lastdata].join(" ");
    const deck = decks.find((item) => evidence.includes(trunkSectionName(item.sipTrunkId)));
    if (!deck) continue;
    const destination = extractDestination(cdr, deck);
    const providerRate = destination ? longestPrefixRate(destination, deck.rates) : undefined;
    const assignedCardId = cdr.customer_id ? customerAssignments.get(cdr.customer_id) : undefined;
    const customerCard = cdr.customer_id
      ? (assignedCardId ? customerCards.find((item) => item.id === assignedCardId) : undefined)
      : undefined;
    const customerRate = destination && customerCard
      ? longestPrefixRate(destination, customerCard.rates)
      : undefined;
    if (
      !destination || !providerRate || !customerCard || !customerRate
      || deck.currency !== customerCard.currency
    ) {
      unmatched += 1;
      continue;
    }
    const originalBillsec = Math.max(0, Math.trunc(Number(cdr.billsec)));
    const costChargedSeconds = roundedBillingSeconds(
      originalBillsec,
      providerRate.billingIncrementSeconds,
      providerRate.minimumSeconds,
    );
    const sellChargedSeconds = roundedBillingSeconds(
      originalBillsec,
      customerRate.billingIncrementSeconds,
      customerRate.minimumSeconds,
    );
    const amounts = splitRatedAmounts(
      costChargedSeconds,
      providerRate.costPerMinute,
      sellChargedSeconds,
      customerRate.pricePerMinute,
    );
    const client = await pool.connect();
    try {
      const outcome = await insertRatedCharge(
        client, cdr, deck, providerRate, customerCard, customerRate, destination,
        originalBillsec, costChargedSeconds, sellChargedSeconds, amounts,
      );
      if (outcome === "rated") rated += 1;
      if (outcome === "currency_mismatch") unmatched += 1;
    } finally {
      client.release();
    }
  }
  return { scanned: rows.rowCount ?? 0, rated, unmatched };
}

let ratingActive = false;

export async function runBillingRatingTick(logger?: FastifyBaseLogger) {
  if (ratingActive) return { scanned: 0, rated: 0, unmatched: 0 };
  ratingActive = true;
  try {
    const result = await rateUnchargedCalls();
    if (result.rated > 0) logger?.info({ calls: result.rated }, "Rated completed calls");
    return result;
  } finally {
    ratingActive = false;
  }
}

export function startBillingRater(logger: FastifyBaseLogger): NodeJS.Timeout {
  void runBillingRatingTick(logger).catch((error) => logger.error({ error }, "Initial call rating failed"));
  const timer = setInterval(() => {
    void runBillingRatingTick(logger).catch((error) => logger.error({ error }, "Call rating failed"));
  }, 5_000);
  timer.unref();
  logger.info("Billing CDR rater started");
  return timer;
}

export function stopBillingRater(timer: NodeJS.Timeout | undefined): void {
  if (timer) clearInterval(timer);
}
