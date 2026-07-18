import PDFDocument from "pdfkit";
import { pool } from "./database.js";
import { invoiceNumberLabel } from "./invoices.js";

const NAVY = "#0B243A";
const NAVY_LIGHT = "#173B58";
const ORANGE = "#FF7A1A";
const TEXT = "#183247";
const MUTED = "#71869A";
const BORDER = "#DCE5EC";
const PALE = "#F3F7FA";
const GREEN = "#198363";
const AMBER = "#A96118";

export interface InvoicePdfData {
  brand?: {
    brandName: string;
    portalTitle: string;
    primaryColor: string;
    accentColor: string;
    supportEmail: string;
    supportPhone: string;
    websiteUrl: string;
    logoData?: Buffer;
  };
  invoice: {
    id: string;
    invoiceNumber: string;
    customerName: string;
    accountNumber: string;
    billingEmail: string;
    currency: string;
    billingMode: string;
    periodStart: string;
    periodEnd: string;
    issueDate: string;
    dueDate: string;
    status: string;
    total: number;
    paidAmount: number;
  };
  items: Array<{
    serviceDate: string;
    source: string;
    destination: string;
    destinationName: string;
    chargedSeconds: number;
    amount: number;
  }>;
  payments: Array<{ createdAt: Date; reference: string; amount: number }>;
}

function accountNumberLabel(value: string | number): string {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0
    ? `NV-${String(number).padStart(6, "0")}`
    : "NV-UNKNOWN";
}

export async function loadInvoicePdfData(
  invoiceId: string,
  customerId?: string,
): Promise<InvoicePdfData | null> {
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
    brand_name: string | null;
    portal_title: string | null;
    primary_color: string | null;
    accent_color: string | null;
    support_email: string | null;
    support_phone: string | null;
    website_url: string | null;
    logo_data: Buffer | null;
  }>(
    `SELECT invoices.id, invoices.invoice_number::text,
            customers.name AS customer_name, customers.account_number::text,
            customers.billing_email, invoices.currency, invoices.billing_mode,
            invoices.period_start::text, invoices.period_end::text,
            invoices.issue_date::text, invoices.due_date::text,
            invoices.status, invoices.total::text, invoices.paid_amount::text,
            branding.brand_name, branding.portal_title, branding.primary_color,
            branding.accent_color, branding.support_email, branding.support_phone,
            branding.website_url, branding.logo_data
       FROM billing_invoices AS invoices
       JOIN customers ON customers.id = invoices.customer_id
       LEFT JOIN customers AS parent ON parent.id=customers.parent_customer_id
       LEFT JOIN customer_branding AS branding
         ON branding.customer_id=COALESCE(parent.id, customers.id)
        AND branding.enabled=true
      WHERE invoices.id = $1
        AND ($2::uuid IS NULL OR invoices.customer_id = $2)`,
    [invoiceId, customerId ?? null],
  );
  const row = invoiceResult.rows[0];
  if (!row) return null;
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
      [row.id],
    ),
    pool.query<{ created_at: Date; reference: string; amount: string }>(
      `SELECT created_at, reference, amount::text
         FROM billing_invoice_payments
        WHERE invoice_id = $1
        ORDER BY created_at, id`,
      [row.id],
    ),
  ]);
  return {
    brand: row.brand_name ? {
      brandName: row.brand_name,
      portalTitle: row.portal_title ?? "Communications portal",
      primaryColor: row.primary_color ?? NAVY,
      accentColor: row.accent_color ?? ORANGE,
      supportEmail: row.support_email ?? "",
      supportPhone: row.support_phone ?? "",
      websiteUrl: row.website_url ?? "",
      logoData: row.logo_data ?? undefined,
    } : undefined,
    invoice: {
      id: row.id,
      invoiceNumber: invoiceNumberLabel(row.invoice_number),
      customerName: row.customer_name,
      accountNumber: accountNumberLabel(row.account_number),
      billingEmail: row.billing_email,
      currency: row.currency,
      billingMode: row.billing_mode,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      status: row.status,
      total: Number(row.total),
      paidAmount: Number(row.paid_amount),
    },
    items: items.rows.map((item) => ({
      serviceDate: item.service_date,
      source: item.source,
      destination: item.destination,
      destinationName: item.destination_name,
      chargedSeconds: item.charged_seconds,
      amount: Number(item.amount),
    })),
    payments: payments.rows.map((payment) => ({
      createdAt: payment.created_at,
      reference: payment.reference,
      amount: Number(payment.amount),
    })),
  };
}

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function drawBrandHeader(doc: PDFKit.PDFDocument, data: InvoicePdfData, continued = false): void {
  const width = doc.page.width;
  const height = continued ? 82 : 132;
  const primary = data.brand?.primaryColor ?? NAVY;
  const accent = data.brand?.accentColor ?? ORANGE;
  const brandName = data.brand?.brandName ?? "NETBROWSE";
  const portalTitle = data.brand?.portalTitle ?? "V O I C E";
  const logoY = continued ? 20 : 38;
  doc.save().rect(0, 0, width, height).fill(primary).restore();
  let logoDrawn = false;
  if (data.brand?.logoData) {
    try {
      doc.save().roundedRect(45, logoY, 40, 40, 8).fill("#FFFFFF").restore();
      doc.image(data.brand.logoData, 48, logoY + 3, {
        fit: [34, 34], align: "center", valign: "center",
      });
      logoDrawn = true;
    } catch {
      logoDrawn = false;
    }
  }
  if (!logoDrawn) {
    doc.save().roundedRect(45, logoY, 34, 34, 9).fill(accent).restore();
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(16)
      .text(brandName.slice(0, 1).toUpperCase(), 55, logoY + 8, { width: 14, align: "center" });
  }
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(14)
    .text(brandName.toUpperCase(), 95, continued ? 21 : 39, { width: 210, ellipsis: true });
  doc.fillColor(accent).fontSize(8)
    .text(portalTitle.toUpperCase(), 95, continued ? 43 : 63, { width: 210, ellipsis: true });
  doc.fillColor("#FFFFFF").font("Helvetica-Bold")
    .fontSize(continued ? 14 : 27)
    .text(continued ? "INVOICE CONTINUED" : "INVOICE", 340, continued ? 24 : 37, {
      width: 210,
      align: "right",
    });
  doc.fillColor(continued ? "#A9BED0" : accent).font("Helvetica-Bold").fontSize(10)
    .text(data.invoice.invoiceNumber, 340, continued ? 47 : 75, { width: 210, align: "right" });
  if (!continued) {
    doc.fillColor("#A9BED0").font("Helvetica").fontSize(8)
      .text("COMMUNICATIONS AND VOICE SERVICES", 45, 101);
  }
}

function labelValue(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
): void {
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(7)
    .text(label.toUpperCase(), x, y, { width });
  doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(9)
    .text(value, x, y + 13, { width, ellipsis: true });
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
  doc.save().roundedRect(45, y, 505, 24, 4).fill(NAVY_LIGHT).restore();
  const labels = [
    ["DATE", 50, 58], ["SOURCE", 112, 48], ["DESTINATION", 166, 74],
    ["DESCRIPTION", 245, 172], ["SECONDS", 423, 56], ["AMOUNT", 484, 61],
  ] as const;
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(6.5);
  for (const [label, x, width] of labels) doc.text(label, x, y + 8, { width, align: label === "AMOUNT" ? "right" : "left" });
  return y + 24;
}

function addContentPage(doc: PDFKit.PDFDocument, data: InvoicePdfData): number {
  doc.addPage();
  drawBrandHeader(doc, data, true);
  return drawTableHeader(doc, 100);
}

function drawFooter(doc: PDFKit.PDFDocument, data: InvoicePdfData, pageNumber: number, pageCount: number): void {
  const y = doc.page.height - 38;
  const originalBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.save().moveTo(45, y - 8).lineTo(550, y - 8).lineWidth(0.5).strokeColor(BORDER).stroke().restore();
  const support = [data.brand?.supportEmail, data.brand?.supportPhone, data.brand?.websiteUrl]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  doc.fillColor(MUTED).font("Helvetica").fontSize(7)
    .text(support || `Generated securely by ${data.brand?.brandName ?? "Netbrowse Voice"}`, 45, y, { width: 360, ellipsis: true });
  doc.text(`Page ${pageNumber} of ${pageCount}`, 430, y, { width: 120, align: "right" });
  doc.page.margins.bottom = originalBottomMargin;
}

export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 0, right: 45, bottom: 55, left: 45 },
      bufferPages: true,
      info: {
        Title: `${data.invoice.invoiceNumber} - ${data.invoice.customerName}`,
        Author: data.brand?.brandName ?? "Netbrowse Voice",
        Subject: "Customer voice-services invoice",
        Creator: data.brand?.brandName ?? "Netbrowse Voice",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    drawBrandHeader(doc, data);
    labelValue(doc, "Bill to", data.invoice.customerName, 45, 160, 245);
    labelValue(doc, "Account", data.invoice.accountNumber, 45, 199, 115);
    labelValue(doc, "Billing email", data.invoice.billingEmail, 170, 199, 220);
    labelValue(doc, "Invoice number", data.invoice.invoiceNumber, 385, 160, 165);
    labelValue(doc, "Issue date", data.invoice.issueDate, 385, 199, 78);
    labelValue(doc, "Due date", data.invoice.dueDate, 472, 199, 78);

    const statusColor = data.invoice.status === "paid" ? GREEN : AMBER;
    doc.save().roundedRect(45, 247, 505, 65, 9).fill(PALE).restore();
    labelValue(doc, "Service period", `${data.invoice.periodStart} to ${data.invoice.periodEnd}`, 62, 262, 205);
    labelValue(doc, "Billing mode", data.invoice.billingMode.toUpperCase(), 282, 262, 95);
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(7)
      .text("STATUS", 390, 262, { width: 70 });
    doc.save().roundedRect(390, 278, 68, 18, 6).fill(statusColor).restore();
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7)
      .text(data.invoice.status.toUpperCase(), 390, 284, { width: 68, align: "center" });
    const totalLabel = money(data.invoice.total, data.invoice.currency);
    const totalFontSize = totalLabel.length > 14 ? 10 : totalLabel.length > 11 ? 11.5 : 13;
    doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(totalFontSize)
      .text(totalLabel, 455, 278, { width: 80, align: "right" });

    let y = drawTableHeader(doc, 337);
    if (data.items.length === 0) {
      doc.save().rect(45, y, 505, 47).fill("#FAFCFD").restore();
      doc.fillColor(MUTED).font("Helvetica").fontSize(9)
        .text("No billable voice usage was recorded during this service period.", 60, y + 18, {
          width: 475,
          align: "center",
        });
      y += 47;
    } else {
      for (let index = 0; index < data.items.length; index += 1) {
        if (y + 30 > doc.page.height - 62) y = addContentPage(doc, data);
        const item = data.items[index];
        if (!item) continue;
        if (index % 2 === 1) doc.save().rect(45, y, 505, 30).fill("#F8FAFC").restore();
        doc.fillColor(TEXT).font("Helvetica").fontSize(7.5);
        doc.text(item.serviceDate, 50, y + 10, { width: 58, ellipsis: true });
        doc.text(item.source, 112, y + 10, { width: 48, ellipsis: true });
        doc.text(item.destination, 166, y + 10, { width: 74, ellipsis: true });
        doc.text(item.destinationName, 245, y + 10, { width: 172, ellipsis: true });
        doc.text(String(item.chargedSeconds), 423, y + 10, { width: 56, align: "right" });
        doc.font("Helvetica-Bold").text(money(item.amount, data.invoice.currency), 484, y + 10, {
          width: 61,
          align: "right",
        });
        doc.save().moveTo(45, y + 30).lineTo(550, y + 30).lineWidth(0.35).strokeColor(BORDER).stroke().restore();
        y += 30;
      }
    }

    if (data.payments.length > 0) {
      if (y + 34 + data.payments.length * 22 > doc.page.height - 150) {
        doc.addPage();
        drawBrandHeader(doc, data, true);
        y = 103;
      } else {
        y += 18;
      }
      doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(10).text("PAYMENTS RECEIVED", 45, y);
      y += 20;
      for (const payment of data.payments) {
        doc.save().roundedRect(45, y, 505, 20, 3).fill(PALE).restore();
        doc.fillColor(TEXT).font("Helvetica").fontSize(7.5)
          .text(payment.createdAt.toISOString().slice(0, 10), 55, y + 6, { width: 75 })
          .text(payment.reference, 140, y + 6, { width: 260, ellipsis: true });
        doc.font("Helvetica-Bold").text(money(payment.amount, data.invoice.currency), 420, y + 6, {
          width: 120,
          align: "right",
        });
        y += 22;
      }
    }

    if (y + 135 > doc.page.height - 55) {
      doc.addPage();
      drawBrandHeader(doc, data, true);
      y = 105;
    } else {
      y += 24;
    }
    const balanceDue = Math.max(0, data.invoice.total - data.invoice.paidAmount);
    const summaryX = 340;
    doc.save().roundedRect(summaryX, y, 210, 92, 8).fill(PALE).restore();
    const summaryRows: Array<[string, string, boolean]> = [
      ["Invoice total", money(data.invoice.total, data.invoice.currency), false],
      ["Payments", money(data.invoice.paidAmount, data.invoice.currency), false],
      ["Balance due", money(balanceDue, data.invoice.currency), true],
    ];
    let summaryY = y + 14;
    for (const [label, value, strong] of summaryRows) {
      doc.fillColor(strong ? TEXT : MUTED).font(strong ? "Helvetica-Bold" : "Helvetica").fontSize(strong ? 9 : 8)
        .text(label, summaryX + 15, summaryY, { width: 78 });
      doc.font("Helvetica-Bold").text(value, summaryX + 95, summaryY, { width: 100, align: "right" });
      summaryY += strong ? 24 : 22;
    }
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5)
      .text(
        data.invoice.billingMode === "prepaid"
          ? "Prepaid usage is settled from the customer wallet."
          : "Please quote the invoice number when making payment.",
        45,
        y + 15,
        { width: 260, lineGap: 3 },
      );

    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index += 1) {
      doc.switchToPage(pages.start + index);
      drawFooter(doc, data, index + 1, pages.count);
    }
    doc.end();
  });
}

export async function invoicePdf(
  invoiceId: string,
  customerId?: string,
): Promise<{ filename: string; content: Buffer } | null> {
  const data = await loadInvoicePdfData(invoiceId, customerId);
  if (!data) return null;
  return {
    filename: `${data.invoice.invoiceNumber}.pdf`,
    content: await renderInvoicePdf(data),
  };
}
