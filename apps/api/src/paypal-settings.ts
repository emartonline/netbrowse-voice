import type { PoolClient } from "pg";
import { config } from "./config.js";
import { pool } from "./database.js";
import type { PayPalSettings } from "./paypal.js";
import { decryptSecret, encryptSecret } from "./secrets.js";

const CLIENT_ID_KEY = "paypal_sandbox_client_id";
const CLIENT_SECRET_KEY = "paypal_sandbox_client_secret";
const MINIMUM_TOPUP_KEY = "paypal_sandbox_minimum_topup";
const MAXIMUM_TOPUP_KEY = "paypal_sandbox_maximum_topup";

type SettingValues = Record<string, unknown>;

export type PayPalSettingsSource = "gui" | "environment" | "unconfigured";

export interface PayPalGatewayAdminSettings {
  mode: "sandbox";
  clientId: string;
  secretConfigured: boolean;
  configured: boolean;
  source: PayPalSettingsSource;
  minimumTopup: number;
  maximumTopup: number;
}

export interface SavePayPalSandboxSettings {
  clientId: string;
  clientSecret?: string;
  minimumTopup: number;
  maximumTopup: number;
  updatedBy: string;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function moneyValue(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(stringValue(value));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000) return fallback;
  return Math.round(parsed * 100) / 100;
}

function decryptOrEmpty(ciphertext: string): string {
  if (!ciphertext) return "";
  try {
    return decryptSecret(ciphertext);
  } catch {
    // A key rotation or damaged ciphertext must never leak an internal error to
    // customers. The owner can safely replace the secret in the GUI.
    return "";
  }
}

function valuesFromRows(rows: Array<{ setting_key: string; setting_value: unknown }>): SettingValues {
  return Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
}

/** Resolves GUI settings first, retaining environment variables as a legacy fallback. */
export function resolvedPayPalSettings(
  values: SettingValues,
  fallback: PayPalSettings = config.paypal,
): { settings: PayPalSettings; source: PayPalSettingsSource } {
  const guiClientId = stringValue(values[CLIENT_ID_KEY]);
  const guiSecretCiphertext = stringValue(values[CLIENT_SECRET_KEY]);
  const guiSelected = Boolean(guiClientId || guiSecretCiphertext);
  if (!guiSelected) {
    return {
      settings: fallback,
      source: fallback.clientId || fallback.clientSecret ? "environment" : "unconfigured",
    };
  }
  const minimumTopup = moneyValue(values[MINIMUM_TOPUP_KEY], fallback.minimumTopup);
  const maximumTopup = Math.max(
    minimumTopup,
    moneyValue(values[MAXIMUM_TOPUP_KEY], fallback.maximumTopup),
  );
  return {
    settings: {
      // GUI configuration is sandbox-only in this hackathon release. Live
      // activation remains an explicit post-demo operation for the business owner.
      mode: "sandbox",
      clientId: guiClientId,
      clientSecret: decryptOrEmpty(guiSecretCiphertext),
      minimumTopup,
      maximumTopup,
    },
    source: "gui",
  };
}

async function storedValues(): Promise<SettingValues> {
  const result = await pool.query<{ setting_key: string; setting_value: unknown }>(
    `SELECT setting_key, setting_value
       FROM settings
      WHERE setting_key = ANY($1::text[])`,
    [[CLIENT_ID_KEY, CLIENT_SECRET_KEY, MINIMUM_TOPUP_KEY, MAXIMUM_TOPUP_KEY]],
  );
  return valuesFromRows(result.rows);
}

export async function configuredPayPalSettings(): Promise<PayPalSettings> {
  const values = await storedValues();
  return resolvedPayPalSettings(values).settings;
}

export async function paypalGatewayAdminSettings(): Promise<PayPalGatewayAdminSettings> {
  const values = await storedValues();
  const resolved = resolvedPayPalSettings(values);
  return {
    mode: "sandbox",
    clientId: resolved.settings.clientId,
    secretConfigured: Boolean(resolved.settings.clientSecret),
    configured: Boolean(resolved.settings.clientId && resolved.settings.clientSecret),
    source: resolved.source,
    minimumTopup: resolved.settings.minimumTopup,
    maximumTopup: resolved.settings.maximumTopup,
  };
}

export function validPayPalClientId(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,256}$/.test(value);
}

export function validPayPalClientSecret(value: string): boolean {
  return value.length >= 16 && value.length <= 256 && !/\s/.test(value);
}

export function payPalTopupLimits(
  minimumInput: unknown,
  maximumInput: unknown,
): { minimumTopup: number; maximumTopup: number } {
  const minimum = moneyValue(minimumInput, Number.NaN);
  const maximum = moneyValue(maximumInput, Number.NaN);
  if (!Number.isFinite(minimum) || minimum < 0.01) {
    throw new Error("Minimum top-up must be between 0.01 and 1000000");
  }
  if (!Number.isFinite(maximum) || maximum < minimum) {
    throw new Error("Maximum top-up must be at least the minimum top-up");
  }
  return { minimumTopup: minimum, maximumTopup: maximum };
}

async function saveSetting(
  client: PoolClient,
  key: string,
  value: string | number,
  isSecret: boolean,
  updatedBy: string,
): Promise<void> {
  await client.query(
    `INSERT INTO settings (setting_key, setting_value, is_secret, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, now())
     ON CONFLICT (setting_key) DO UPDATE SET
       setting_value = EXCLUDED.setting_value,
       is_secret = EXCLUDED.is_secret,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [key, JSON.stringify(value), isSecret, updatedBy],
  );
}

export async function savePayPalSandboxSettings(
  input: SavePayPalSandboxSettings,
): Promise<PayPalGatewayAdminSettings> {
  const existing = await storedValues();
  const previousSecret = stringValue(existing[CLIENT_SECRET_KEY]);
  const secretCiphertext = input.clientSecret
    ? encryptSecret(input.clientSecret)
    : previousSecret;
  if (!decryptOrEmpty(secretCiphertext)) {
    throw new Error("Enter the PayPal Sandbox client secret before saving");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await saveSetting(client, CLIENT_ID_KEY, input.clientId, false, input.updatedBy);
    await saveSetting(
      client,
      CLIENT_SECRET_KEY,
      secretCiphertext,
      true,
      input.updatedBy,
    );
    await saveSetting(
      client,
      MINIMUM_TOPUP_KEY,
      input.minimumTopup,
      false,
      input.updatedBy,
    );
    await saveSetting(
      client,
      MAXIMUM_TOPUP_KEY,
      input.maximumTopup,
      false,
      input.updatedBy,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return paypalGatewayAdminSettings();
}
