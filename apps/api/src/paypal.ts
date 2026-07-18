export type PayPalMode = "sandbox" | "live";

export interface PayPalSettings {
  mode: PayPalMode;
  clientId: string;
  clientSecret: string;
  minimumTopup: number;
  maximumTopup: number;
}

export interface PayPalAvailability {
  available: boolean;
  reason: string;
  currency: string;
  mode: PayPalMode;
  clientId: string | null;
  minimumTopup: number;
  maximumTopup: number;
}

export interface TopupAmount {
  amount: number;
  value: string;
}

export interface VerifiedPayPalCapture {
  captureId: string;
  amount: string;
  currency: string;
}

export class PayPalGatewayError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message);
  }
}

// PayPal REST API currencies as documented for the Orders API. Currency
// availability can still depend on the merchant's PayPal account settings.
export const PAYPAL_SUPPORTED_CURRENCIES = new Set([
  "AUD", "BRL", "CAD", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF",
  "ILS", "JPY", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "SEK",
  "SGD", "THB", "TWD", "USD", "CHF",
]);

const ZERO_DECIMAL_CURRENCIES = new Set(["HUF", "JPY", "TWD"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function safeProviderMessage(payload: unknown): string {
  if (!record(payload)) return "PayPal did not accept the request";
  const message = text(payload.message) ?? text(payload.name);
  return message && message.length <= 160 ? message : "PayPal did not accept the request";
}

function amountDetails(value: unknown): { currency: string; value: string } | null {
  if (!record(value)) return null;
  const currency = text(value.currency_code)?.toUpperCase();
  const amount = text(value.value);
  return currency && amount ? { currency, value: amount } : null;
}

export function paypalCurrencyDecimals(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

export function paypalApiBaseUrl(mode: PayPalMode): string {
  return mode === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

export function paypalAvailability(
  settings: PayPalSettings,
  currency: string,
  billingMode: "prepaid" | "postpaid",
): PayPalAvailability {
  const normalizedCurrency = currency.trim().toUpperCase();
  let reason = "";
  if (billingMode !== "prepaid") {
    reason = "PayPal wallet top-ups are available for prepaid accounts only";
  } else if (!PAYPAL_SUPPORTED_CURRENCIES.has(normalizedCurrency)) {
    reason = `PayPal Orders does not support ${normalizedCurrency} wallet top-ups`;
  } else if (!settings.clientId || !settings.clientSecret) {
    reason = "PayPal wallet top-ups have not been configured on this server";
  }
  return {
    available: reason === "",
    reason,
    currency: normalizedCurrency,
    mode: settings.mode,
    clientId: settings.clientId || null,
    minimumTopup: settings.minimumTopup,
    maximumTopup: settings.maximumTopup,
  };
}

export function topupAmount(
  input: unknown,
  currency: string,
  minimum: number,
  maximum: number,
): TopupAmount {
  const normalizedCurrency = currency.toUpperCase();
  const decimals = paypalCurrencyDecimals(normalizedCurrency);
  const raw = typeof input === "string"
    ? input.trim()
    : typeof input === "number" && Number.isFinite(input)
      ? String(input)
      : "";
  const matched = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(raw);
  if (!matched || (matched[2]?.length ?? 0) > decimals) {
    throw new PayPalGatewayError(
      `Enter an amount with no more than ${decimals} decimal place${decimals === 1 ? "" : "s"}`,
      400,
    );
  }
  const factor = 10 ** decimals;
  const whole = BigInt(matched[1] ?? "0");
  const fractional = (matched[2] ?? "").padEnd(decimals, "0") || "0";
  const minor = whole * BigInt(factor) + BigInt(fractional);
  const amount = Number(minor) / factor;
  if (!Number.isSafeInteger(Number(minor)) || amount < minimum || amount > maximum) {
    throw new PayPalGatewayError(
      `Enter an amount from ${minimum.toFixed(decimals)} to ${maximum.toFixed(decimals)}`,
      400,
    );
  }
  return { amount, value: amount.toFixed(decimals) };
}

async function paypalJson(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    let response: Response;
    try {
      response = await fetcher(url, { ...init, signal: controller.signal });
    } catch {
      throw new PayPalGatewayError("PayPal is temporarily unavailable");
    }
    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      // A provider error page must not be relayed into the customer portal.
    }
    if (!response.ok) {
      throw new PayPalGatewayError(safeProviderMessage(payload));
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function paypalAccessToken(
  settings: PayPalSettings,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const basic = Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString("base64");
  const payload = await paypalJson(
    `${paypalApiBaseUrl(settings.mode)}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    },
    fetcher,
  );
  const accessToken = record(payload) ? text(payload.access_token) : null;
  if (!accessToken) throw new PayPalGatewayError("PayPal did not return an access token");
  return accessToken;
}

export async function createPayPalOrder(
  settings: PayPalSettings,
  input: {
    checkoutId: string;
    requestId: string;
    amount: TopupAmount;
    currency: string;
    accountNumber: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const accessToken = await paypalAccessToken(settings, fetcher);
  const payload = await paypalJson(
    `${paypalApiBaseUrl(settings.mode)}/v2/checkout/orders`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        "PayPal-Request-Id": input.requestId,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: input.checkoutId,
          custom_id: input.checkoutId,
          description: `Netbrowse Voice wallet top-up · ${input.accountNumber}`,
          amount: { currency_code: input.currency, value: input.amount.value },
        }],
      }),
    },
    fetcher,
  );
  const orderId = record(payload) ? text(payload.id) : null;
  if (!orderId || !/^[A-Z0-9]{1,36}$/i.test(orderId)) {
    throw new PayPalGatewayError("PayPal did not return a valid checkout order");
  }
  return orderId;
}

export async function capturePayPalOrder(
  settings: PayPalSettings,
  providerOrderId: string,
  requestId: string,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const accessToken = await paypalAccessToken(settings, fetcher);
  return paypalJson(
    `${paypalApiBaseUrl(settings.mode)}/v2/checkout/orders/${encodeURIComponent(providerOrderId)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        "PayPal-Request-Id": requestId,
      },
      body: "{}",
    },
    fetcher,
  );
}

export function verifiedPayPalCapture(
  payload: unknown,
  expected: { amount: string; currency: string },
): VerifiedPayPalCapture {
  if (!record(payload) || payload.status !== "COMPLETED") {
    throw new PayPalGatewayError("PayPal did not confirm a completed payment");
  }
  const purchaseUnits = payload.purchase_units;
  const purchaseUnit = Array.isArray(purchaseUnits) ? purchaseUnits[0] : null;
  const payments = record(purchaseUnit) && record(purchaseUnit.payments)
    ? purchaseUnit.payments
    : null;
  const captures = payments && Array.isArray(payments.captures) ? payments.captures : [];
  const capture = captures.find((item) => record(item) && item.status === "COMPLETED");
  const captureId = record(capture) ? text(capture.id) : null;
  const capturedAmount = record(capture) ? amountDetails(capture.amount) : null;
  if (!captureId || !/^[A-Z0-9]{1,128}$/i.test(captureId) || !capturedAmount) {
    throw new PayPalGatewayError("PayPal did not return a completed payment capture");
  }
  if (
    capturedAmount.currency !== expected.currency.toUpperCase()
    || capturedAmount.value !== expected.amount
  ) {
    throw new PayPalGatewayError("The PayPal payment amount did not match this wallet top-up");
  }
  return {
    captureId,
    amount: capturedAmount.value,
    currency: capturedAmount.currency,
  };
}
