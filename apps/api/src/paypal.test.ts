import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PayPalGatewayError,
  paypalApiBaseUrl,
  paypalAvailability,
  paypalCurrencyDecimals,
  topupAmount,
  verifiedPayPalCapture,
} from "./paypal.js";
import {
  payPalTopupLimits,
  resolvedPayPalSettings,
  validPayPalClientId,
  validPayPalClientSecret,
} from "./paypal-settings.js";
import { encryptSecret } from "./secrets.js";

const configured = {
  mode: "sandbox" as const,
  clientId: "sandbox-client-id",
  clientSecret: "sandbox-client-secret",
  minimumTopup: 5,
  maximumTopup: 10_000,
};

test("PayPal checkout is limited to configured prepaid wallet currencies", () => {
  const available = paypalAvailability(configured, "usd", "prepaid");
  assert.deepEqual(available, {
    available: true,
    reason: "",
    currency: "USD",
    mode: "sandbox",
    clientId: "sandbox-client-id",
    minimumTopup: 5,
    maximumTopup: 10_000,
  });
  assert.equal(paypalAvailability(configured, "ZAR", "prepaid").available, false);
  assert.match(paypalAvailability(configured, "USD", "postpaid").reason, /prepaid/);
  assert.match(
    paypalAvailability({ ...configured, clientSecret: "" }, "USD", "prepaid").reason,
    /not been configured/,
  );
  assert.equal(paypalApiBaseUrl("sandbox"), "https://api-m.sandbox.paypal.com");
  assert.equal(paypalApiBaseUrl("live"), "https://api-m.paypal.com");
});

test("wallet top-up amounts use precise PayPal currency formatting", () => {
  assert.deepEqual(topupAmount("125.5", "USD", 5, 500), {
    amount: 125.5,
    value: "125.50",
  });
  assert.equal(paypalCurrencyDecimals("JPY"), 0);
  assert.deepEqual(topupAmount("125", "JPY", 0, 500), {
    amount: 125,
    value: "125",
  });
  assert.throws(() => topupAmount("1.001", "USD", 0, 500), /decimal places/);
  assert.throws(() => topupAmount("5.5", "JPY", 0, 500), /decimal places/);
  assert.throws(
    () => topupAmount("4.99", "USD", 5, 500),
    (error: unknown) => error instanceof PayPalGatewayError && error.statusCode === 400,
  );
});

test("owner GUI settings use encrypted Sandbox credentials ahead of server fallback", () => {
  const secret = "sandbox-client-secret-with-safe-length";
  const gui = resolvedPayPalSettings(
    {
      paypal_sandbox_client_id: "sandbox_gui_client_id_0123456789",
      paypal_sandbox_client_secret: encryptSecret(secret),
      paypal_sandbox_minimum_topup: 12.5,
      paypal_sandbox_maximum_topup: 350,
    },
    { ...configured, mode: "live", minimumTopup: 5, maximumTopup: 10_000 },
  );
  assert.equal(gui.source, "gui");
  assert.deepEqual(gui.settings, {
    mode: "sandbox",
    clientId: "sandbox_gui_client_id_0123456789",
    clientSecret: secret,
    minimumTopup: 12.5,
    maximumTopup: 350,
  });
  assert.equal(
    resolvedPayPalSettings({}, configured).source,
    "environment",
  );
  assert.equal(
    resolvedPayPalSettings({}, { ...configured, clientId: "", clientSecret: "" }).source,
    "unconfigured",
  );
  assert.equal(validPayPalClientId("sandbox_gui_client_id_0123456789"), true);
  assert.equal(validPayPalClientId("too short"), false);
  assert.equal(validPayPalClientSecret(secret), true);
  assert.equal(validPayPalClientSecret("contains a space"), false);
  assert.deepEqual(payPalTopupLimits("12.5", "350"), {
    minimumTopup: 12.5,
    maximumTopup: 350,
  });
  assert.throws(() => payPalTopupLimits("12", "10"), /at least the minimum/);
});

test("wallet credit requires a completed capture with the exact stored amount", () => {
  const payload = {
    status: "COMPLETED",
    purchase_units: [{
      payments: {
        captures: [{
          id: "5O190127TN364715T",
          status: "COMPLETED",
          amount: { currency_code: "USD", value: "25.00" },
        }],
      },
    }],
  };
  assert.deepEqual(
    verifiedPayPalCapture(payload, { currency: "USD", amount: "25.00" }),
    { captureId: "5O190127TN364715T", amount: "25.00", currency: "USD" },
  );
  assert.throws(
    () => verifiedPayPalCapture(payload, { currency: "USD", amount: "24.99" }),
    /did not match/,
  );
  assert.throws(
    () => verifiedPayPalCapture({ ...payload, status: "PENDING" }, { currency: "USD", amount: "25.00" }),
    /completed payment/,
  );
});

test("PayPal top-ups are tenant-bound, idempotent and do not expose a secret to the browser", () => {
  const migration = readFileSync(
    new URL("../../../database/migrations/036_paypal_wallet_topups.sql", import.meta.url),
    "utf8",
  );
  const routes = readFileSync(new URL("./paypal-routes.js", import.meta.url), "utf8");
  const settingsRoutes = readFileSync(
    new URL("./paypal-settings-routes.js", import.meta.url),
    "utf8",
  );
  const settings = readFileSync(new URL("./paypal-settings.js", import.meta.url), "utf8");
  const web = readFileSync(new URL("../../../apps/web/src/main.tsx", import.meta.url), "utf8");
  const installer = readFileSync(new URL("../../../installer/install.sh", import.meta.url), "utf8");
  const guiMigration = readFileSync(
    new URL("../../../database/migrations/037_paypal_gui_settings.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /provider_order_id text NOT NULL UNIQUE/);
  assert.match(migration, /payment_capture_id text UNIQUE/);
  assert.match(migration, /wallet_transaction_id bigint UNIQUE/);
  assert.match(migration, /status IN \('created', 'capturing', 'captured', 'failed', 'cancelled'\)/);
  assert.match(routes, /requireCustomer/);
  assert.match(routes, /WHERE id=\$1\s+FOR UPDATE/);
  assert.match(routes, /row\.customer_id !== customerId/);
  assert.match(routes, /status='captured'/);
  assert.match(routes, /customer_wallet_transactions/);
  assert.match(routes, /configuredPayPalSettings/);
  assert.match(settingsRoutes, /requireOwner/);
  assert.match(settingsRoutes, /\/api\/billing\/payments\/paypal\/settings/);
  assert.match(settings, /encryptSecret/);
  assert.match(settings, /decryptSecret/);
  assert.match(settings, /is_secret/);
  assert.match(web, /\/api\/customer\/payments\/paypal\/config/);
  assert.match(web, /\/api\/billing\/payments\/paypal\/settings/);
  assert.match(web, /https:\/\/www\.paypal\.com\/sdk\/js/);
  assert.doesNotMatch(web, /NBVOICE_PAYPAL_CLIENT_SECRET/);
  assert.match(installer, /NBVOICE_PAYPAL_CLIENT_SECRET=/);
  assert.match(installer, /migrations\/036_paypal_wallet_topups\.sql/);
  assert.match(installer, /migrations\/037_paypal_gui_settings\.sql/);
  assert.match(guiMigration, /owner-configured PayPal Sandbox/);
});
