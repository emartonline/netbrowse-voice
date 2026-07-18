import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  invoiceNumberLabel,
  invoicePaymentValues,
  invoicePeriodValues,
} from "./invoices.js";

test("invoice periods use strict calendar dates and bounded ranges", () => {
  assert.deepEqual(invoicePeriodValues({
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    dueDate: "2026-08-15",
  }, "2026-07-31"), {
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    dueDate: "2026-08-15",
  });
  assert.throws(() => invoicePeriodValues({
    periodStart: "2026-02-30",
    periodEnd: "2026-03-01",
    dueDate: "2026-03-15",
  }, "2026-03-01"), /valid invoice period/);
  assert.throws(() => invoicePeriodValues({
    periodStart: "2026-08-01",
    periodEnd: "2026-07-01",
    dueDate: "2026-08-15",
  }, "2026-08-01"), /must not precede/);
  assert.throws(() => invoicePeriodValues({
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    dueDate: "2026-06-30",
  }, "2026-07-31"), /cannot be before/);
});

test("invoice payments and public invoice numbers are normalized", () => {
  assert.deepEqual(invoicePaymentValues(100.1234567, " EFT 10042 "), {
    amount: 100.123457,
    reference: "EFT 10042",
  });
  assert.throws(() => invoicePaymentValues(0, "EFT 1"), /valid payment amount/);
  assert.throws(() => invoicePaymentValues(10, "x"), /valid payment reference/);
  assert.equal(invoiceNumberLabel(42), "NV-INV-0000042");
  assert.equal(invoiceNumberLabel("bad"), "NV-INV-UNKNOWN");
});

test("invoice creation permits a zero-usage statement", () => {
  const source = readFileSync(new URL("./invoices.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /No uninvoiced rated calls were found/);
  assert.match(source, /if \(charges\.rows\.length > 0\)/);
});
