import type { PoolClient } from "pg";
import { pool } from "./database.js";

export interface InvoicePeriodValues {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
}

export interface PublicInvoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  accountNumber: string;
  currency: string;
  billingMode: "prepaid" | "postpaid";
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  dueDate: string;
  status: "issued" | "paid";
  total: number;
  paidAmount: number;
  balanceDue: number;
  itemCount: number;
  createdAt: Date;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  account_number: string;
  currency: string;
  billing_mode: "prepaid" | "postpaid";
  period_start: string;
  period_end: string;
  issue_date: string;
  due_date: string;
  status: "issued" | "paid";
  total: string;
  paid_amount: string;
  item_count: string;
  created_at: Date;
}

export class InvoiceOperationError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
  }
}

function calendarDate(value: unknown): { text: string; time: number } | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
  return { text: value, time };
}

export function invoicePeriodValues(
  body: { periodStart?: string; periodEnd?: string; dueDate?: string },
  issueDate = new Date().toISOString().slice(0, 10),
): InvoicePeriodValues {
  const start = calendarDate(body.periodStart);
  const end = calendarDate(body.periodEnd);
  const due = calendarDate(body.dueDate);
  const issue = calendarDate(issueDate);
  if (!start || !end) throw new Error("Choose a valid invoice period");
  if (!due || !issue) throw new Error("Choose a valid invoice due date");
  if (end.time < start.time) throw new Error("Invoice period end must not precede its start");
  const days = Math.floor((end.time - start.time) / 86_400_000) + 1;
  if (days > 366) throw new Error("Invoice periods cannot exceed 366 days");
  if (due.time < issue.time) throw new Error("Invoice due date cannot be before its issue date");
  if (due.time - issue.time > 366 * 86_400_000) {
    throw new Error("Invoice due date cannot be more than one year away");
  }
  return { periodStart: start.text, periodEnd: end.text, dueDate: due.text };
}

export function invoicePaymentValues(
  amountValue: unknown,
  referenceValue: unknown,
): { amount: number; reference: string } {
  if (typeof amountValue !== "number" || !Number.isFinite(amountValue)) {
    throw new Error("Enter a valid payment amount");
  }
  const amount = Math.round(amountValue * 1_000_000) / 1_000_000;
  if (amount <= 0 || amount > 100_000_000) throw new Error("Enter a valid payment amount");
  const reference = typeof referenceValue === "string" ? referenceValue.trim() : "";
  if (reference.length < 2 || reference.length > 120 || /[\u0000-\u001f\u007f]/.test(reference)) {
    throw new Error("Enter a valid payment reference");
  }
  return { amount, reference };
}

export function invoiceNumberLabel(value: string | number): string {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0
    ? `NV-INV-${String(number).padStart(7, "0")}`
    : "NV-INV-UNKNOWN";
}

function accountNumberLabel(value: string | number): string {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0
    ? `NV-${String(number).padStart(6, "0")}`
    : "NV-UNKNOWN";
}

function publicInvoice(row: InvoiceRow): PublicInvoice {
  const total = Number(row.total);
  const paidAmount = Number(row.paid_amount);
  return {
    id: row.id,
    invoiceNumber: invoiceNumberLabel(row.invoice_number),
    customerId: row.customer_id,
    customerName: row.customer_name,
    accountNumber: accountNumberLabel(row.account_number),
    currency: row.currency,
    billingMode: row.billing_mode,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    status: row.status,
    total,
    paidAmount,
    balanceDue: Math.max(0, Math.round((total - paidAmount) * 1_000_000) / 1_000_000),
    itemCount: Number(row.item_count),
    createdAt: row.created_at,
  };
}

export async function listInvoices(customerId?: string): Promise<PublicInvoice[]> {
  const result = await pool.query<InvoiceRow>(
    `SELECT invoices.id, invoices.invoice_number::text, invoices.customer_id,
            customers.name AS customer_name, customers.account_number::text,
            invoices.currency, invoices.billing_mode,
            invoices.period_start::text, invoices.period_end::text,
            invoices.issue_date::text, invoices.due_date::text,
            invoices.status, invoices.total::text, invoices.paid_amount::text,
            count(items.id)::text AS item_count, invoices.created_at
       FROM billing_invoices AS invoices
       JOIN customers ON customers.id = invoices.customer_id
       LEFT JOIN billing_invoice_items AS items ON items.invoice_id = invoices.id
      WHERE ($1::uuid IS NULL OR invoices.customer_id = $1)
      GROUP BY invoices.id, customers.name, customers.account_number
      ORDER BY invoices.issue_date DESC, invoices.invoice_number DESC
      LIMIT 250`,
    [customerId ?? null],
  );
  return result.rows.map(publicInvoice);
}

export async function createInvoice(
  client: PoolClient,
  input: InvoicePeriodValues & { customerId: string; userId: string },
): Promise<{ id: string; invoiceNumber: string; total: number; itemCount: number; status: "issued" | "paid" }> {
  const customerResult = await client.query<{
    id: string;
    account_number: string;
    currency: string;
    billing_mode: "prepaid" | "postpaid";
  }>(
    `SELECT id, account_number::text, currency, billing_mode
       FROM customers
      WHERE id = $1
      FOR SHARE`,
    [input.customerId],
  );
  const customer = customerResult.rows[0];
  if (!customer) throw new InvoiceOperationError("Customer not found", 404);

  const charges = await client.query<{
    id: string;
    call_started_at: Date;
    source: string;
    destination: string;
    destination_name: string;
    charged_seconds: number;
    sell_amount: string;
    currency: string;
  }>(
    `SELECT charges.id::text, charges.call_started_at,
            COALESCE(NULLIF(records.src, ''), 'Unknown') AS source,
            charges.destination, charges.destination_name,
            charges.charged_seconds, charges.sell_amount::text, charges.currency
       FROM billing_call_charges AS charges
       JOIN call_detail_records AS records ON records.id = charges.cdr_id
       LEFT JOIN billing_invoice_items AS existing
         ON existing.billing_call_charge_id = charges.id
      WHERE charges.customer_id = $1
        AND charges.call_started_at >= $2::date
        AND charges.call_started_at < ($3::date + interval '1 day')
        AND existing.id IS NULL
      ORDER BY charges.call_started_at, charges.id
      LIMIT 5001
      FOR UPDATE OF charges`,
    [input.customerId, input.periodStart, input.periodEnd],
  );
  if (charges.rows.length > 5000) {
    throw new InvoiceOperationError("The selected period contains more than 5,000 calls; choose a shorter period", 409);
  }
  if (charges.rows.some((row) => row.currency !== customer.currency)) {
    throw new InvoiceOperationError("Invoice currency does not match the customer account", 409);
  }

  const chargeIds = charges.rows.map((row) => row.id);
  const totalResult = await client.query<{ total: string }>(
    `SELECT COALESCE(sum(sell_amount), 0)::text AS total
       FROM billing_call_charges
      WHERE id = ANY($1::bigint[])`,
    [chargeIds],
  );
  const total = Number(totalResult.rows[0]?.total ?? 0);
  if (!Number.isFinite(total) || total < 0) {
    throw new InvoiceOperationError("Invoice total could not be calculated", 500);
  }
  const paid = customer.billing_mode === "prepaid" || total === 0;
  const invoice = await client.query<{ id: string; invoice_number: string }>(
    `INSERT INTO billing_invoices
       (customer_id, currency, billing_mode, period_start, period_end, due_date,
        status, subtotal, total, paid_amount, paid_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11)
     RETURNING id, invoice_number::text`,
    [
      customer.id, customer.currency, customer.billing_mode,
      input.periodStart, input.periodEnd, input.dueDate,
      paid ? "paid" : "issued", total, paid ? total : 0,
      paid ? new Date() : null, input.userId,
    ],
  );
  const invoiceRow = invoice.rows[0];
  if (!invoiceRow) throw new InvoiceOperationError("Invoice could not be created", 500);

  if (charges.rows.length > 0) {
    await client.query(
      `INSERT INTO billing_invoice_items
         (invoice_id, billing_call_charge_id, service_date, source, destination,
          destination_name, charged_seconds, amount)
       SELECT $1, imported.charge_id, imported.service_date, imported.source,
              imported.destination, imported.destination_name,
              imported.charged_seconds, imported.amount
         FROM unnest(
           $2::bigint[], $3::date[], $4::text[], $5::text[], $6::text[],
           $7::integer[], $8::numeric[]
         ) AS imported(
           charge_id, service_date, source, destination, destination_name,
           charged_seconds, amount
         )`,
      [
        invoiceRow.id,
        chargeIds,
        charges.rows.map((row) => row.call_started_at.toISOString().slice(0, 10)),
        charges.rows.map((row) => row.source.slice(0, 80)),
        charges.rows.map((row) => row.destination),
        charges.rows.map((row) => row.destination_name.trim().slice(0, 160) || "Outbound call"),
        charges.rows.map((row) => row.charged_seconds),
        charges.rows.map((row) => row.sell_amount),
      ],
    );
  }

  return {
    id: invoiceRow.id,
    invoiceNumber: invoiceNumberLabel(invoiceRow.invoice_number),
    total,
    itemCount: charges.rows.length,
    status: paid ? "paid" : "issued",
  };
}

export async function recordInvoicePayment(
  client: PoolClient,
  input: { invoiceId: string; amount: number; reference: string; userId: string },
): Promise<{ invoiceNumber: string; status: "issued" | "paid"; paidAmount: number; balanceDue: number }> {
  const result = await client.query<{
    id: string;
    invoice_number: string;
    customer_id: string;
    currency: string;
    billing_mode: "prepaid" | "postpaid";
    status: "issued" | "paid";
    total: string;
    paid_amount: string;
    wallet_balance: string;
  }>(
    `SELECT invoices.id, invoices.invoice_number::text, invoices.customer_id,
            invoices.currency, invoices.billing_mode, invoices.status,
            invoices.total::text, invoices.paid_amount::text,
            wallets.balance::text AS wallet_balance
       FROM billing_invoices AS invoices
       JOIN customer_wallets AS wallets ON wallets.customer_id = invoices.customer_id
      WHERE invoices.id = $1
      FOR UPDATE OF invoices, wallets`,
    [input.invoiceId],
  );
  const invoice = result.rows[0];
  if (!invoice) throw new InvoiceOperationError("Invoice not found", 404);
  if (invoice.billing_mode !== "postpaid") {
    throw new InvoiceOperationError("Prepaid statements are settled from the wallet automatically", 409);
  }
  if (invoice.status === "paid") throw new InvoiceOperationError("Invoice is already paid", 409);
  const total = Number(invoice.total);
  const previousPaid = Number(invoice.paid_amount);
  const remaining = Math.round((total - previousPaid) * 1_000_000) / 1_000_000;
  if (input.amount > remaining) {
    throw new InvoiceOperationError(`Payment exceeds the remaining invoice balance of ${remaining.toFixed(6)} ${invoice.currency}`, 409);
  }
  const paidAmount = Math.round((previousPaid + input.amount) * 1_000_000) / 1_000_000;
  const paid = paidAmount >= total;
  const walletBalance = Math.round((Number(invoice.wallet_balance) + input.amount) * 1_000_000) / 1_000_000;

  await client.query(
    `INSERT INTO billing_invoice_payments
       (invoice_id, currency, amount, reference, created_by)
     VALUES ($1,$2,$3,$4,$5)`,
    [invoice.id, invoice.currency, input.amount, input.reference, input.userId],
  );
  await client.query(
    `UPDATE billing_invoices
        SET paid_amount=$2, status=$3, paid_at=$4, updated_at=now()
      WHERE id=$1`,
    [invoice.id, paidAmount, paid ? "paid" : "issued", paid ? new Date() : null],
  );
  await client.query(
    `UPDATE customer_wallets SET balance=$2, updated_at=now() WHERE customer_id=$1`,
    [invoice.customer_id, walletBalance],
  );
  await client.query(
    `INSERT INTO customer_wallet_transactions
       (customer_id, transaction_type, currency, amount, balance_after, note, created_by)
     VALUES ($1,'payment',$2,$3,$4,$5,$6)`,
    [
      invoice.customer_id, invoice.currency, input.amount, walletBalance,
      `${invoiceNumberLabel(invoice.invoice_number)} payment · ${input.reference}`.slice(0, 200),
      input.userId,
    ],
  );
  return {
    invoiceNumber: invoiceNumberLabel(invoice.invoice_number),
    status: paid ? "paid" : "issued",
    paidAmount,
    balanceDue: Math.max(0, Math.round((total - paidAmount) * 1_000_000) / 1_000_000),
  };
}

function csvCell(value: unknown): string {
  let text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function invoiceStatementCsv(
  invoiceId: string,
  customerId?: string,
): Promise<{ filename: string; content: string } | null> {
  const invoiceResult = await pool.query<{
    id: string;
    invoice_number: string;
    customer_name: string;
    account_number: string;
    billing_email: string;
    currency: string;
    billing_mode: string;
    period_start: string;
    period_end: string;
    issue_date: string;
    due_date: string;
    status: string;
    total: string;
    paid_amount: string;
  }>(
    `SELECT invoices.id, invoices.invoice_number::text,
            customers.name AS customer_name, customers.account_number::text,
            customers.billing_email, invoices.currency, invoices.billing_mode,
            invoices.period_start::text, invoices.period_end::text,
            invoices.issue_date::text, invoices.due_date::text,
            invoices.status, invoices.total::text, invoices.paid_amount::text
       FROM billing_invoices AS invoices
       JOIN customers ON customers.id = invoices.customer_id
      WHERE invoices.id = $1
        AND ($2::uuid IS NULL OR invoices.customer_id = $2)`,
    [invoiceId, customerId ?? null],
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice) return null;
  const [items, payments] = await Promise.all([
    pool.query<{
      service_date: string;
      source: string;
      destination: string;
      destination_name: string;
      charged_seconds: number;
      amount: string;
    }>(
      `SELECT service_date::text, source, destination, destination_name,
              charged_seconds, amount::text
         FROM billing_invoice_items
        WHERE invoice_id = $1
        ORDER BY service_date, id`,
      [invoice.id],
    ),
    pool.query<{ created_at: Date; reference: string; amount: string }>(
      `SELECT created_at, reference, amount::text
         FROM billing_invoice_payments
        WHERE invoice_id = $1
        ORDER BY created_at, id`,
      [invoice.id],
    ),
  ]);
  const total = Number(invoice.total);
  const paidAmount = Number(invoice.paid_amount);
  const lines = [
    ["Invoice", invoiceNumberLabel(invoice.invoice_number)],
    ["Customer", invoice.customer_name],
    ["Account", accountNumberLabel(invoice.account_number)],
    ["Billing email", invoice.billing_email],
    ["Billing mode", invoice.billing_mode],
    ["Period", `${invoice.period_start} to ${invoice.period_end}`],
    ["Issue date", invoice.issue_date],
    ["Due date", invoice.due_date],
    ["Status", invoice.status],
    ["Currency", invoice.currency],
    ["Total", total.toFixed(6)],
    ["Paid", paidAmount.toFixed(6)],
    ["Balance due", Math.max(0, total - paidAmount).toFixed(6)],
  ].map((row) => row.map(csvCell).join(","));
  lines.push("");
  lines.push(["Service date", "Source", "Destination", "Destination name", "Charged seconds", "Amount"].map(csvCell).join(","));
  for (const item of items.rows) {
    lines.push([
      item.service_date, item.source, item.destination, item.destination_name,
      item.charged_seconds, Number(item.amount).toFixed(6),
    ].map(csvCell).join(","));
  }
  if (payments.rows.length > 0) {
    lines.push("", ["Payment date", "Reference", "Amount"].map(csvCell).join(","));
    for (const payment of payments.rows) {
      lines.push([
        payment.created_at.toISOString(), payment.reference, Number(payment.amount).toFixed(6),
      ].map(csvCell).join(","));
    }
  }
  const label = invoiceNumberLabel(invoice.invoice_number);
  return { filename: `${label}.csv`, content: `\uFEFF${lines.join("\r\n")}\r\n` };
}
