import assert from "node:assert/strict";
import test from "node:test";
import {
  availableCustomerCredit,
  billingAuthorizationFromAgiEnvironment,
  longestPrefixRate,
  normalizeBillingDestination,
  parseCustomerRateImport,
  parseRateImport,
  ratedAmounts,
  roundedBillingSeconds,
  splitRatedAmounts,
  type BillableRate,
} from "./billing.js";

const rates: BillableRate[] = [
  {
    id: "1",
    prefix: "27",
    destinationName: "South Africa",
    costPerMinute: 0.5,
    sellPerMinute: 0.8,
    billingIncrementSeconds: 60,
    minimumSeconds: 0,
  },
  {
    id: "2",
    prefix: "2782",
    destinationName: "South Africa mobile",
    costPerMinute: 0.7,
    sellPerMinute: 1.1,
    billingIncrementSeconds: 30,
    minimumSeconds: 30,
  },
];

test("rate import validates prefixes, decimals, increments and duplicate rows", () => {
  const result = parseRateImport([
    "prefix,destination,cost_per_minute,increment_seconds,minimum_seconds",
    "27,South Africa,0.50,60,0",
    "2782,Mobile,0.70,30,30",
    "2782,Duplicate,0.80,60,0",
    "bad,Invalid,0.10,60,0",
  ].join("\n"));
  assert.equal(result.rates.length, 2);
  assert.equal(result.duplicateLines, 1);
  assert.equal(result.invalidLines, 1);
});

test("legacy provider imports remain compatible while customer prices use a separate parser", () => {
  const legacyProvider = parseRateImport([
    "prefix,destination,cost_per_minute,sell_per_minute,increment_seconds,minimum_seconds",
    "27,South Africa,0.50,0.80,60,0",
  ].join("\n"));
  assert.equal(legacyProvider.rates[0]?.costPerMinute, 0.5);
  assert.equal(legacyProvider.rates[0]?.sellPerMinute, 0.8);

  const customer = parseCustomerRateImport([
    "prefix,destination,price_per_minute,increment_seconds,minimum_seconds",
    "27,South Africa,0.80,60,0",
    "2782,Mobile,1.10,30,30",
    "2782,Duplicate,1.20,60,0",
    "bad,Invalid,0.20,60,0",
  ].join("\n"));
  assert.equal(customer.rates.length, 2);
  assert.equal(customer.rates[1]?.pricePerMinute, 1.1);
  assert.equal(customer.duplicateLines, 1);
  assert.equal(customer.invalidLines, 1);
});

test("billing destination removes plus, international and configured provider prefixes", () => {
  assert.equal(normalizeBillingDestination("+27821234567"), "27821234567");
  assert.equal(normalizeBillingDestination("0027821234567"), "27821234567");
  assert.equal(normalizeBillingDestination("9127821234567", "91"), "27821234567");
  assert.equal(normalizeBillingDestination("not-a-number"), null);
});

test("longest prefix wins deterministically", () => {
  assert.equal(longestPrefixRate("27821234567", rates)?.id, "2");
  assert.equal(longestPrefixRate("27101234567", rates)?.id, "1");
  assert.equal(longestPrefixRate("441234567890", rates), undefined);
});

test("billing increments and minimums round conversation time upward", () => {
  assert.equal(roundedBillingSeconds(1, 60, 0), 60);
  assert.equal(roundedBillingSeconds(61, 60, 0), 120);
  assert.equal(roundedBillingSeconds(10, 6, 30), 30);
  assert.equal(roundedBillingSeconds(0, 60, 60), 0);
});

test("rated amounts preserve provider cost, sell price and margin", () => {
  assert.deepEqual(ratedAmounts(90, 0.5, 0.8), {
    cost: 0.75,
    sell: 1.2,
    margin: 0.45,
  });
});

test("provider cost and customer selling terms can round independently", () => {
  assert.deepEqual(splitRatedAmounts(60, 0.5, 30, 0.8), {
    cost: 0.5,
    sell: 0.4,
    margin: -0.1,
  });
});

test("billing authorization accepts only a bounded local FastAGI request path", () => {
  assert.deepEqual(billingAuthorizationFromAgiEnvironment({
    agi_network_script: "billing-authorize/b4c26e30-c36a-428e-9ed8-7d1d678b0fa1/102/27821234567",
  }), {
    routeId: "b4c26e30-c36a-428e-9ed8-7d1d678b0fa1",
    extension: "102",
    destination: "27821234567",
  });
  assert.equal(billingAuthorizationFromAgiEnvironment({
    agi_network_script: "billing-authorize/not-a-route/102/27821234567",
  }), undefined);
  assert.equal(billingAuthorizationFromAgiEnvironment({
    agi_network_script: "billing-authorize/b4c26e30-c36a-428e-9ed8-7d1d678b0fa1/../../admin/27821234567",
  }), undefined);
});

test("available credit respects prepaid balances and postpaid limits", () => {
  assert.equal(availableCustomerCredit("prepaid", 25.5, 500), 25.5);
  assert.equal(availableCustomerCredit("prepaid", 0, 500), 0);
  assert.equal(availableCustomerCredit("postpaid", -75, 100), 25);
  assert.equal(availableCustomerCredit("postpaid", -100, 100), 0);
});
