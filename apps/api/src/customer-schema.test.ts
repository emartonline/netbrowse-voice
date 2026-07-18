import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("customer DID listing uses the established inbound trunk column", () => {
  const migration = readFileSync(
    new URL("../../../database/migrations/004_sip_trunks_dids.sql", import.meta.url),
    "utf8",
  );
  const routeSource = readFileSync(new URL("./customer-routes.js", import.meta.url), "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS did_routes[\s\S]*?trunk_id uuid NOT NULL/);
  assert.match(routeSource, /trunks\.id = routes\.trunk_id/);
  assert.doesNotMatch(routeSource, /routes\.sip_trunk_id/);
});

test("customer DID destinations use the established IVR extension column", () => {
  const migration = readFileSync(
    new URL("../../../database/migrations/009_ivr_builder.sql", import.meta.url),
    "utf8",
  );
  const routeSource = readFileSync(new URL("./customer-routes.js", import.meta.url), "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS ivr_menus[\s\S]*?extension_number text NOT NULL/);
  assert.match(routeSource, /ivrs\.extension_number/);
  assert.doesNotMatch(routeSource, /ivrs\.internal_number/);
});

test("customer invoice statements remain tenant scoped", () => {
  const invoiceSource = readFileSync(new URL("./invoices.js", import.meta.url), "utf8");
  const pdfSource = readFileSync(new URL("./invoice-pdf.js", import.meta.url), "utf8");
  const routeSource = readFileSync(new URL("./invoice-routes.js", import.meta.url), "utf8");

  assert.match(invoiceSource, /invoices\.customer_id = \$2/);
  assert.match(pdfSource, /invoices\.customer_id = \$2/);
  assert.match(routeSource, /invoiceStatementCsv\(request\.params\.id, user\.customerId\)/);
  assert.match(routeSource, /invoicePdf\(request\.params\.id, user\.customerId\)/);
  assert.doesNotMatch(routeSource, /request\.query.*customer/i);
});

test("customer rate cards are independent and customer APIs expose price snapshots only", () => {
  const migration = readFileSync(
    new URL("../../../database/migrations/030_independent_customer_rate_cards.sql", import.meta.url),
    "utf8",
  );
  const routeSource = readFileSync(new URL("./customer-routes.js", import.meta.url), "utf8");
  const start = routeSource.indexOf('app.get("/api/customer/rate-card"');
  const end = routeSource.indexOf('app.get("/api/customer/portal"', start);
  const customerPricingRoutes = routeSource.slice(start, end);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS customer_rate_cards/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS customer_rate_card_rates/);
  assert.match(migration, /price_per_minute numeric/);
  assert.match(customerPricingRoutes, /JOIN customer_rate_cards AS cards/);
  assert.match(customerPricingRoutes, /FROM customer_rate_card_rates/);
  assert.match(customerPricingRoutes, /WHERE charges\.customer_id = \$1/);
  assert.match(customerPricingRoutes, /charges\.sell_per_minute/);
  assert.match(customerPricingRoutes, /charges\.sell_amount/);
  assert.doesNotMatch(customerPricingRoutes, /billing_rate_decks|billing_rates|cost_per_minute|cost_amount|margin_amount/);
});

test("billing administration provides separate provider and customer pricing endpoints", () => {
  const billingSource = readFileSync(new URL("./billing-routes.js", import.meta.url), "utf8");
  const ratingSource = readFileSync(new URL("./billing.js", import.meta.url), "utf8");

  assert.match(billingSource, /\/api\/billing\/customer-rate-cards/);
  assert.match(billingSource, /INSERT INTO customer_rate_card_rates/);
  assert.match(ratingSource, /enabledCustomerRateCards/);
  assert.match(ratingSource, /customer_rate_card_id/);
  assert.match(ratingSource, /customerRate\.pricePerMinute/);
});

test("customer pricing labels follow the customer's account perspective", () => {
  const migration = readFileSync(
    new URL("../../../database/migrations/029_customer_account_types.sql", import.meta.url),
    "utf8",
  );
  const webSource = readFileSync(
    new URL("../../../apps/web/src/main.tsx", import.meta.url),
    "utf8",
  );

  assert.match(migration, /account_type IN \('retail', 'wholesale'\)/);
  assert.match(webSource, /YOUR BUYING RATES/);
  assert.match(webSource, /Buying rate per minute/);
  assert.doesNotMatch(webSource, /SELLING PRICE/);
});

test("service plans and extension ranges are tenant-safe", () => {
  const migration = readFileSync(
    new URL("../../../database/migrations/031_customer_service_plans.sql", import.meta.url),
    "utf8",
  );
  const customerSource = readFileSync(new URL("./customer-routes.js", import.meta.url), "utf8");
  const planSource = readFileSync(new URL("./customer-plan-routes.js", import.meta.url), "utf8");
  const pbxSource = readFileSync(new URL("./pbx-routes.js", import.meta.url), "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS customer_service_plans/);
  assert.match(migration, /extension_range_start/);
  assert.match(migration, /extension_range_end/);
  assert.match(planSource, /requireAdministrator/);
  assert.match(customerSource, /plans\.max_extensions/);
  assert.match(customerSource, /Extension allowance is fully used or delegated to clients/);
  assert.match(pbxSource, /requireCustomer/);
  assert.match(pbxSource, /customerExtensionById\(user\.customerId/);
  assert.match(pbxSource, /generate_series/);
  assert.doesNotMatch(customerSource.slice(customerSource.indexOf('app.get("\/api\/customer\/portal"')), /request\.(query|body).*customerId/);
});

test("the customer recording archive is published as a stable tenant portal section", () => {
  const migration = readFileSync(
    new URL("../../../database/migrations/032_customer_recording_archive.sql", import.meta.url),
    "utf8",
  );
  const webSource = readFileSync(
    new URL("../../../apps/web/src/main.tsx", import.meta.url),
    "utf8",
  );

  assert.match(migration, /032_customer_recording_archive/);
  assert.match(webSource, /recordings: "\/portal\/recordings"/);
  assert.match(webSource, /CustomerRecordingsPanel/);
  assert.match(webSource, /\/api\/customer\/recordings/);
});

test("wholesale reseller clients are hierarchically isolated and range bounded", () => {
  const migration = readFileSync(
    new URL("../../../database/migrations/033_reseller_clients.sql", import.meta.url),
    "utf8",
  );
  const resellerSource = readFileSync(new URL("./reseller-routes.js", import.meta.url), "utf8");
  const authSource = readFileSync(new URL("./auth.js", import.meta.url), "utf8");
  const pbxSource = readFileSync(new URL("./pbx-routes.js", import.meta.url), "utf8");
  const webSource = readFileSync(
    new URL("../../../apps/web/src/main.tsx", import.meta.url),
    "utf8",
  );

  assert.match(migration, /parent_customer_id uuid/);
  assert.match(migration, /owner_customer_id uuid/);
  assert.match(resellerSource, /requireCustomer/);
  assert.match(resellerSource, /parent_customer_id=\$1/);
  assert.match(resellerSource, /parent_customer_id=\$2/);
  assert.match(resellerSource, /pg_advisory_xact_lock/);
  assert.doesNotMatch(resellerSource, /request\.(query|body)\?*\.parentCustomerId/);
  assert.match(authSource, /parent_customer\.active = true/);
  assert.match(pbxSource, /child_accounts\.parent_customer_id=\$3/);
  assert.match(webSource, /clients: "\/portal\/clients"/);
  assert.match(webSource, /ResellerClientsPanel/);
});
