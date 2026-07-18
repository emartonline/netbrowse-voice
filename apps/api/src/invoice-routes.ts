import type { FastifyInstance, FastifyReply } from "fastify";
import { requireAdministrator, requireCustomer } from "./auth.js";
import { customerAccountLabel } from "./customers.js";
import { audit, pool } from "./database.js";
import {
  createInvoice,
  invoicePaymentValues,
  invoicePeriodValues,
  invoiceStatementCsv,
  InvoiceOperationError,
  listInvoices,
  recordInvoicePayment,
} from "./invoices.js";
import { invoicePdf } from "./invoice-pdf.js";
import { validUuid } from "./queue-agent-state.js";

interface IdParams { id: string }
interface InvoiceBody {
  customerId?: string;
  periodStart?: string;
  periodEnd?: string;
  dueDate?: string;
}
interface PaymentBody { amount?: number; reference?: string }

function databaseCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null
    ? (error as { code?: string }).code
    : undefined;
}

function sendStatement(
  reply: FastifyReply,
  statement: { filename: string; content: string },
) {
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", `attachment; filename="${statement.filename}"`)
    .header("cache-control", "private, no-store")
    .send(statement.content);
}

function sendPdf(
  reply: FastifyReply,
  document: { filename: string; content: Buffer },
) {
  return reply
    .header("content-type", "application/pdf")
    .header("content-disposition", `attachment; filename="${document.filename}"`)
    .header("content-length", String(document.content.length))
    .header("cache-control", "private, no-store")
    .send(document.content);
}

export function registerInvoiceRoutes(app: FastifyInstance): void {
  app.get("/api/billing/invoices", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const [invoices, customers] = await Promise.all([
      listInvoices(),
      pool.query<{
        id: string;
        account_number: string;
        name: string;
        currency: string;
        billing_mode: "prepaid" | "postpaid";
        active: boolean;
        uninvoiced_calls: string;
      }>(
        `SELECT customers.id, customers.account_number::text, customers.name,
                customers.currency, customers.billing_mode, customers.active,
                count(charges.id) FILTER (WHERE items.id IS NULL)::text AS uninvoiced_calls
           FROM customers
           LEFT JOIN billing_call_charges AS charges ON charges.customer_id = customers.id
           LEFT JOIN billing_invoice_items AS items
             ON items.billing_call_charge_id = charges.id
          GROUP BY customers.id
          ORDER BY customers.name, customers.account_number`,
      ),
    ]);
    return {
      invoices,
      customers: customers.rows.map((row) => ({
        id: row.id,
        accountNumber: customerAccountLabel(row.account_number),
        name: row.name,
        currency: row.currency,
        billingMode: row.billing_mode,
        active: row.active,
        uninvoicedCalls: Number(row.uninvoiced_calls),
      })),
    };
  });

  app.post<{ Body: InvoiceBody }>("/api/billing/invoices", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const customerId = request.body?.customerId?.trim() ?? "";
    if (!validUuid(customerId)) return reply.code(400).send({ error: "Choose a valid customer" });
    let period;
    try {
      period = invoicePeriodValues(request.body ?? {});
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const invoice = await createInvoice(client, { ...period, customerId, userId: user.id });
      await client.query("COMMIT");
      await audit("billing.invoice.created", user.id, {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerId,
        total: invoice.total,
        itemCount: invoice.itemCount,
      }, request.ip);
      return reply.code(201).send(invoice);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof InvoiceOperationError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      if (databaseCode(error) === "23505") {
        return reply.code(409).send({ error: "One or more calls were already placed on another invoice" });
      }
      request.log.error({ error }, "Invoice creation failed");
      return reply.code(500).send({ error: "The invoice could not be created" });
    } finally {
      client.release();
    }
  });

  app.post<{ Params: IdParams; Body: PaymentBody }>(
    "/api/billing/invoices/:id/payments",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Invoice not found" });
      let payment;
      try {
        payment = invoicePaymentValues(request.body?.amount, request.body?.reference);
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await recordInvoicePayment(client, {
          invoiceId: request.params.id,
          amount: payment.amount,
          reference: payment.reference,
          userId: user.id,
        });
        await client.query("COMMIT");
        await audit("billing.invoice.payment_recorded", user.id, {
          invoiceId: request.params.id,
          invoiceNumber: result.invoiceNumber,
          amount: payment.amount,
          reference: payment.reference,
          status: result.status,
        }, request.ip);
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (error instanceof InvoiceOperationError) {
          return reply.code(error.statusCode).send({ error: error.message });
        }
        request.log.error({ error }, "Invoice payment failed");
        return reply.code(500).send({ error: "The payment could not be recorded" });
      } finally {
        client.release();
      }
    },
  );

  app.get<{ Params: IdParams }>("/api/billing/invoices/:id/statement.csv", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Invoice not found" });
    const statement = await invoiceStatementCsv(request.params.id);
    if (!statement) return reply.code(404).send({ error: "Invoice not found" });
    return sendStatement(reply, statement);
  });

  app.get<{ Params: IdParams }>("/api/billing/invoices/:id/invoice.pdf", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Invoice not found" });
    const document = await invoicePdf(request.params.id);
    if (!document) return reply.code(404).send({ error: "Invoice not found" });
    return sendPdf(reply, document);
  });

  app.get<{ Params: IdParams }>("/api/customer/invoices/:id/statement.csv", async (request, reply) => {
    const user = await requireCustomer(request, reply);
    if (!user?.customerId) return;
    if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Invoice not found" });
    const statement = await invoiceStatementCsv(request.params.id, user.customerId);
    if (!statement) return reply.code(404).send({ error: "Invoice not found" });
    return sendStatement(reply, statement);
  });

  app.get<{ Params: IdParams }>("/api/customer/invoices/:id/invoice.pdf", async (request, reply) => {
    const user = await requireCustomer(request, reply);
    if (!user?.customerId) return;
    if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Invoice not found" });
    const document = await invoicePdf(request.params.id, user.customerId);
    if (!document) return reply.code(404).send({ error: "Invoice not found" });
    return sendPdf(reply, document);
  });
}
