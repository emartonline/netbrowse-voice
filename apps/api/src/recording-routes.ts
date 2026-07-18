import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { requireAdministrator, requireCustomer } from "./auth.js";
import { audit, pool } from "./database.js";
import {
  deleteRecordingFile,
  getRecordingRetentionDays,
  pruneExpiredRecordings,
  recordingFilename,
  recordingFileStat,
  recordingPath,
  recordingStorageSummary,
  customerRecordingStorageSummary,
  retentionChoices,
} from "./recordings.js";

interface RecordingQuery {
  search?: string;
  limit?: string;
}

interface AudioQuery {
  download?: string;
}

interface RecordingParams {
  id: string;
}

interface SettingsBody {
  retentionDays?: number;
}

interface RecordingRow {
  id: string;
  calldate: Date;
  clid: string;
  src: string;
  dst: string;
  duration: number;
  billsec: number;
  userfield: string;
  linkedid: string;
}

function validId(value: string): boolean {
  return /^[0-9]{1,20}$/.test(value);
}

async function recordingById(id: string): Promise<(RecordingRow & { filename: string }) | undefined> {
  if (!validId(id)) return undefined;
  const result = await pool.query<RecordingRow>(
    `SELECT id, calldate, clid, src, dst, duration, billsec, userfield, linkedid
       FROM call_detail_records
      WHERE id = $1
        AND upper(disposition) = 'ANSWERED'
        AND position('nbvoice-recording:' in userfield) > 0`,
    [id],
  );
  const row = result.rows[0];
  const filename = row ? recordingFilename(row.userfield) : undefined;
  return row && filename ? { ...row, filename } : undefined;
}

async function customerRecordingEntitlement(customerId: string) {
  const result = await pool.query<{
    active: boolean;
    plan_enabled: boolean;
    recording_enabled: boolean;
    recording_storage_mb: number;
  }>(
    `SELECT customers.active, plans.enabled AS plan_enabled,
            plans.recording_enabled, plans.recording_storage_mb
       FROM customers
       JOIN customer_service_plans AS plans ON plans.id=customers.service_plan_id
      WHERE customers.id=$1`,
    [customerId],
  );
  return result.rows[0];
}

async function customerOwnsRecording(customerId: string, recordingId: string): Promise<boolean> {
  if (!validId(recordingId)) return false;
  const result = await pool.query(
    `SELECT 1
       FROM call_detail_records AS recording
      WHERE recording.id=$2
        AND EXISTS (
          SELECT 1
            FROM call_detail_records AS leg
            JOIN extensions
              ON extensions.extension_number=leg.src
              OR extensions.extension_number=leg.dst
            JOIN customer_extensions AS assignments
              ON assignments.extension_id=extensions.id
           WHERE assignments.customer_id=$1
             AND COALESCE(NULLIF(leg.linkedid, ''), NULLIF(leg.uniqueid, ''), leg.id::text)
                 = COALESCE(NULLIF(recording.linkedid, ''), NULLIF(recording.uniqueid, ''), recording.id::text)
        )`,
    [customerId, recordingId],
  );
  return Boolean(result.rowCount);
}

function parseRange(value: string, size: number): { start: number; end: number } | undefined {
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return undefined;
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return undefined;
  }
  return { start, end: Math.min(end, size - 1) };
}

export function registerRecordingRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: RecordingQuery }>("/api/recordings", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    await pruneExpiredRecordings();
    const search = request.query.search?.trim().slice(0, 80) ?? "";
    const requestedLimit = Number.parseInt(request.query.limit ?? "50", 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
    const values: unknown[] = [];
    const filters = [
      "upper(disposition) = 'ANSWERED'",
      "position('nbvoice-recording:' in userfield) > 0",
    ];
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(src ILIKE $${values.length} OR dst ILIKE $${values.length} OR clid ILIKE $${values.length})`);
    }
    values.push(limit);
    const result = await pool.query<RecordingRow>(
      `WITH recordings AS (
         SELECT DISTINCT ON (COALESCE(NULLIF(linkedid, ''), NULLIF(uniqueid, ''), id::text))
                id, calldate, clid, src, dst, duration, billsec, userfield, linkedid,
                COALESCE(NULLIF(linkedid, ''), NULLIF(uniqueid, ''), id::text) AS call_key
           FROM call_detail_records
          WHERE ${filters.join(" AND ")}
          ORDER BY COALESCE(NULLIF(linkedid, ''), NULLIF(uniqueid, ''), id::text),
                   sequence, id
       )
       SELECT id, calldate, clid, src, dst, duration, billsec, userfield, linkedid
         FROM recordings
        ORDER BY calldate DESC
        LIMIT $${values.length}`,
      values,
    );
    const recordings = [];
    for (const row of result.rows) {
      const filename = recordingFilename(row.userfield);
      if (!filename) continue;
      const file = await recordingFileStat(filename);
      if (!file) continue;
      recordings.push({
        id: row.id,
        startedAt: row.calldate,
        callerName: row.clid,
        source: row.src || "Unknown",
        destination: row.dst || "Unknown",
        durationSeconds: Math.max(0, Number(row.duration)),
        billableSeconds: Math.max(0, Number(row.billsec)),
        sizeBytes: file.size,
        linkedId: row.linkedid,
      });
    }
    const [storage, retentionDays] = await Promise.all([
      recordingStorageSummary(),
      getRecordingRetentionDays(),
    ]);
    return { recordings, total: storage.count, storageBytes: storage.bytes, retentionDays };
  });

  app.patch<{ Body: SettingsBody }>("/api/recordings/settings", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const retentionDays = Number(request.body?.retentionDays);
    if (!(retentionChoices as readonly number[]).includes(retentionDays)) {
      return reply.code(400).send({ error: "Choose a supported recording retention period" });
    }
    await pool.query(
      `INSERT INTO settings (setting_key, setting_value, is_secret, updated_by, updated_at)
       VALUES ('recording_retention_days', $1::jsonb, false, $2, now())
       ON CONFLICT (setting_key) DO UPDATE SET
         setting_value = EXCLUDED.setting_value,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()`,
      [JSON.stringify(retentionDays), user.id],
    );
    const removed = await pruneExpiredRecordings();
    await audit("recording.retention_updated", user.id, { retentionDays, removed }, request.ip);
    return { retentionDays, removed };
  });

  app.get<{ Params: RecordingParams; Querystring: AudioQuery }>(
    "/api/recordings/:id/audio",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const recording = await recordingById(request.params.id);
      if (!recording) return reply.code(404).send({ error: "Recording not found" });
      const details = await recordingFileStat(recording.filename);
      if (!details) return reply.code(404).send({ error: "Recording file is unavailable" });

      const download = request.query.download === "1";
      reply.header("accept-ranges", "bytes");
      reply.header(
        "content-disposition",
        `${download ? "attachment" : "inline"}; filename="${recording.filename}"`,
      );
      reply.type("audio/wav");
      if (!download && request.headers.range) {
        const range = parseRange(request.headers.range, details.size);
        if (!range) {
          return reply.code(416).header("content-range", `bytes */${details.size}`).send();
        }
        reply.code(206);
        reply.header("content-range", `bytes ${range.start}-${range.end}/${details.size}`);
        reply.header("content-length", range.end - range.start + 1);
        return reply.send(createReadStream(recordingPath(recording.filename), range));
      }
      reply.header("content-length", details.size);
      return reply.send(createReadStream(recordingPath(recording.filename)));
    },
  );

  app.delete<{ Params: RecordingParams }>("/api/recordings/:id", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const recording = await recordingById(request.params.id);
    if (!recording) return reply.code(404).send({ error: "Recording not found" });
    await deleteRecordingFile(recording.filename, "deleted");
    await audit("recording.deleted", user.id, {
      callId: recording.id,
      source: recording.src,
      destination: recording.dst,
    }, request.ip);
    return reply.code(204).send();
  });

  app.get<{ Querystring: RecordingQuery }>("/api/customer/recordings", async (request, reply) => {
    const user = await requireCustomer(request, reply);
    if (!user?.customerId) return;
    await pruneExpiredRecordings();
    const entitlement = await customerRecordingEntitlement(user.customerId);
    if (!entitlement?.active || !entitlement.plan_enabled) {
      return reply.code(403).send({ error: "Customer recording archive is unavailable" });
    }
    const search = request.query.search?.trim().slice(0, 80) ?? "";
    const requestedLimit = Number.parseInt(request.query.limit ?? "50", 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, requestedLimit))
      : 50;
    const values: unknown[] = [user.customerId];
    const filters = [
      "upper(records.disposition) = 'ANSWERED'",
      "position('nbvoice-recording:' in records.userfield) > 0",
    ];
    if (search) {
      values.push(`%${search}%`);
      filters.push(
        `(records.src ILIKE $${values.length} OR records.dst ILIKE $${values.length} OR records.clid ILIKE $${values.length})`,
      );
    }
    values.push(limit);
    const result = await pool.query<RecordingRow>(
      `WITH owned_calls AS (
         SELECT DISTINCT COALESCE(
                  NULLIF(legs.linkedid, ''), NULLIF(legs.uniqueid, ''), legs.id::text
                ) AS call_key
           FROM call_detail_records AS legs
           JOIN extensions
             ON extensions.extension_number=legs.src
             OR extensions.extension_number=legs.dst
           JOIN customer_extensions AS assignments
             ON assignments.extension_id=extensions.id
          WHERE assignments.customer_id=$1
       ), recordings AS (
         SELECT DISTINCT ON (COALESCE(
                  NULLIF(records.linkedid, ''), NULLIF(records.uniqueid, ''), records.id::text
                ))
                records.id, records.calldate, records.clid, records.src, records.dst,
                records.duration, records.billsec, records.userfield, records.linkedid,
                COALESCE(NULLIF(records.linkedid, ''), NULLIF(records.uniqueid, ''), records.id::text) AS call_key
           FROM call_detail_records AS records
           JOIN owned_calls ON owned_calls.call_key=COALESCE(
             NULLIF(records.linkedid, ''), NULLIF(records.uniqueid, ''), records.id::text
           )
          WHERE ${filters.join(" AND ")}
          ORDER BY COALESCE(
                     NULLIF(records.linkedid, ''), NULLIF(records.uniqueid, ''), records.id::text
                   ), records.sequence, records.id
       )
       SELECT id, calldate, clid, src, dst, duration, billsec, userfield, linkedid
         FROM recordings
        ORDER BY calldate DESC
        LIMIT $${values.length}`,
      values,
    );
    const recordings = [];
    for (const row of result.rows) {
      const filename = recordingFilename(row.userfield);
      if (!filename) continue;
      const file = await recordingFileStat(filename);
      if (!file) continue;
      recordings.push({
        id: row.id,
        startedAt: row.calldate,
        callerName: row.clid,
        source: row.src || "Unknown",
        destination: row.dst || "Unknown",
        durationSeconds: Math.max(0, Number(row.duration)),
        billableSeconds: Math.max(0, Number(row.billsec)),
        sizeBytes: file.size,
        linkedId: row.linkedid,
      });
    }
    const [storage, retentionDays] = await Promise.all([
      customerRecordingStorageSummary(user.customerId),
      getRecordingRetentionDays(),
    ]);
    const storageLimitBytes = Math.max(0, entitlement.recording_storage_mb) * 1024 * 1024;
    return {
      recordings,
      total: storage.count,
      storageBytes: storage.bytes,
      storageLimitBytes,
      storagePercent: storageLimitBytes > 0
        ? Math.min(100, Math.round((storage.bytes / storageLimitBytes) * 100))
        : 0,
      recordingEnabled: entitlement.recording_enabled,
      recordingReason: entitlement.recording_enabled
        ? ""
        : "Call recording is not included in this service plan",
      retentionDays,
    };
  });

  app.get<{ Params: RecordingParams; Querystring: AudioQuery }>(
    "/api/customer/recordings/:id/audio",
    async (request, reply) => {
      const user = await requireCustomer(request, reply);
      if (!user?.customerId) return;
      const entitlement = await customerRecordingEntitlement(user.customerId);
      if (!entitlement?.active || !entitlement.plan_enabled) {
        return reply.code(403).send({ error: "Customer recording archive is unavailable" });
      }
      if (!(await customerOwnsRecording(user.customerId, request.params.id))) {
        return reply.code(404).send({ error: "Recording not found" });
      }
      const recording = await recordingById(request.params.id);
      if (!recording) return reply.code(404).send({ error: "Recording not found" });
      const details = await recordingFileStat(recording.filename);
      if (!details) return reply.code(404).send({ error: "Recording file is unavailable" });
      const download = request.query.download === "1";
      reply.header("accept-ranges", "bytes");
      reply.header(
        "content-disposition",
        `${download ? "attachment" : "inline"}; filename="${recording.filename}"`,
      );
      reply.type("audio/wav");
      if (!download && request.headers.range) {
        const range = parseRange(request.headers.range, details.size);
        if (!range) {
          return reply.code(416).header("content-range", `bytes */${details.size}`).send();
        }
        reply.code(206);
        reply.header("content-range", `bytes ${range.start}-${range.end}/${details.size}`);
        reply.header("content-length", range.end - range.start + 1);
        return reply.send(createReadStream(recordingPath(recording.filename), range));
      }
      reply.header("content-length", details.size);
      return reply.send(createReadStream(recordingPath(recording.filename)));
    },
  );

  app.delete<{ Params: RecordingParams }>(
    "/api/customer/recordings/:id",
    async (request, reply) => {
      const user = await requireCustomer(request, reply);
      if (!user?.customerId) return;
      const entitlement = await customerRecordingEntitlement(user.customerId);
      if (!entitlement?.active || !entitlement.plan_enabled) {
        return reply.code(403).send({ error: "Customer recording archive is unavailable" });
      }
      if (!(await customerOwnsRecording(user.customerId, request.params.id))) {
        return reply.code(404).send({ error: "Recording not found" });
      }
      const recording = await recordingById(request.params.id);
      if (!recording) return reply.code(404).send({ error: "Recording not found" });
      await deleteRecordingFile(recording.filename, "deleted");
      await audit("customer.recording.deleted", user.id, {
        customerId: user.customerId,
        callId: recording.id,
        source: recording.src,
        destination: recording.dst,
      }, request.ip);
      return reply.code(204).send();
    },
  );
}
