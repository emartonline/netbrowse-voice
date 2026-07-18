import type { FastifyInstance } from "fastify";
import { requireAdministrator } from "./auth.js";
import {
  callDirection,
  getActiveCalls,
  normalizeDisposition,
  type CallDisposition,
} from "./calls.js";
import { pool } from "./database.js";
import { recordingFilename } from "./recordings.js";

interface HistoryQuery {
  limit?: string;
  offset?: string;
  search?: string;
  status?: string;
}

interface CdrRow {
  id: string;
  calldate: Date;
  clid: string;
  src: string;
  dst: string;
  dcontext: string;
  duration: number;
  billsec: number;
  disposition: string;
  peeraccount: string;
  uniqueid: string;
  linkedid: string;
  userfield: string;
}

const rankedCalls = `WITH ranked_calls AS (
  SELECT records.*,
         row_number() OVER (
           PARTITION BY COALESCE(
             NULLIF(records.linkedid, ''),
             NULLIF(records.uniqueid, ''),
             records.id::text
           )
           ORDER BY
             CASE
               WHEN records.dcontext = 'nbvoice-internal' THEN 0
               WHEN records.dcontext LIKE 'nbvt-%-inbound' THEN 1
               ELSE 2
             END,
             records.sequence,
             records.id
         ) AS leg_rank
    FROM call_detail_records AS records
), calls AS (
  SELECT * FROM ranked_calls WHERE leg_rank = 1
)`;

function callStatusSql(alias: string): string {
  return `(CASE
    WHEN upper(COALESCE(${alias}.peeraccount, '')) = 'NBVOICE:ANSWER' THEN 'answered'
    WHEN upper(COALESCE(${alias}.peeraccount, '')) = 'NBVOICE:NOANSWER' THEN 'missed'
    WHEN upper(COALESCE(${alias}.peeraccount, '')) = 'NBVOICE:BUSY' THEN 'busy'
    WHEN upper(COALESCE(${alias}.peeraccount, '')) IN (
      'NBVOICE:CHANUNAVAIL', 'NBVOICE:CONGESTION', 'NBVOICE:DONTCALL',
      'NBVOICE:TORTURE', 'NBVOICE:INVALIDARGS'
    ) THEN 'failed'
    WHEN upper(${alias}.disposition) = 'ANSWERED' THEN 'answered'
    WHEN upper(${alias}.disposition) = 'NO ANSWER'
      AND ${alias}.dcontext LIKE 'nbvoice-outbound-%'
      AND ${alias}.duration <= 0 THEN 'failed'
    WHEN upper(${alias}.disposition) = 'NO ANSWER' THEN 'missed'
    WHEN upper(${alias}.disposition) = 'BUSY' THEN 'busy'
    WHEN upper(${alias}.disposition) IN ('FAILED', 'CONGESTION') THEN 'failed'
    ELSE 'unknown'
  END)`;
}

function integer(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function publicCall(row: CdrRow) {
  const duration = Math.max(0, Number(row.duration));
  const billable = Math.max(0, Math.min(duration, Number(row.billsec)));
  const recording = recordingFilename(row.userfield);
  return {
    id: row.id,
    startedAt: row.calldate,
    callerName: row.clid,
    source: row.src || "Unknown",
    destination: row.dst || "Unknown",
    direction: callDirection(row.dcontext, row.src, row.dst),
    status: normalizeDisposition(row.disposition, row.peeraccount, duration, row.dcontext),
    durationSeconds: duration,
    ringSeconds: Math.max(0, duration - billable),
    billableSeconds: billable,
    linkedId: row.linkedid || row.uniqueid,
    recordingAvailable: Boolean(recording),
    recordingId: recording ? row.id : null,
  };
}

export function registerCallRoutes(app: FastifyInstance): void {
  app.get("/api/calls/active", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    try {
      return {
        available: true,
        sampledAt: new Date().toISOString(),
        calls: await getActiveCalls(),
      };
    } catch (error) {
      request.log.warn({ error }, "Active Asterisk channel query failed");
      return {
        available: false,
        sampledAt: new Date().toISOString(),
        calls: [],
      };
    }
  });

  app.get<{ Querystring: HistoryQuery }>("/api/calls/history", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;

    const limit = integer(request.query.limit, 50, 1, 100);
    const offset = integer(request.query.offset, 0, 0, 1_000_000);
    const search = request.query.search?.trim().slice(0, 80) ?? "";
    const allowed = new Set<CallDisposition>(["answered", "missed", "busy", "failed", "unknown"]);
    const requestedStatus = request.query.status?.trim().toLowerCase() ?? "all";
    if (requestedStatus !== "all" && !allowed.has(requestedStatus as CallDisposition)) {
      return reply.code(400).send({ error: "Unknown call status filter" });
    }

    const values: unknown[] = [];
    const filters: string[] = [];
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(calls.src ILIKE $${values.length}
        OR calls.dst ILIKE $${values.length}
        OR calls.clid ILIKE $${values.length})`);
    }
    if (requestedStatus !== "all") {
      values.push(requestedStatus);
      filters.push(`${callStatusSql("calls")} = $${values.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countValues = [...values];
    const pageValues = [...values, limit, offset];
    const limitParameter = values.length + 1;
    const offsetParameter = values.length + 2;

    const [rows, totalResult, summaryResult] = await Promise.all([
      pool.query<CdrRow>(
        `${rankedCalls}
         SELECT id, calldate, clid, src, dst, dcontext, duration, billsec,
                disposition, peeraccount, uniqueid, linkedid, userfield
           FROM calls
           ${where}
          ORDER BY calldate DESC, id DESC
          LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
        pageValues,
      ),
      pool.query<{ total: string }>(
        `${rankedCalls} SELECT count(*)::text AS total FROM calls ${where}`,
        countValues,
      ),
      pool.query<{
        total: string;
        answered: string;
        missed: string;
        busy: string;
        failed: string;
        billsec: string;
      }>(
        `${rankedCalls}
         SELECT count(*)::text AS total,
                count(*) FILTER (WHERE ${callStatusSql("calls")} = 'answered')::text AS answered,
                count(*) FILTER (WHERE ${callStatusSql("calls")} = 'missed')::text AS missed,
                count(*) FILTER (WHERE ${callStatusSql("calls")} = 'busy')::text AS busy,
                count(*) FILTER (WHERE ${callStatusSql("calls")} = 'failed')::text AS failed,
                COALESCE(sum(billsec), 0)::text AS billsec
           FROM calls
          WHERE calldate >= date_trunc('day', now())`,
      ),
    ]);
    const summary = summaryResult.rows[0];
    return {
      calls: rows.rows.map(publicCall),
      total: Number(totalResult.rows[0]?.total ?? 0),
      limit,
      offset,
      summary: {
        total: Number(summary?.total ?? 0),
        answered: Number(summary?.answered ?? 0),
        missed: Number(summary?.missed ?? 0),
        busy: Number(summary?.busy ?? 0),
        failed: Number(summary?.failed ?? 0),
        billableSeconds: Number(summary?.billsec ?? 0),
      },
    };
  });
}
