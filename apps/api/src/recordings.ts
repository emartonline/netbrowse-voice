import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { pool } from "./database.js";

const RECORDING_PREFIX = "nbvoice-recording:";

export const retentionChoices = [0, 7, 30, 90, 365] as const;

export function recordingFilename(userfield: string): string | undefined {
  for (const token of userfield.split(";")) {
    const value = token.trim();
    if (!value.startsWith(RECORDING_PREFIX)) continue;
    const filename = value.slice(RECORDING_PREFIX.length);
    if (
      /^nbv-[A-Za-z0-9][A-Za-z0-9_.-]{0,170}\.wav$/.test(filename) &&
      !filename.includes("..")
    ) {
      return filename;
    }
  }
  return undefined;
}

export function recordingPath(filename: string): string {
  const verified = recordingFilename(`${RECORDING_PREFIX}${filename}`);
  if (!verified) throw new Error("Unsafe recording filename");
  return path.join(config.recordingDir, verified);
}

export async function recordingFileStat(filename: string) {
  try {
    const details = await stat(recordingPath(filename));
    return details.isFile() && details.size > 44 ? details : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function getRecordingRetentionDays(): Promise<number> {
  const result = await pool.query<{ setting_value: unknown }>(
    "SELECT setting_value FROM settings WHERE setting_key = 'recording_retention_days'",
  );
  const value = Number(result.rows[0]?.setting_value ?? 90);
  return (retentionChoices as readonly number[]).includes(value) ? value : 90;
}

export async function recordingStorageSummary(): Promise<{ count: number; bytes: number }> {
  try {
    const entries = await readdir(config.recordingDir, { withFileTypes: true });
    let count = 0;
    let bytes = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !recordingFilename(`${RECORDING_PREFIX}${entry.name}`)) continue;
      const details = await recordingFileStat(entry.name);
      if (!details) continue;
      count += 1;
      bytes += details.size;
    }
    return { count, bytes };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { count: 0, bytes: 0 };
    throw error;
  }
}

export async function customerRecordingStorageSummary(
  customerId: string,
): Promise<{ count: number; bytes: number }> {
  const result = await pool.query<{ userfield: string }>(
    `WITH owned_calls AS (
       SELECT DISTINCT COALESCE(
                NULLIF(records.linkedid, ''), NULLIF(records.uniqueid, ''), records.id::text
              ) AS call_key
         FROM call_detail_records AS records
         JOIN extensions
           ON extensions.extension_number=records.src
           OR extensions.extension_number=records.dst
         JOIN customer_extensions AS assignments
           ON assignments.extension_id=extensions.id
        WHERE assignments.customer_id=$1
     )
     SELECT records.userfield
       FROM call_detail_records AS records
       JOIN owned_calls ON owned_calls.call_key=COALESCE(
         NULLIF(records.linkedid, ''), NULLIF(records.uniqueid, ''), records.id::text
       )
      WHERE upper(records.disposition)='ANSWERED'
        AND position('nbvoice-recording:' in records.userfield) > 0`,
    [customerId],
  );
  const filenames = new Set(
    result.rows
      .map((row) => recordingFilename(row.userfield))
      .filter((filename): filename is string => Boolean(filename)),
  );
  let bytes = 0;
  let count = 0;
  for (const filename of filenames) {
    const details = await recordingFileStat(filename);
    if (!details) continue;
    count += 1;
    bytes += details.size;
  }
  return { count, bytes };
}

export async function enforceCustomerRecordingQuotas(): Promise<{
  customerIds: string[];
  disabledExtensions: number;
}> {
  const result = await pool.query<{
    id: string;
    active: boolean;
    plan_enabled: boolean;
    recording_enabled: boolean;
    recording_storage_mb: number;
  }>(
    `SELECT DISTINCT customers.id, customers.active,
            plans.enabled AS plan_enabled, plans.recording_enabled,
            plans.recording_storage_mb
       FROM customers
       JOIN customer_service_plans AS plans ON plans.id=customers.service_plan_id
       JOIN customer_extensions AS assignments ON assignments.customer_id=customers.id
       JOIN extensions ON extensions.id=assignments.extension_id
      WHERE extensions.record_calls=true`,
  );
  const customerIds: string[] = [];
  let disabledExtensions = 0;
  for (const customer of result.rows) {
    const limitBytes = Math.max(0, customer.recording_storage_mb) * 1024 * 1024;
    const storage = customer.active && customer.plan_enabled && customer.recording_enabled
      ? await customerRecordingStorageSummary(customer.id)
      : { count: 0, bytes: limitBytes };
    if (
      customer.active
      && customer.plan_enabled
      && customer.recording_enabled
      && limitBytes > 0
      && storage.bytes < limitBytes
    ) continue;
    const updated = await pool.query(
      `UPDATE extensions
          SET record_calls=false, updated_at=now()
        WHERE record_calls=true
          AND id IN (
            SELECT extension_id FROM customer_extensions WHERE customer_id=$1
          )`,
      [customer.id],
    );
    if ((updated.rowCount ?? 0) > 0) {
      customerIds.push(customer.id);
      disabledExtensions += updated.rowCount ?? 0;
    }
  }
  return { customerIds, disabledExtensions };
}

async function removeFile(filename: string): Promise<void> {
  try {
    await unlink(recordingPath(filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function deleteRecordingFile(filename: string, reason: "deleted" | "expired"): Promise<void> {
  await removeFile(filename);
  const marker = `${RECORDING_PREFIX}${filename}`;
  await pool.query(
    `UPDATE call_detail_records
        SET userfield = replace(userfield, $1, $2)
      WHERE position($1 in userfield) > 0`,
    [marker, `nbvoice-recording-${reason}:${filename}`],
  );
}

export async function pruneExpiredRecordings(): Promise<number> {
  const days = await getRecordingRetentionDays();
  if (days === 0) return 0;
  const expired = await pool.query<{ userfield: string }>(
    `SELECT userfield
       FROM call_detail_records
      WHERE calldate < now() - ($1::integer * interval '1 day')
        AND position('nbvoice-recording:' in userfield) > 0`,
    [days],
  );
  const filenames = new Set(
    expired.rows
      .map((row) => recordingFilename(row.userfield))
      .filter((filename): filename is string => Boolean(filename)),
  );
  for (const filename of filenames) await deleteRecordingFile(filename, "expired");
  return filenames.size;
}
