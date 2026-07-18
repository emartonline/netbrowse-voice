import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { FastifyBaseLogger } from "fastify";
import type { PoolClient } from "pg";
import { config } from "./config.js";
import { pool } from "./database.js";
import { formatTrunkDialNumber, trunkSectionName } from "./trunks.js";

const execFileAsync = promisify(execFile);

type FinalAttemptStatus = "answered" | "no_answer" | "busy" | "failed";

interface CampaignRuntimeRow {
  id: string;
  destination_extension: string;
  sip_trunk_id: string;
  outbound_caller_id: string;
  calls_per_minute: number;
  max_concurrent_calls: number;
  max_attempts: number;
  retry_delay_minutes: number;
  ring_timeout_seconds: number;
  dial_prefix: string;
  strip_plus: boolean;
}

interface ClaimedAttempt {
  attemptId: string;
  campaignId: string;
  contactId: string;
  phoneE164: string;
  attemptCount: number;
}

export interface CampaignCallFile {
  attemptId: string;
  destination: string;
  destinationExtension: string;
  trunkSection: string;
  callerId: string;
  ringTimeoutSeconds: number;
}

export interface CampaignResult {
  attemptId: string;
  dialStatus: string;
}

export function renderCampaignDialplan(): string {
  return [
    "; Managed by Netbrowse Voice. Manual changes will be replaced.",
    "",
    "[nbvoice-campaign-originate]",
    "exten => s,1,NoOp(Netbrowse Voice campaign call)",
    " same => n,Set(CALLERID(num)=${NBVOICE_CAMPAIGN_CALLER_ID})",
    " same => n,Dial(PJSIP/${NBVOICE_CAMPAIGN_DESTINATION}@${NBVOICE_CAMPAIGN_TRUNK},${NBVOICE_CAMPAIGN_RING_TIMEOUT})",
    " same => n,Set(NBVOICE_CAMPAIGN_RESULT=${DIALSTATUS})",
    " same => n,Set(CDR(peeraccount)=NBVOICE:${NBVOICE_CAMPAIGN_RESULT})",
    " same => n,AGI(agi://127.0.0.1:4573/campaign-result/${NBVOICE_CAMPAIGN_ATTEMPT_ID}/${NBVOICE_CAMPAIGN_RESULT})",
    " same => n,Hangup()",
    "",
  ].join("\n");
}

export function renderCampaignCallFile(call: CampaignCallFile): string {
  if (!/^[0-9a-f-]{36}$/i.test(call.attemptId)) throw new Error("Invalid campaign attempt ID");
  if (!/^\+?[0-9]{8,21}$/.test(call.destination)) throw new Error("Invalid campaign destination");
  if (!/^[0-9]{2,8}$/.test(call.destinationExtension)) throw new Error("Invalid campaign handoff");
  if (!/^nbvt-[0-9a-f]{32}$/.test(call.trunkSection)) throw new Error("Invalid campaign trunk");
  if (!/^\+[1-9][0-9]{7,14}$/.test(call.callerId)) throw new Error("Invalid campaign caller ID");
  if (!Number.isInteger(call.ringTimeoutSeconds) || call.ringTimeoutSeconds < 10 || call.ringTimeoutSeconds > 120) {
    throw new Error("Invalid campaign ring timeout");
  }
  return [
    "Channel: Local/s@nbvoice-campaign-originate/n",
    `Callerid: ${call.callerId}`,
    "MaxRetries: 0",
    "RetryTime: 60",
    `WaitTime: ${call.ringTimeoutSeconds}`,
    "Context: nbvoice-internal",
    `Extension: ${call.destinationExtension}`,
    "Priority: 1",
    `Setvar: __NBVOICE_CAMPAIGN_ATTEMPT_ID=${call.attemptId.toLowerCase()}`,
    `Setvar: __NBVOICE_CAMPAIGN_DESTINATION=${call.destination}`,
    `Setvar: __NBVOICE_CAMPAIGN_TRUNK=${call.trunkSection}`,
    `Setvar: __NBVOICE_CAMPAIGN_CALLER_ID=${call.callerId}`,
    `Setvar: __NBVOICE_CAMPAIGN_RING_TIMEOUT=${call.ringTimeoutSeconds}`,
    "Archive: no",
    "",
  ].join("\n");
}

export function campaignResultFromAgiEnvironment(
  environment: Record<string, string>,
): CampaignResult | undefined {
  const script = environment.agi_network_script ?? environment.agi_request ?? "";
  const match = script.match(
    /(?:^|\/)campaign-result\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([A-Z_]{2,32})(?:$|\?)/i,
  );
  return match?.[1] && match[2]
    ? { attemptId: match[1].toLowerCase(), dialStatus: match[2].toUpperCase() }
    : undefined;
}

export function normalizeCampaignDialStatus(dialStatus: string): FinalAttemptStatus {
  switch (dialStatus.trim().toUpperCase()) {
    case "ANSWER": return "answered";
    case "NOANSWER": return "no_answer";
    case "BUSY": return "busy";
    default: return "failed";
  }
}

async function completeCampaignIfFinished(campaignId: string): Promise<void> {
  await pool.query(
    `UPDATE outbound_campaigns AS campaigns
        SET status = 'completed', updated_at = now()
      WHERE campaigns.id = $1
        AND campaigns.status = 'running'
        AND NOT EXISTS (
          SELECT 1 FROM outbound_campaign_contacts AS contacts
           WHERE contacts.campaign_id = campaigns.id
             AND (
               contacts.status = 'in_progress'
               OR (
                 contacts.status IN ('ready', 'no_answer', 'busy', 'failed')
                 AND contacts.attempt_count < campaigns.max_attempts
               )
             )
        )`,
    [campaignId],
  );
}

export async function recordCampaignResult(result: CampaignResult): Promise<boolean> {
  const finalStatus = normalizeCampaignDialStatus(result.dialStatus);
  const client = await pool.connect();
  let campaignId = "";
  try {
    await client.query("BEGIN");
    const attempt = await client.query<{
      campaign_id: string;
      contact_id: string;
      max_attempts: number;
      retry_delay_minutes: number;
      attempt_count: number;
    }>(
      `SELECT attempts.campaign_id, attempts.contact_id,
              campaigns.max_attempts, campaigns.retry_delay_minutes,
              contacts.attempt_count
         FROM outbound_campaign_attempts AS attempts
         JOIN outbound_campaigns AS campaigns ON campaigns.id = attempts.campaign_id
         JOIN outbound_campaign_contacts AS contacts ON contacts.id = attempts.contact_id
        WHERE attempts.id = $1 AND attempts.status IN ('queued', 'dialing')
        FOR UPDATE OF attempts, contacts`,
      [result.attemptId],
    );
    const row = attempt.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return false;
    }
    campaignId = row.campaign_id;
    await client.query(
      `UPDATE outbound_campaign_attempts
          SET status=$2, dial_status=$3, completed_at=now()
        WHERE id=$1`,
      [result.attemptId, finalStatus, result.dialStatus],
    );
    const hasRetry = finalStatus !== "answered" && row.attempt_count < row.max_attempts;
    await client.query(
      `UPDATE outbound_campaign_contacts
          SET status=$2,
              last_result=$3,
              next_attempt_at=CASE WHEN $4 THEN now() + ($5 * interval '1 minute') ELSE NULL END,
              updated_at=now()
        WHERE id=$1`,
      [
        row.contact_id,
        finalStatus,
        result.dialStatus,
        hasRetry,
        row.retry_delay_minutes,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  if (campaignId) await completeCampaignIfFinished(campaignId);
  return true;
}

async function runningCampaigns(): Promise<CampaignRuntimeRow[]> {
  const result = await pool.query<CampaignRuntimeRow>(
    `SELECT campaigns.id,
            COALESCE(groups.extension_number, agents.extension_number) AS destination_extension,
            campaigns.sip_trunk_id, campaigns.outbound_caller_id,
            campaigns.calls_per_minute, campaigns.max_concurrent_calls,
            campaigns.max_attempts, campaigns.retry_delay_minutes,
            campaigns.ring_timeout_seconds,
            trunks.dial_prefix, trunks.strip_plus
       FROM outbound_campaigns AS campaigns
       JOIN sip_trunks AS trunks
         ON trunks.id = campaigns.sip_trunk_id AND trunks.enabled = true
       LEFT JOIN call_groups AS groups
         ON groups.id = campaigns.destination_call_group_id AND groups.enabled = true
       LEFT JOIN ai_receptionists AS agents
         ON agents.id = campaigns.destination_ai_receptionist_id AND agents.enabled = true
      WHERE campaigns.status = 'running'
        AND campaigns.compliance_attested = true
        AND campaigns.sip_trunk_id IS NOT NULL
        AND campaigns.outbound_caller_id IS NOT NULL
        AND COALESCE(groups.extension_number, agents.extension_number) IS NOT NULL
        AND extract(dow FROM now() AT TIME ZONE campaigns.timezone)::smallint = ANY(campaigns.calling_days)
        AND (now() AT TIME ZONE campaigns.timezone)::time >= campaigns.calling_window_start
        AND (now() AT TIME ZONE campaigns.timezone)::time < campaigns.calling_window_end
      ORDER BY campaigns.last_started_at NULLS FIRST, campaigns.updated_at`,
  );
  return result.rows;
}

async function claimAttempts(
  client: PoolClient,
  campaign: CampaignRuntimeRow,
): Promise<ClaimedAttempt[]> {
  await client.query("BEGIN");
  const lock = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked",
    [`nbvoice-campaign:${campaign.id}`],
  );
  if (!lock.rows[0]?.locked) {
    await client.query("ROLLBACK");
    return [];
  }
  const usage = await client.query<{ active: string; recent: string }>(
    `SELECT
       count(*) FILTER (WHERE status IN ('queued', 'dialing'))::text AS active,
       count(*) FILTER (WHERE created_at >= now() - interval '1 minute')::text AS recent
     FROM outbound_campaign_attempts WHERE campaign_id = $1`,
    [campaign.id],
  );
  const active = Number(usage.rows[0]?.active ?? 0);
  const recent = Number(usage.rows[0]?.recent ?? 0);
  const capacity = Math.min(
    Math.max(0, campaign.max_concurrent_calls - active),
    Math.max(0, campaign.calls_per_minute - recent),
  );
  if (capacity === 0) {
    await client.query("COMMIT");
    return [];
  }
  const contacts = await client.query<{
    id: string;
    phone_e164: string;
    attempt_count: number;
  }>(
    `SELECT contacts.id, contacts.phone_e164, contacts.attempt_count
       FROM outbound_campaign_contacts AS contacts
      WHERE contacts.campaign_id = $1
        AND contacts.status IN ('ready', 'no_answer', 'busy', 'failed')
        AND contacts.attempt_count < $2
        AND (contacts.next_attempt_at IS NULL OR contacts.next_attempt_at <= now())
        AND NOT EXISTS (
          SELECT 1 FROM outbound_suppressions AS suppressions
           WHERE suppressions.phone_e164 = contacts.phone_e164
        )
      ORDER BY contacts.next_attempt_at NULLS FIRST, contacts.created_at
      FOR UPDATE SKIP LOCKED
      LIMIT $3`,
    [campaign.id, campaign.max_attempts, capacity],
  );
  const claimed: ClaimedAttempt[] = [];
  for (const contact of contacts.rows) {
    const attemptId = randomUUID();
    await client.query(
      `UPDATE outbound_campaign_contacts
          SET status='in_progress', attempt_count=attempt_count+1,
              next_attempt_at=NULL, updated_at=now()
        WHERE id=$1`,
      [contact.id],
    );
    await client.query(
      `INSERT INTO outbound_campaign_attempts (id, campaign_id, contact_id)
       VALUES ($1,$2,$3)`,
      [attemptId, campaign.id, contact.id],
    );
    claimed.push({
      attemptId,
      campaignId: campaign.id,
      contactId: contact.id,
      phoneE164: contact.phone_e164,
      attemptCount: contact.attempt_count + 1,
    });
  }
  if (claimed.length > 0) {
    await client.query(
      "UPDATE outbound_campaigns SET last_started_at=now(), updated_at=now() WHERE id=$1",
      [campaign.id],
    );
  }
  await client.query("COMMIT");
  return claimed;
}

async function markSubmissionFailed(attempt: ClaimedAttempt, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 200) : "call_submission_failed";
  await pool.query(
    `UPDATE outbound_campaign_attempts
        SET status='failed', error_code=$2, completed_at=now()
      WHERE id=$1`,
    [attempt.attemptId, message],
  );
  await pool.query(
    `UPDATE outbound_campaign_contacts AS contacts
        SET status='failed', last_result='SUBMISSION_FAILED',
            next_attempt_at=CASE
              WHEN contacts.attempt_count < campaigns.max_attempts
              THEN now() + (campaigns.retry_delay_minutes * interval '1 minute')
              ELSE NULL END,
            updated_at=now()
       FROM outbound_campaigns AS campaigns
      WHERE contacts.id=$1 AND campaigns.id=contacts.campaign_id`,
    [attempt.contactId],
  );
  await completeCampaignIfFinished(attempt.campaignId);
}

async function submitAttempt(
  campaign: CampaignRuntimeRow,
  attempt: ClaimedAttempt,
): Promise<void> {
  const destination = formatTrunkDialNumber(attempt.phoneE164, campaign);
  const body = renderCampaignCallFile({
    attemptId: attempt.attemptId,
    destination,
    destinationExtension: campaign.destination_extension,
    trunkSection: trunkSectionName(campaign.sip_trunk_id),
    callerId: campaign.outbound_caller_id,
    ringTimeoutSeconds: campaign.ring_timeout_seconds,
  });
  await mkdir(config.campaignOutboxDir, { recursive: true, mode: 0o770 });
  const base = `nbvoice-campaign-${attempt.attemptId}`;
  const temporary = path.join(config.campaignOutboxDir, `.${base}.tmp`);
  const request = path.join(config.campaignOutboxDir, `${base}.call`);
  await writeFile(temporary, body, { mode: 0o600, flag: "wx" });
  await rename(temporary, request);
  try {
    await execFileAsync(
      config.asteriskCampaignSubmitCommand,
      ["-n", config.asteriskCampaignSubmitHelper],
      { timeout: 8_000, maxBuffer: 64 * 1024 },
    );
    await pool.query(
      `UPDATE outbound_campaign_attempts
          SET status='dialing', submitted_at=now()
        WHERE id=$1 AND status='queued'`,
      [attempt.attemptId],
    );
  } catch (error) {
    await unlink(request).catch(() => undefined);
    throw error;
  }
}

async function recoverStaleAttempts(logger: FastifyBaseLogger): Promise<void> {
  const stale = await pool.query<{ id: string; campaign_id: string; contact_id: string }>(
    `UPDATE outbound_campaign_attempts
        SET status='failed', error_code='stale_after_restart', completed_at=now()
      WHERE status IN ('queued', 'dialing')
        AND created_at < now() - interval '2 hours'
      RETURNING id, campaign_id, contact_id`,
  );
  for (const row of stale.rows) {
    await pool.query(
      `UPDATE outbound_campaign_contacts AS contacts
          SET status='failed', last_result='STALE_AFTER_RESTART',
              next_attempt_at=CASE
                WHEN contacts.attempt_count < campaigns.max_attempts
                THEN now() + (campaigns.retry_delay_minutes * interval '1 minute')
                ELSE NULL END,
              updated_at=now()
         FROM outbound_campaigns AS campaigns
        WHERE contacts.id=$1 AND campaigns.id=contacts.campaign_id`,
      [row.contact_id],
    );
    await completeCampaignIfFinished(row.campaign_id);
  }
  if (stale.rowCount) logger.warn({ attempts: stale.rowCount }, "Recovered stale campaign attempts");
}

let tickActive = false;

export async function runCampaignDialerTick(logger: FastifyBaseLogger): Promise<void> {
  if (tickActive) return;
  tickActive = true;
  try {
    for (const campaign of await runningCampaigns()) {
      const client = await pool.connect();
      let attempts: ClaimedAttempt[] = [];
      try {
        attempts = await claimAttempts(client, campaign);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      for (const attempt of attempts) {
        try {
          await submitAttempt(campaign, attempt);
        } catch (error) {
          logger.error({ error, attemptId: attempt.attemptId }, "Campaign call submission failed");
          await markSubmissionFailed(attempt, error);
        }
      }
      if (attempts.length === 0) await completeCampaignIfFinished(campaign.id);
    }
  } finally {
    tickActive = false;
  }
}

export function startCampaignDialer(logger: FastifyBaseLogger): NodeJS.Timeout {
  void recoverStaleAttempts(logger).catch((error) =>
    logger.error({ error }, "Campaign attempt recovery failed"),
  );
  const timer = setInterval(() => {
    void runCampaignDialerTick(logger).catch((error) =>
      logger.error({ error }, "Campaign dialer tick failed"),
    );
  }, 1_000);
  timer.unref();
  logger.info("Outbound campaign dialer started");
  return timer;
}

export function stopCampaignDialer(timer: NodeJS.Timeout | undefined): void {
  if (timer) clearInterval(timer);
}
