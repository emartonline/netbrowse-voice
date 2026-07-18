import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DidMarketplaceError,
  balanceAfterPurchase,
  didInventoryValues,
  purchaseTotal,
} from "./did-marketplace.js";

const trunkId = "48b81fa8-86dd-45de-9517-44e15ae819da";

test("DID inventory input normalizes numbers, location and currency", () => {
  assert.deepEqual(didInventoryValues({
    didNumber: "+27 (10) 555-0100",
    trunkId,
    countryCode: "za",
    region: "  Gauteng ",
    locality: " Johannesburg ",
    currency: "zar",
    setupPrice: 25.125,
    monthlyPrice: 49.99,
    enabled: true,
  }), {
    didNumber: "+27105550100",
    trunkId,
    countryCode: "ZA",
    region: "Gauteng",
    locality: "Johannesburg",
    currency: "ZAR",
    setupPrice: 25.125,
    monthlyPrice: 49.99,
    enabled: true,
  });
});

test("DID inventory rejects malformed identifiers and unsafe prices", () => {
  const valid = {
    didNumber: "+27105550100",
    trunkId,
    countryCode: "ZA",
    currency: "ZAR",
    setupPrice: 10,
    monthlyPrice: 20,
  };
  assert.throws(() => didInventoryValues({ ...valid, didNumber: "not-a-number" }), /telephone number/);
  assert.throws(() => didInventoryValues({ ...valid, trunkId: "not-a-uuid" }), /SIP trunk/);
  assert.throws(() => didInventoryValues({ ...valid, countryCode: "South Africa" }), /two-letter/);
  assert.throws(() => didInventoryValues({ ...valid, monthlyPrice: -1 }), /monthly price/);
  assert.throws(
    () => didInventoryValues({ ...valid, setupPrice: 750_000, monthlyPrice: 750_000 }),
    /cannot exceed 1,000,000/,
  );
});

test("DID purchase arithmetic supports prepaid and postpaid credit floors", () => {
  assert.equal(purchaseTotal(10.1234567, 20.7654327), 30.888889);
  assert.equal(balanceAfterPurchase(100, 30, "prepaid", 0), 70);
  assert.equal(balanceAfterPurchase(10, 40, "postpaid", 50), -30);

  assert.throws(
    () => balanceAfterPurchase(20, 20.000001, "prepaid", 500),
    (error: unknown) => error instanceof DidMarketplaceError
      && error.statusCode === 409
      && /prepaid wallet/.test(error.message),
  );
  assert.throws(
    () => balanceAfterPurchase(-40, 11, "postpaid", 50),
    (error: unknown) => error instanceof DidMarketplaceError
      && error.statusCode === 409
      && /credit limit/.test(error.message),
  );
});

test("DID allocation is race-safe, tenant-scoped and attached to immutable billing", () => {
  const migration = readFileSync(
    new URL("../../../database/migrations/035_did_marketplace.sql", import.meta.url),
    "utf8",
  );
  const service = readFileSync(new URL("./did-marketplace.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("./did-marketplace-routes.js", import.meta.url), "utf8");
  const customerMapper = routes.slice(
    routes.indexOf("function customerInventory"),
    routes.indexOf("const inventoryColumns"),
  );

  assert.match(migration, /did_number text NOT NULL UNIQUE/);
  assert.match(migration, /did_purchases_current_inventory_unique/);
  assert.match(migration, /WHERE status IN \('active', 'past_due'\)/);
  assert.match(migration, /REFERENCES customer_wallet_transactions\(id\)/);
  assert.match(service, /FOR UPDATE OF inventory/);
  assert.match(service, /NOT EXISTS \(\s*SELECT 1 FROM did_routes/);
  assert.match(service, /FOR UPDATE OF wallets/);
  assert.match(service, /pg_advisory_xact_lock\(hashtext/);
  assert.match(service, /child_plans\.max_dids/);
  assert.match(service, /customer_extensions\.customer_id=\$1/);
  assert.match(service, /serializedPbxMutation/);
  assert.match(routes, /purchaseDid\(\s*user\.id,\s*user\.customerId/);
  assert.doesNotMatch(routes, /request\.(body|query).*customerId/);
  assert.doesNotMatch(customerMapper, /trunkId|trunkName|customerId|customerName/);
});

test("DID renewals suspend and restore routing without locking an outer join", () => {
  const service = readFileSync(new URL("./did-marketplace.js", import.meta.url), "utf8");

  assert.match(service, /status='past_due'/);
  assert.match(service, /UPDATE did_routes SET enabled=false/);
  assert.match(service, /UPDATE did_routes SET enabled=true/);
  assert.match(service, /charge_type, currency, amount/);
  assert.match(service, /FOR UPDATE OF purchases, wallets/);
  assert.match(service, /didConfigurationRetryPending = true/);
  assert.match(service, /if \(didConfigurationRetryPending\)/);
  assert.doesNotMatch(service, /FOR UPDATE OF purchases, wallets, routes/);
});

test("DID marketplace is installed and exposed in both administrator and customer navigation", () => {
  const installer = readFileSync(
    new URL("../../../installer/install.sh", import.meta.url),
    "utf8",
  );
  const web = readFileSync(
    new URL("../../../apps/web/src/main.tsx", import.meta.url),
    "utf8",
  );

  assert.match(installer, /migrations\/035_did_marketplace\.sql/);
  assert.match(web, /didstore: "\/did-store"/);
  assert.match(web, /numbers: "\/portal\/numbers"/);
  assert.match(web, /CustomerDidMarketplacePanel/);
});
