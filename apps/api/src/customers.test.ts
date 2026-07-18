import assert from "node:assert/strict";
import test from "node:test";
import { customerAccountLabel, customerValues, walletAdjustment } from "./customers.js";

test("customer settings normalize billing identity and prepaid limits", () => {
  assert.deepEqual(customerValues({
    name: " Example Telecom ",
    billingEmail: "BILLING@EXAMPLE.COM",
    currency: "zar",
    billingMode: "prepaid",
    creditLimit: 900,
    active: true,
  }), {
    name: "Example Telecom",
    billingEmail: "billing@example.com",
    currency: "ZAR",
    accountType: "retail",
    billingMode: "prepaid",
    creditLimit: 0,
    active: true,
  });
});

test("wholesale customers retain a distinct pricing perspective", () => {
  assert.equal(customerValues({
    name: "Example Wholesale",
    billingEmail: "billing@example.com",
    accountType: "wholesale",
  }).accountType, "wholesale");
  assert.throws(() => customerValues({
    name: "Example Telecom",
    billingEmail: "billing@example.com",
    accountType: "provider",
  }), /standard or wholesale/);
});

test("postpaid limits and wallet adjustments are bounded", () => {
  assert.equal(customerValues({
    name: "Example Telecom",
    billingEmail: "billing@example.com",
    billingMode: "postpaid",
    creditLimit: 125.5,
  }).creditLimit, 125.5);
  assert.equal(walletAdjustment(100.1234567), 100.123457);
  assert.throws(() => walletAdjustment(0), /non-zero/);
  assert.throws(() => walletAdjustment(2_000_000), /too large/);
});

test("customer account numbers use non-secret public labels", () => {
  assert.equal(customerAccountLabel(23), "NV-000023");
  assert.equal(customerAccountLabel("bad"), "NV-UNKNOWN");
});
