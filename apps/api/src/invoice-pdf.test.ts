import assert from "node:assert/strict";
import test from "node:test";
import { renderInvoicePdf, type InvoicePdfData } from "./invoice-pdf.js";

export const sampleInvoice: InvoicePdfData = {
  invoice: {
    id: "00000000-0000-4000-8000-000000000001",
    invoiceNumber: "NV-INV-0000042",
    customerName: "Example Communications (Pty) Ltd",
    accountNumber: "NV-000023",
    billingEmail: "accounts@example.test",
    currency: "ZAR",
    billingMode: "postpaid",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    issueDate: "2026-08-01",
    dueDate: "2026-08-15",
    status: "issued",
    total: 35.75,
    paidAmount: 10,
  },
  items: [
    {
      serviceDate: "2026-07-12",
      source: "102",
      destination: "27821234567",
      destinationName: "South Africa mobile",
      chargedSeconds: 120,
      amount: 12.5,
    },
    {
      serviceDate: "2026-07-17",
      source: "100",
      destination: "441234567890",
      destinationName: "United Kingdom geographic",
      chargedSeconds: 300,
      amount: 23.25,
    },
  ],
  payments: [{ createdAt: new Date("2026-08-04T10:00:00Z"), reference: "EFT-1042", amount: 10 }],
};

test("branded invoice PDF renders as a non-empty PDF document", async () => {
  const pdf = await renderInvoicePdf(sampleInvoice);
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.length > 3_000);
  assert.ok(pdf.includes(Buffer.from("%%EOF")));
  assert.equal((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length, 1);
});

test("reseller identity can brand the generated customer invoice", async () => {
  const pdf = await renderInvoicePdf({
    ...sampleInvoice,
    brand: {
      brandName: "Example Voice",
      portalTitle: "Customer communications",
      primaryColor: "#15324A",
      accentColor: "#35A37C",
      supportEmail: "support@example.test",
      supportPhone: "+27 10 000 0000",
      websiteUrl: "https://example.test",
    },
  });
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.length > 3_000);
  assert.ok(pdf.toString("latin1").includes("Example Voice"));
});
