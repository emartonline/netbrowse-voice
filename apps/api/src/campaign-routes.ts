import type { FastifyInstance } from "fastify";
import { requireAdministrator } from "./auth.js";
import { normalizeE164, parseContactImport, validTimeZone } from "./campaigns.js";
import { audit, pool } from "./database.js";
import { validUuid } from "./queue-agent-state.js";

type CampaignStatus = "draft" | "ready" | "running" | "paused" | "completed" | "archived";
type DialingMode = "preview" | "progressive" | "ai";
type DestinationType = "human_queue" | "ai_receptionist";

interface CampaignBody {
  name?: string;
  description?: string;
  dialingMode?: DialingMode;
  destinationType?: DestinationType;
  destinationId?: string;
  sipTrunkId?: string | null;
  outboundCallerId?: string | null;
  callsPerMinute?: number;
  maxConcurrentCalls?: number;
  maxAttempts?: number;
  retryDelayMinutes?: number;
  callingWindowStart?: string;
  callingWindowEnd?: string;
  timezone?: string;
  callingDays?: number[];
  ringTimeoutSeconds?: number;
  complianceAttested?: boolean;
}

interface CampaignRow {
  id: string;
  name: string;
  description: string;
  status: CampaignStatus;
  dialing_mode: DialingMode;
  destination_type: DestinationType;
  destination_call_group_id: string | null;
  destination_ai_receptionist_id: string | null;
  sip_trunk_id: string | null;
  outbound_caller_id: string | null;
  calls_per_minute: number;
  max_concurrent_calls: number;
  max_attempts: number;
  retry_delay_minutes: number;
  calling_window_start: string;
  calling_window_end: string;
  timezone: string;
  calling_days: number[];
  ring_timeout_seconds: number;
  compliance_attested: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface IdParams { id: string }
interface ContactParams { id: string; contactId: string }
interface ImportBody { contacts?: string }
interface StatusBody { status?: CampaignStatus }
interface SuppressionBody {
  phone?: string;
  reason?: "requested" | "manual" | "regulatory";
  notes?: string;
  confirmRemoval?: boolean;
}

interface CampaignValues {
  name: string;
  description: string;
  dialingMode: DialingMode;
  destinationType: DestinationType;
  destinationId: string;
  sipTrunkId: string | null;
  outboundCallerId: string | null;
  callsPerMinute: number;
  maxConcurrentCalls: number;
  maxAttempts: number;
  retryDelayMinutes: number;
  callingWindowStart: string;
  callingWindowEnd: string;
  timezone: string;
  callingDays: number[];
  ringTimeoutSeconds: number;
  complianceAttested: boolean;
}

const campaignColumns = `id, name, description, status, dialing_mode,
  destination_type, destination_call_group_id,
  destination_ai_receptionist_id, sip_trunk_id, outbound_caller_id,
  calls_per_minute, max_concurrent_calls, max_attempts, retry_delay_minutes,
  calling_window_start::text, calling_window_end::text, timezone,
  calling_days, ring_timeout_seconds,
  compliance_attested, created_by, created_at, updated_at`;

function callingDaysValue(value: unknown, fallback: number[]): number[] {
  const result = value === undefined ? fallback : value;
  if (!Array.isArray(result)) throw new Error("Choose at least one calling day");
  const normalized = [...new Set(result)];
  if (
    normalized.length < 1 || normalized.length > 7 ||
    normalized.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  ) {
    throw new Error("Choose valid calling days");
  }
  return normalized.sort((left, right) => left - right);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  const number = typeof value === "number" ? value : fallback;
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return number;
}

function timeValue(value: string | undefined, fallback: string): string {
  const result = value ?? fallback;
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(result)) {
    throw new Error("Choose a valid calling window");
  }
  return result;
}

function normalizedCampaignBody(body: CampaignBody, existing?: CampaignRow): CampaignValues {
  const destinationType = body.destinationType ?? existing?.destination_type ?? "human_queue";
  const dialingMode = body.dialingMode ?? existing?.dialing_mode ??
    (destinationType === "ai_receptionist" ? "ai" : "progressive");
  const destinationId = body.destinationId ??
    (destinationType === "human_queue"
      ? existing?.destination_call_group_id
      : existing?.destination_ai_receptionist_id) ?? "";
  const name = body.name?.trim() ?? existing?.name ?? "";
  const description = body.description?.trim() ?? existing?.description ?? "";
  const sipTrunkId = body.sipTrunkId === undefined ? existing?.sip_trunk_id ?? null : body.sipTrunkId || null;
  const rawCallerId = body.outboundCallerId === undefined
    ? existing?.outbound_caller_id ?? null
    : body.outboundCallerId?.trim() || null;
  const outboundCallerId = rawCallerId ? normalizeE164(rawCallerId) : null;
  const callingWindowStart = timeValue(body.callingWindowStart, existing?.calling_window_start.slice(0, 5) ?? "08:00");
  const callingWindowEnd = timeValue(body.callingWindowEnd, existing?.calling_window_end.slice(0, 5) ?? "18:00");
  const timezone = body.timezone?.trim() ?? existing?.timezone ?? "Africa/Johannesburg";
  const callingDays = callingDaysValue(body.callingDays, existing?.calling_days ?? [1, 2, 3, 4, 5]);

  if (name.length < 2 || name.length > 100) throw new Error("Enter a valid campaign name");
  if (description.length > 1000) throw new Error("Campaign description is too long");
  if (!(["human_queue", "ai_receptionist"] as string[]).includes(destinationType)) {
    throw new Error("Choose a valid campaign destination");
  }
  if (!validUuid(destinationId)) throw new Error("Choose a valid campaign destination");
  if (destinationType === "ai_receptionist" && dialingMode !== "ai") {
    throw new Error("AI destinations require AI dialing mode");
  }
  if (destinationType === "human_queue" && !(["preview", "progressive"] as string[]).includes(dialingMode)) {
    throw new Error("Human queues require preview or progressive mode");
  }
  if (sipTrunkId && !validUuid(sipTrunkId)) throw new Error("Choose a valid SIP trunk");
  if (rawCallerId && !outboundCallerId) throw new Error("Caller ID must use full international format, such as +27101234567");
  if (callingWindowStart >= callingWindowEnd) throw new Error("Calling window end must be after its start");
  if (!validTimeZone(timezone)) throw new Error("Choose a valid IANA timezone");
  const complianceAttested = body.complianceAttested ?? existing?.compliance_attested ?? false;
  if (typeof complianceAttested !== "boolean") throw new Error("Invalid compliance confirmation");

  return {
    name,
    description,
    dialingMode,
    destinationType,
    destinationId,
    sipTrunkId,
    outboundCallerId,
    callsPerMinute: boundedInteger(body.callsPerMinute, existing?.calls_per_minute ?? 10, 1, 60, "Calls per minute"),
    maxConcurrentCalls: boundedInteger(body.maxConcurrentCalls, existing?.max_concurrent_calls ?? 1, 1, 50, "Concurrent calls"),
    maxAttempts: boundedInteger(body.maxAttempts, existing?.max_attempts ?? 3, 1, 5, "Maximum attempts"),
    retryDelayMinutes: boundedInteger(body.retryDelayMinutes, existing?.retry_delay_minutes ?? 60, 5, 1440, "Retry delay"),
    callingWindowStart,
    callingWindowEnd,
    timezone,
    callingDays,
    ringTimeoutSeconds: boundedInteger(
      body.ringTimeoutSeconds,
      existing?.ring_timeout_seconds ?? 45,
      10,
      120,
      "Ring timeout",
    ),
    complianceAttested,
  };
}

async function campaignById(id: string): Promise<CampaignRow | undefined> {
  if (!validUuid(id)) return undefined;
  const result = await pool.query<CampaignRow>(
    `SELECT ${campaignColumns} FROM outbound_campaigns WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

async function destinationAvailable(values: CampaignValues): Promise<boolean> {
  if (values.destinationType === "human_queue") {
    const result = await pool.query<{ available: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM call_groups
          WHERE id = $1 AND group_type = 'queue' AND enabled = true
       ) AS available`,
      [values.destinationId],
    );
    return result.rows[0]?.available ?? false;
  }
  const result = await pool.query<{ available: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM ai_receptionists WHERE id = $1 AND enabled = true
     ) AS available`,
    [values.destinationId],
  );
  return result.rows[0]?.available ?? false;
}

async function trunkAvailable(id: string | null): Promise<boolean> {
  if (!id) return true;
  const result = await pool.query<{ available: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM sip_trunks WHERE id = $1 AND enabled = true) AS available",
    [id],
  );
  return result.rows[0]?.available ?? false;
}

function publicCampaign(row: CampaignRow, countMap: Map<string, Record<string, number>>, destinations: Map<string, string>, trunks: Map<string, string>) {
  const counts = countMap.get(row.id) ?? {};
  const destinationId = row.destination_call_group_id ?? row.destination_ai_receptionist_id ?? "";
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    dialingMode: row.dialing_mode,
    destinationType: row.destination_type,
    destinationId,
    destinationName: destinations.get(destinationId) ?? "Unavailable",
    sipTrunkId: row.sip_trunk_id,
    sipTrunkName: row.sip_trunk_id ? trunks.get(row.sip_trunk_id) ?? "Unavailable" : null,
    outboundCallerId: row.outbound_caller_id,
    callsPerMinute: row.calls_per_minute,
    maxConcurrentCalls: row.max_concurrent_calls,
    maxAttempts: row.max_attempts,
    retryDelayMinutes: row.retry_delay_minutes,
    callingWindowStart: row.calling_window_start.slice(0, 5),
    callingWindowEnd: row.calling_window_end.slice(0, 5),
    timezone: row.timezone,
    callingDays: row.calling_days,
    ringTimeoutSeconds: row.ring_timeout_seconds,
    complianceAttested: row.compliance_attested,
    counts: {
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
      ready: counts.ready ?? 0,
      suppressed: counts.suppressed ?? 0,
      completed: counts.completed ?? 0,
      answered: counts.answered ?? 0,
      active: counts.in_progress ?? 0,
      failed: (counts.failed ?? 0) + (counts.no_answer ?? 0) + (counts.busy ?? 0),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function registerCampaignRoutes(app: FastifyInstance): void {
  app.get("/api/campaigns", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const [campaigns, counts, contacts, suppressions, queues, aiAgents, trunks] = await Promise.all([
      pool.query<CampaignRow>(`SELECT ${campaignColumns} FROM outbound_campaigns ORDER BY updated_at DESC`),
      pool.query<{ campaign_id: string; status: string; count: string }>(
        `SELECT campaign_id, status, count(*)::text AS count
           FROM outbound_campaign_contacts GROUP BY campaign_id, status`,
      ),
      pool.query<{
        id: string; campaign_id: string; phone_e164: string; first_name: string;
        last_name: string; external_reference: string; status: string;
        attempt_count: number; last_result: string | null; created_at: Date;
      }>(
        `SELECT id, campaign_id, phone_e164, first_name, last_name,
                external_reference, status, attempt_count, last_result, created_at
           FROM outbound_campaign_contacts
          ORDER BY created_at DESC LIMIT 200`,
      ),
      pool.query<{
        id: string; phone_e164: string; reason: string; notes: string; created_at: Date;
      }>(
        `SELECT id, phone_e164, reason, notes, created_at
           FROM outbound_suppressions ORDER BY created_at DESC LIMIT 200`,
      ),
      pool.query<{ id: string; name: string; extension_number: string }>(
        `SELECT id, name, extension_number FROM call_groups
          WHERE group_type = 'queue' AND enabled = true
          ORDER BY name`,
      ),
      pool.query<{ id: string; name: string; extension_number: string }>(
        `SELECT id, name, extension_number FROM ai_receptionists
          WHERE enabled = true ORDER BY name`,
      ),
      pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM sip_trunks WHERE enabled = true ORDER BY name`,
      ),
    ]);
    const countMap = new Map<string, Record<string, number>>();
    for (const row of counts.rows) {
      const values = countMap.get(row.campaign_id) ?? {};
      values[row.status] = Number(row.count);
      countMap.set(row.campaign_id, values);
    }
    const destinations = new Map([
      ...queues.rows.map((row) => [row.id, `${row.extension_number} · ${row.name}`] as const),
      ...aiAgents.rows.map((row) => [row.id, `${row.extension_number} · ${row.name}`] as const),
    ]);
    const trunkMap = new Map(trunks.rows.map((row) => [row.id, row.name]));
    return {
      campaigns: campaigns.rows.map((row) => publicCampaign(row, countMap, destinations, trunkMap)),
      contacts: contacts.rows.map((row) => ({
        id: row.id,
        campaignId: row.campaign_id,
        phoneE164: row.phone_e164,
        firstName: row.first_name,
        lastName: row.last_name,
        externalReference: row.external_reference,
        status: row.status,
        attemptCount: row.attempt_count,
        lastResult: row.last_result,
        createdAt: row.created_at,
      })),
      suppressions: suppressions.rows.map((row) => ({
        id: row.id, phoneE164: row.phone_e164, reason: row.reason,
        notes: row.notes, createdAt: row.created_at,
      })),
      options: {
        queues: queues.rows.map((row) => ({ id: row.id, name: row.name, internalNumber: row.extension_number })),
        aiAgents: aiAgents.rows.map((row) => ({ id: row.id, name: row.name, internalNumber: row.extension_number })),
        trunks: trunks.rows,
      },
      dialerEnabled: true,
    };
  });

  app.post<{ Body: CampaignBody }>("/api/campaigns", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    let values: CampaignValues;
    try {
      values = normalizedCampaignBody(request.body ?? {});
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
    if (!await destinationAvailable(values)) {
      return reply.code(400).send({ error: "Choose an enabled queue or AI receptionist" });
    }
    if (!await trunkAvailable(values.sipTrunkId)) {
      return reply.code(400).send({ error: "Choose an enabled SIP trunk" });
    }
    try {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO outbound_campaigns
           (name, description, dialing_mode, destination_type,
            destination_call_group_id, destination_ai_receptionist_id,
            sip_trunk_id, outbound_caller_id, calls_per_minute,
            max_concurrent_calls, max_attempts, retry_delay_minutes,
            calling_window_start, calling_window_end, timezone,
            calling_days, ring_timeout_seconds,
            compliance_attested, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING id`,
        [
          values.name, values.description, values.dialingMode, values.destinationType,
          values.destinationType === "human_queue" ? values.destinationId : null,
          values.destinationType === "ai_receptionist" ? values.destinationId : null,
          values.sipTrunkId, values.outboundCallerId, values.callsPerMinute,
          values.maxConcurrentCalls, values.maxAttempts, values.retryDelayMinutes,
          values.callingWindowStart, values.callingWindowEnd, values.timezone,
          values.callingDays, values.ringTimeoutSeconds,
          values.complianceAttested, user.id,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error("Campaign insert returned no id");
      await audit("campaign.created", user.id, { campaignId: id }, request.ip);
      return reply.code(201).send({ id });
    } catch (error) {
      request.log.error({ error }, "Campaign creation failed");
      return reply.code(500).send({ error: "The campaign could not be created" });
    }
  });

  app.patch<{ Params: IdParams; Body: CampaignBody }>("/api/campaigns/:id", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const existing = await campaignById(request.params.id);
    if (!existing) return reply.code(404).send({ error: "Campaign not found" });
    if (existing.status === "running") {
      return reply.code(409).send({ error: "Pause the campaign before editing it" });
    }
    let values: CampaignValues;
    try {
      values = normalizedCampaignBody(request.body ?? {}, existing);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
    if (!await destinationAvailable(values)) {
      return reply.code(400).send({ error: "Choose an enabled queue or AI receptionist" });
    }
    if (!await trunkAvailable(values.sipTrunkId)) {
      return reply.code(400).send({ error: "Choose an enabled SIP trunk" });
    }
    const status = (["ready", "paused", "completed"] as string[]).includes(existing.status)
      ? "draft"
      : existing.status;
    try {
      await pool.query(
        `UPDATE outbound_campaigns SET
           name=$2, description=$3, status=$4, dialing_mode=$5,
           destination_type=$6, destination_call_group_id=$7,
           destination_ai_receptionist_id=$8, sip_trunk_id=$9,
           outbound_caller_id=$10, calls_per_minute=$11,
           max_concurrent_calls=$12, max_attempts=$13,
           retry_delay_minutes=$14, calling_window_start=$15,
           calling_window_end=$16, timezone=$17,
           calling_days=$18, ring_timeout_seconds=$19,
           compliance_attested=$20, updated_at=now()
         WHERE id=$1`,
        [
          existing.id, values.name, values.description, status, values.dialingMode,
          values.destinationType,
          values.destinationType === "human_queue" ? values.destinationId : null,
          values.destinationType === "ai_receptionist" ? values.destinationId : null,
          values.sipTrunkId, values.outboundCallerId, values.callsPerMinute,
          values.maxConcurrentCalls, values.maxAttempts, values.retryDelayMinutes,
          values.callingWindowStart, values.callingWindowEnd, values.timezone,
          values.callingDays, values.ringTimeoutSeconds, values.complianceAttested,
        ],
      );
      await audit("campaign.updated", user.id, { campaignId: existing.id }, request.ip);
      return { ok: true };
    } catch (error) {
      request.log.error({ error }, "Campaign update failed");
      return reply.code(500).send({ error: "The campaign could not be updated" });
    }
  });

  app.delete<{ Params: IdParams }>("/api/campaigns/:id", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const existing = await campaignById(request.params.id);
    if (!existing) return reply.code(404).send({ error: "Campaign not found" });
    if (existing.status === "running") {
      return reply.code(409).send({ error: "Pause the campaign before deleting it" });
    }
    await pool.query("DELETE FROM outbound_campaigns WHERE id = $1", [existing.id]);
    await audit("campaign.deleted", user.id, { campaignId: existing.id }, request.ip);
    return reply.code(204).send();
  });

  app.patch<{ Params: IdParams; Body: StatusBody }>(
    "/api/campaigns/:id/status",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const existing = await campaignById(request.params.id);
      if (!existing) return reply.code(404).send({ error: "Campaign not found" });
      const status = request.body?.status;
      if (!status || !(["draft", "ready", "running", "paused", "completed", "archived"] as string[]).includes(status)) {
        return reply.code(400).send({ error: "Choose a valid campaign state" });
      }
      if (existing.status === "running" && status !== "paused") {
        return reply.code(409).send({ error: "Pause the running campaign before changing its state" });
      }
      if (status === "ready" || status === "running") {
        const currentValues = normalizedCampaignBody({}, existing);
        if (!await destinationAvailable(currentValues)) {
          return reply.code(409).send({ error: "The selected queue or AI receptionist is unavailable" });
        }
        if (!await trunkAvailable(existing.sip_trunk_id)) {
          return reply.code(409).send({ error: "The selected SIP trunk is unavailable" });
        }
        const readyContacts = await pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM outbound_campaign_contacts WHERE campaign_id = $1 AND status = 'ready'",
          [existing.id],
        );
        if (!existing.compliance_attested) {
          return reply.code(409).send({ error: "Confirm the campaign compliance statement first" });
        }
        if (!existing.sip_trunk_id || !existing.outbound_caller_id) {
          return reply.code(409).send({ error: "Assign an outbound trunk and verified caller ID before marking ready" });
        }
        if (Number(readyContacts.rows[0]?.count ?? 0) === 0) {
          const retryableContacts = await pool.query<{ count: string }>(
            `SELECT count(*)::text AS count
               FROM outbound_campaign_contacts
              WHERE campaign_id=$1
                AND status IN ('no_answer', 'busy', 'failed')
                AND attempt_count < $2`,
            [existing.id, existing.max_attempts],
          );
          if (Number(retryableContacts.rows[0]?.count ?? 0) === 0) {
            return reply.code(409).send({ error: "Import at least one non-suppressed contact first" });
          }
        }
      }
      if (status === "running") {
        if (!(existing.status === "ready" || existing.status === "paused")) {
          return reply.code(409).send({ error: "Mark the campaign ready before starting it" });
        }
        if (existing.dialing_mode === "preview") {
          return reply.code(409).send({ error: "Preview campaigns require an agent-led call workflow; choose progressive mode to automate" });
        }
      }
      if (status === "paused" && existing.status !== "running") {
        return reply.code(409).send({ error: "Only a running campaign can be paused" });
      }
      await pool.query(
        "UPDATE outbound_campaigns SET status = $2, updated_at = now() WHERE id = $1",
        [existing.id, status],
      );
      await audit("campaign.status_changed", user.id, {
        campaignId: existing.id, previousStatus: existing.status, status,
      }, request.ip);
      return { ok: true, status };
    },
  );

  app.post<{ Params: IdParams; Body: ImportBody }>(
    "/api/campaigns/:id/contacts/import",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const campaign = await campaignById(request.params.id);
      if (!campaign) return reply.code(404).send({ error: "Campaign not found" });
      if (["running", "completed", "archived"].includes(campaign.status)) {
        return reply.code(409).send({ error: "Reopen the campaign before importing contacts" });
      }
      const parsed = parseContactImport(request.body?.contacts ?? "");
      if (parsed.contacts.length === 0) {
        return reply.code(400).send({ error: "No valid international-format contacts were found" });
      }
      const suppressed = await pool.query<{ phone_e164: string }>(
        "SELECT phone_e164 FROM outbound_suppressions WHERE phone_e164 = ANY($1::text[])",
        [parsed.contacts.map((contact) => contact.phoneE164)],
      );
      const suppressedSet = new Set(suppressed.rows.map((row) => row.phone_e164));
      const client = await pool.connect();
      let inserted = 0;
      let existingDuplicates = 0;
      let suppressedInserted = 0;
      try {
        await client.query("BEGIN");
        for (const contact of parsed.contacts) {
          const isSuppressed = suppressedSet.has(contact.phoneE164);
          const result = await client.query(
            `INSERT INTO outbound_campaign_contacts
               (campaign_id, phone_e164, first_name, last_name,
                external_reference, status)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (campaign_id, phone_e164) DO NOTHING
             RETURNING id`,
            [campaign.id, contact.phoneE164, contact.firstName, contact.lastName,
              contact.externalReference, isSuppressed ? "suppressed" : "ready"],
          );
          if (result.rowCount === 1) {
            inserted += 1;
            if (isSuppressed) suppressedInserted += 1;
          } else {
            existingDuplicates += 1;
          }
        }
        await client.query(
          `UPDATE outbound_campaigns
              SET status = CASE WHEN status IN ('ready', 'paused') THEN 'draft' ELSE status END,
                  updated_at = now()
            WHERE id = $1`,
          [campaign.id],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      await audit("campaign.contacts.imported", user.id, {
        campaignId: campaign.id, inserted, suppressed: suppressedInserted,
        invalid: parsed.invalidLines,
        duplicates: parsed.duplicateLines + existingDuplicates,
      }, request.ip);
      return {
        inserted,
        suppressed: suppressedInserted,
        invalid: parsed.invalidLines,
        duplicates: parsed.duplicateLines + existingDuplicates,
      };
    },
  );

  app.delete<{ Params: ContactParams }>(
    "/api/campaigns/:id/contacts/:contactId",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      if (!validUuid(request.params.id) || !validUuid(request.params.contactId)) {
        return reply.code(404).send({ error: "Campaign contact not found" });
      }
      const campaign = await campaignById(request.params.id);
      if (campaign?.status === "running") {
        return reply.code(409).send({ error: "Pause the campaign before deleting contacts" });
      }
      const result = await pool.query(
        `DELETE FROM outbound_campaign_contacts
          WHERE id = $1 AND campaign_id = $2
          RETURNING phone_e164`,
        [request.params.contactId, request.params.id],
      );
      if (result.rowCount !== 1) return reply.code(404).send({ error: "Campaign contact not found" });
      await pool.query(
        `UPDATE outbound_campaigns
            SET status = CASE WHEN status IN ('ready', 'paused') THEN 'draft' ELSE status END,
                updated_at = now()
          WHERE id = $1`,
        [request.params.id],
      );
      await audit("campaign.contact.deleted", user.id, {
        campaignId: request.params.id, contactId: request.params.contactId,
      }, request.ip);
      return reply.code(204).send();
    },
  );

  app.post<{ Body: SuppressionBody }>("/api/campaigns/suppressions", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const phoneE164 = normalizeE164(request.body?.phone ?? "");
    const reason = request.body?.reason ?? "requested";
    const notes = request.body?.notes?.trim() ?? "";
    if (!phoneE164) return reply.code(400).send({ error: "Enter a valid international-format number" });
    if (!(["requested", "manual", "regulatory"] as string[]).includes(reason)) {
      return reply.code(400).send({ error: "Choose a valid suppression reason" });
    }
    if (notes.length > 500) return reply.code(400).send({ error: "Suppression notes are too long" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO outbound_suppressions (phone_e164, reason, notes, created_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (phone_e164) DO NOTHING RETURNING id`,
        [phoneE164, reason, notes, user.id],
      );
      if (inserted.rowCount !== 1) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "That number is already suppressed" });
      }
      await client.query(
        `UPDATE outbound_campaign_contacts
            SET status = 'suppressed', updated_at = now()
          WHERE phone_e164 = $1
            AND status IN ('ready', 'no_answer', 'busy', 'failed')`,
        [phoneE164],
      );
      await client.query(
        `UPDATE outbound_campaigns
            SET status = CASE WHEN status IN ('ready', 'paused') THEN 'draft' ELSE status END,
                updated_at = now()
          WHERE id IN (
            SELECT campaign_id FROM outbound_campaign_contacts WHERE phone_e164 = $1
          )`,
        [phoneE164],
      );
      await client.query("COMMIT");
      await audit("campaign.suppression.created", user.id, { phoneE164, reason }, request.ip);
      return reply.code(201).send({ id: inserted.rows[0]?.id });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      request.log.error({ error }, "Suppression creation failed");
      return reply.code(500).send({ error: "The suppression could not be created" });
    } finally {
      client.release();
    }
  });

  app.delete<{ Params: IdParams; Body: SuppressionBody }>(
    "/api/campaigns/suppressions/:id",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Suppression not found" });
      if (request.body?.confirmRemoval !== true) {
        return reply.code(400).send({ error: "Explicit confirmation is required" });
      }
      const result = await pool.query<{ phone_e164: string }>(
        "DELETE FROM outbound_suppressions WHERE id = $1 RETURNING phone_e164",
        [request.params.id],
      );
      const phoneE164 = result.rows[0]?.phone_e164;
      if (!phoneE164) return reply.code(404).send({ error: "Suppression not found" });
      await audit("campaign.suppression.deleted", user.id, { phoneE164 }, request.ip);
      return reply.code(204).send();
    },
  );
}
