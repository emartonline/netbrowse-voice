export type BillingMode = "prepaid" | "postpaid";
export type CustomerAccountType = "retail" | "wholesale";

export interface CustomerValues {
  name: string;
  billingEmail: string;
  currency: string;
  accountType: CustomerAccountType;
  billingMode: BillingMode;
  creditLimit: number;
  active: boolean;
}

export function validCustomerEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function customerValues(
  body: {
    name?: string;
    billingEmail?: string;
    currency?: string;
    accountType?: string;
    billingMode?: string;
    creditLimit?: number;
    active?: boolean;
  },
  existing?: CustomerValues,
): CustomerValues {
  const name = body.name?.trim() ?? existing?.name ?? "";
  const billingEmail = body.billingEmail?.trim().toLowerCase() ?? existing?.billingEmail ?? "";
  const currency = body.currency?.trim().toUpperCase() ?? existing?.currency ?? "ZAR";
  const accountType = body.accountType ?? existing?.accountType ?? "retail";
  const billingMode = body.billingMode ?? existing?.billingMode ?? "prepaid";
  const requestedCredit = body.creditLimit ?? existing?.creditLimit ?? 0;
  const active = body.active ?? existing?.active ?? true;
  if (name.length < 2 || name.length > 120) throw new Error("Enter a valid customer name");
  if (!validCustomerEmail(billingEmail)) throw new Error("Enter a valid billing email address");
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must use a three-letter code");
  if (accountType !== "retail" && accountType !== "wholesale") {
    throw new Error("Choose a standard or wholesale customer account");
  }
  if (billingMode !== "prepaid" && billingMode !== "postpaid") {
    throw new Error("Choose prepaid or postpaid billing");
  }
  if (!Number.isFinite(requestedCredit) || requestedCredit < 0 || requestedCredit > 100_000_000) {
    throw new Error("Enter a valid credit limit");
  }
  if (typeof active !== "boolean") throw new Error("Invalid customer status");
  const creditLimit = billingMode === "prepaid"
    ? 0
    : Math.round(requestedCredit * 1_000_000) / 1_000_000;
  return { name, billingEmail, currency, accountType, billingMode, creditLimit, active };
}

export function walletAdjustment(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    throw new Error("Enter a non-zero wallet amount");
  }
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  if (Math.abs(rounded) > 1_000_000) throw new Error("Wallet adjustment is too large");
  return rounded;
}

export function customerAccountLabel(value: string | number): string {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0
    ? `NV-${String(number).padStart(6, "0")}`
    : "NV-UNKNOWN";
}
