import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { requireAdministrator } from "./auth.js";
import {
  queueIdentifier,
  type CallGroupRow,
  type CallGroupStrategy,
  type CallGroupType,
} from "./call-centre.js";
import { audit, pool } from "./database.js";
import {
  applyPbxConfiguration,
  getExtensionRegistrationStatuses,
  serializedPbxMutation,
} from "./pbx.js";
import { getQueueRuntimeStats } from "./queue-supervision.js";
import {
  QueueAgentNotFoundError,
  QueueAgentStateValidationError,
  updateQueueAgentState,
} from "./queue-agent-state.js";

interface GroupBody {
  name?: string;
  internalNumber?: string;
  groupType?: CallGroupType;
  strategy?: CallGroupStrategy;
  ringTimeoutSeconds?: number;
  retrySeconds?: number;
  maxWaitSeconds?: number;
  wrapupSeconds?: number;
  fallbackExtensionId?: string | null;
  memberExtensionIds?: string[];
  enabled?: boolean;
}

interface GroupParams { id: string }

interface AgentParams { id: string; extensionId: string }

interface AgentStateBody {
  signedIn?: boolean;
  paused?: boolean;
  pauseReason?: "break" | "lunch" | "training" | "admin" | null;
}

interface GroupMemberRow {
  call_group_id: string;
  extension_id: string;
  extension_number: string;
  display_name: string;
  enabled: boolean;
  position: number;
  signed_in: boolean;
  paused: boolean;
  pause_reason: "break" | "lunch" | "training" | "admin" | null;
}

interface ExtensionChoiceRow {
  id: string;
  extension_number: string;
  display_name: string;
  enabled: boolean;
}

interface ValidatedGroup {
  name: string;
  internalNumber: string;
  groupType: CallGroupType;
  strategy: CallGroupStrategy;
  ringTimeoutSeconds: number;
  retrySeconds: number;
  maxWaitSeconds: number;
  wrapupSeconds: number;
  fallbackExtensionId: string | null;
  memberExtensionIds: string[];
  enabled: boolean;
}

const groupColumns = `id, name, extension_number, group_type, strategy,
  ring_timeout_seconds, retry_seconds, max_wait_seconds, wrapup_seconds,
  fallback_extension_id, enabled, created_by, created_at, updated_at`;

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function groupById(id: string): Promise<CallGroupRow | undefined> {
  if (!validUuid(id)) return undefined;
  const result = await pool.query<CallGroupRow>(
    `SELECT ${groupColumns} FROM call_groups WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

async function membersForGroup(id: string): Promise<GroupMemberRow[]> {
  const result = await pool.query<GroupMemberRow>(
    `SELECT members.call_group_id, members.extension_id,
            extensions.extension_number, extensions.display_name,
            extensions.enabled, members.position,
            COALESCE(states.signed_in, true) AS signed_in,
            COALESCE(states.paused, false) AS paused,
            states.pause_reason
       FROM call_group_members AS members
       JOIN extensions ON extensions.id = members.extension_id
       LEFT JOIN call_group_agent_states AS states
         ON states.call_group_id = members.call_group_id
        AND states.extension_id = members.extension_id
      WHERE members.call_group_id = $1
      ORDER BY members.position, length(extensions.extension_number), extensions.extension_number`,
    [id],
  );
  return result.rows;
}

async function restoreGroup(row: CallGroupRow, members: GroupMemberRow[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO call_groups (${groupColumns})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, extension_number=EXCLUDED.extension_number,
         group_type=EXCLUDED.group_type, strategy=EXCLUDED.strategy,
         ring_timeout_seconds=EXCLUDED.ring_timeout_seconds,
         retry_seconds=EXCLUDED.retry_seconds, max_wait_seconds=EXCLUDED.max_wait_seconds,
         wrapup_seconds=EXCLUDED.wrapup_seconds,
         fallback_extension_id=EXCLUDED.fallback_extension_id,
         enabled=EXCLUDED.enabled, created_by=EXCLUDED.created_by,
         created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at`,
      [
        row.id, row.name, row.extension_number, row.group_type, row.strategy,
        row.ring_timeout_seconds, row.retry_seconds, row.max_wait_seconds,
        row.wrapup_seconds, row.fallback_extension_id, row.enabled,
        row.created_by, row.created_at, row.updated_at,
      ],
    );
    await client.query("DELETE FROM call_group_members WHERE call_group_id = $1", [row.id]);
    for (const member of members) {
      await client.query(
        `INSERT INTO call_group_members (call_group_id, extension_id, position)
         VALUES ($1, $2, $3)`,
        [row.id, member.extension_id, member.position],
      );
      await client.query(
        `INSERT INTO call_group_agent_states
           (call_group_id, extension_id, signed_in, paused, pause_reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.id, member.extension_id, member.signed_in, member.paused, member.pause_reason],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function validateGroup(
  body: GroupBody | undefined,
  existing?: CallGroupRow,
): Promise<{ value?: ValidatedGroup; error?: string }> {
  const name = body?.name?.trim().replace(/\s+/g, " ") ?? existing?.name ?? "";
  const internalNumber = body?.internalNumber?.trim() ?? existing?.extension_number ?? "";
  const groupType = body?.groupType ?? existing?.group_type ?? "queue";
  const strategy = body?.strategy ?? existing?.strategy ?? "ringall";
  const ringTimeoutSeconds = Number(body?.ringTimeoutSeconds ?? existing?.ring_timeout_seconds ?? 15);
  const retrySeconds = Number(body?.retrySeconds ?? existing?.retry_seconds ?? 5);
  const maxWaitSeconds = Number(body?.maxWaitSeconds ?? existing?.max_wait_seconds ?? 60);
  const wrapupSeconds = Number(body?.wrapupSeconds ?? existing?.wrapup_seconds ?? 5);
  const fallbackExtensionId = body?.fallbackExtensionId === undefined
    ? (existing?.fallback_extension_id ?? null)
    : (body.fallbackExtensionId || null);
  const memberExtensionIds = body?.memberExtensionIds ?? (
    existing ? (await membersForGroup(existing.id)).map((member) => member.extension_id) : []
  );
  const enabled = body?.enabled ?? existing?.enabled ?? true;

  if (name.length < 2 || name.length > 80 || !/^[A-Za-z0-9][A-Za-z0-9 .,'&()-]*$/.test(name)) {
    return { error: "Group name must contain between 2 and 80 basic characters" };
  }
  if (!/^[0-9]{2,8}$/.test(internalNumber)) {
    return { error: "Internal group number must contain 2 to 8 digits" };
  }
  if (groupType !== "ring_group" && groupType !== "queue") {
    return { error: "Choose a ring group or call queue" };
  }
  if (!(["ringall", "rrmemory", "leastrecent"] as string[]).includes(strategy)) {
    return { error: "Choose a valid call distribution strategy" };
  }
  if (!Number.isInteger(ringTimeoutSeconds) || ringTimeoutSeconds < 5 || ringTimeoutSeconds > 60) {
    return { error: "Member ring time must be between 5 and 60 seconds" };
  }
  if (!Number.isInteger(retrySeconds) || retrySeconds < 1 || retrySeconds > 30) {
    return { error: "Queue retry time must be between 1 and 30 seconds" };
  }
  if (!Number.isInteger(maxWaitSeconds) || maxWaitSeconds < 10 || maxWaitSeconds > 600) {
    return { error: "Maximum queue wait must be between 10 and 600 seconds" };
  }
  if (!Number.isInteger(wrapupSeconds) || wrapupSeconds < 0 || wrapupSeconds > 120) {
    return { error: "Agent wrap-up time must be between 0 and 120 seconds" };
  }
  if (typeof enabled !== "boolean") return { error: "Invalid group state" };
  const uniqueMembers = [...new Set(memberExtensionIds)];
  if (uniqueMembers.length !== memberExtensionIds.length || uniqueMembers.length < 1 || uniqueMembers.length > 50) {
    return { error: "Choose between 1 and 50 unique member extensions" };
  }
  if (uniqueMembers.some((id) => !validUuid(id))) return { error: "Choose valid member extensions" };
  if (fallbackExtensionId !== null && !validUuid(fallbackExtensionId)) {
    return { error: "Choose a valid fallback extension" };
  }

  const ignoreId = existing?.id ?? "00000000-0000-0000-0000-000000000000";
  const [numberCollision, memberResult, fallbackResult] = await Promise.all([
    pool.query(
      `SELECT 1 FROM extensions WHERE extension_number = $1
       UNION ALL SELECT 1 FROM ivr_menus WHERE extension_number = $1
       UNION ALL SELECT 1 FROM ai_receptionists WHERE extension_number = $1
       UNION ALL SELECT 1 FROM call_groups WHERE extension_number = $1 AND id <> $2::uuid
       LIMIT 1`,
      [internalNumber, ignoreId],
    ),
    pool.query<{ id: string }>(
      "SELECT id FROM extensions WHERE enabled = true AND id = ANY($1::uuid[])",
      [uniqueMembers],
    ),
    fallbackExtensionId
      ? pool.query("SELECT 1 FROM extensions WHERE id = $1 AND enabled = true", [fallbackExtensionId])
      : Promise.resolve({ rowCount: 1 }),
  ]);
  if (numberCollision.rowCount) return { error: "That internal number is already in use" };
  if (memberResult.rowCount !== uniqueMembers.length) return { error: "Every member must be an active extension" };
  if (!fallbackResult.rowCount) return { error: "The fallback must be an active extension" };
  return {
    value: {
      name, internalNumber, groupType,
      strategy: groupType === "ring_group" ? "ringall" : strategy,
      ringTimeoutSeconds, retrySeconds, maxWaitSeconds, wrapupSeconds,
      fallbackExtensionId, memberExtensionIds: uniqueMembers, enabled,
    },
  };
}

async function replaceMembers(
  groupId: string,
  memberIds: string[],
  client?: PoolClient,
): Promise<void> {
  const query = (text: string, values: unknown[]) => client
    ? client.query(text, values)
    : pool.query(text, values);
  await query(
    `DELETE FROM call_group_members
      WHERE call_group_id = $1
        AND NOT (extension_id = ANY($2::uuid[]))`,
    [groupId, memberIds],
  );
  for (const [position, extensionId] of memberIds.entries()) {
    await query(
      `INSERT INTO call_group_members (call_group_id, extension_id, position)
       VALUES ($1, $2, $3)
       ON CONFLICT (call_group_id, extension_id)
       DO UPDATE SET position = EXCLUDED.position`,
      [groupId, extensionId, position],
    );
  }
  await query(
    `INSERT INTO call_group_agent_states (call_group_id, extension_id)
     SELECT call_group_id, extension_id
       FROM call_group_members
      WHERE call_group_id = $1
     ON CONFLICT (call_group_id, extension_id) DO NOTHING`,
    [groupId],
  );
}

export function registerCallCentreRoutes(app: FastifyInstance): void {
  app.get("/api/call-centre/groups", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const [groups, members, extensions] = await Promise.all([
      pool.query<CallGroupRow>(
        `SELECT ${groupColumns} FROM call_groups
         ORDER BY length(extension_number), extension_number`,
      ),
      pool.query<GroupMemberRow>(
        `SELECT members.call_group_id, members.extension_id,
                extensions.extension_number, extensions.display_name,
                extensions.enabled, members.position,
                COALESCE(states.signed_in, true) AS signed_in,
                COALESCE(states.paused, false) AS paused,
                states.pause_reason
           FROM call_group_members AS members
           JOIN extensions ON extensions.id = members.extension_id
           LEFT JOIN call_group_agent_states AS states
             ON states.call_group_id = members.call_group_id
            AND states.extension_id = members.extension_id
          ORDER BY members.call_group_id, members.position`,
      ),
      pool.query<ExtensionChoiceRow>(
        `SELECT id, extension_number, display_name, enabled FROM extensions
         ORDER BY length(extension_number), extension_number`,
      ),
    ]);
    const [statuses, queueStats] = await Promise.all([
      getExtensionRegistrationStatuses(
        extensions.rows.filter((extension) => extension.enabled).map((extension) => extension.extension_number),
      ),
      getQueueRuntimeStats(),
    ]);
    const memberMap = new Map<string, GroupMemberRow[]>();
    for (const member of members.rows) {
      const values = memberMap.get(member.call_group_id) ?? [];
      values.push(member);
      memberMap.set(member.call_group_id, values);
    }
    const extensionMap = new Map(extensions.rows.map((extension) => [extension.id, extension]));
    return {
      groups: groups.rows.map((group) => {
        const groupMembers = memberMap.get(group.id) ?? [];
        const runtime = group.group_type === "queue"
          ? queueStats.get(queueIdentifier(group.id))
          : undefined;
        return {
          id: group.id,
          name: group.name,
          internalNumber: group.extension_number,
          groupType: group.group_type,
          strategy: group.strategy,
          ringTimeoutSeconds: group.ring_timeout_seconds,
          retrySeconds: group.retry_seconds,
          maxWaitSeconds: group.max_wait_seconds,
          wrapupSeconds: group.wrapup_seconds,
          fallbackExtensionId: group.fallback_extension_id,
          fallbackExtensionNumber: group.fallback_extension_id
            ? extensionMap.get(group.fallback_extension_id)?.extension_number ?? null
            : null,
          members: groupMembers.map((member) => ({
            extensionId: member.extension_id,
            extensionNumber: member.extension_number,
            displayName: member.display_name,
            enabled: member.enabled,
            signedIn: member.signed_in,
            paused: member.paused,
            pauseReason: member.pause_reason,
            registrationState: member.enabled
              ? statuses.get(member.extension_number)?.state ?? "unknown"
              : "disabled",
          })),
          readyMembers: groupMembers.filter((member) =>
            member.enabled && member.signed_in && !member.paused &&
            statuses.get(member.extension_number)?.state === "registered").length,
          liveStats: runtime ? {
            available: true,
            waitingCallers: runtime.waitingCallers,
            longestWaitSeconds: runtime.longestWaitSeconds,
            averageHoldSeconds: runtime.averageHoldSeconds,
            averageTalkSeconds: runtime.averageTalkSeconds,
            completedCalls: runtime.completedCalls,
            abandonedCalls: runtime.abandonedCalls,
            serviceLevelPercent: runtime.serviceLevelPercent,
          } : {
            available: group.group_type !== "queue",
            waitingCallers: 0,
            longestWaitSeconds: 0,
            averageHoldSeconds: 0,
            averageTalkSeconds: 0,
            completedCalls: 0,
            abandonedCalls: 0,
            serviceLevelPercent: 0,
          },
          enabled: group.enabled,
          createdAt: group.created_at,
          updatedAt: group.updated_at,
        };
      }),
      extensions: extensions.rows.filter((extension) => extension.enabled).map((extension) => ({
        id: extension.id,
        extensionNumber: extension.extension_number,
        displayName: extension.display_name,
        registrationState: statuses.get(extension.extension_number)?.state ?? "unknown",
      })),
    };
  });

  app.post<{ Body: GroupBody }>("/api/call-centre/groups", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const validated = await validateGroup(request.body);
    if (!validated.value) return reply.code(400).send({ error: validated.error });
    const value = validated.value;
    try {
      const row = await serializedPbxMutation(async () => {
        const client = await pool.connect();
        let created: CallGroupRow;
        try {
          await client.query("BEGIN");
          const inserted = await client.query<CallGroupRow>(
            `INSERT INTO call_groups
               (name, extension_number, group_type, strategy, ring_timeout_seconds,
                retry_seconds, max_wait_seconds, wrapup_seconds,
                fallback_extension_id, enabled, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING ${groupColumns}`,
            [
              value.name, value.internalNumber, value.groupType, value.strategy,
              value.ringTimeoutSeconds, value.retrySeconds, value.maxWaitSeconds,
              value.wrapupSeconds, value.fallbackExtensionId, value.enabled, user.id,
            ],
          );
          const insertedRow = inserted.rows[0];
          if (!insertedRow) throw new Error("Call group insert returned no record");
          created = insertedRow;
          await replaceMembers(created.id, value.memberExtensionIds, client);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
        try {
          await applyPbxConfiguration();
        } catch (error) {
          await pool.query("DELETE FROM call_groups WHERE id = $1", [created.id]);
          await applyPbxConfiguration().catch(() => undefined);
          throw error;
        }
        return created;
      });
      await audit("call_centre.group.created", user.id, {
        groupId: row.id, groupType: row.group_type, internalNumber: row.extension_number,
      }, request.ip);
      return reply.code(201).send({ id: row.id });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "That internal number is already in use" });
      }
      request.log.error({ error }, "Call group creation failed");
      return reply.code(500).send({ error: "The call group could not be provisioned" });
    }
  });

  app.patch<{ Params: GroupParams; Body: GroupBody }>(
    "/api/call-centre/groups/:id",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const existing = await groupById(request.params.id);
      if (!existing) return reply.code(404).send({ error: "Call group not found" });
      const existingMembers = await membersForGroup(existing.id);
      const validated = await validateGroup(request.body, existing);
      if (!validated.value) return reply.code(400).send({ error: validated.error });
      const value = validated.value;
      if (existing.enabled && !value.enabled) {
        const aiReferences = await pool.query<{ count: string }>(
          "SELECT count(*) FROM ai_receptionists WHERE enabled = true AND handoff_call_group_id = $1",
          [existing.id],
        );
        if (Number(aiReferences.rows[0]?.count ?? 0) > 0) {
          return reply.code(409).send({ error: "Change the active AI handoff before disabling this group" });
        }
      }
      try {
        await serializedPbxMutation(async () => {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            await client.query(
              `UPDATE call_groups SET
                 name=$2, extension_number=$3, group_type=$4, strategy=$5,
                 ring_timeout_seconds=$6, retry_seconds=$7, max_wait_seconds=$8,
                 wrapup_seconds=$9, fallback_extension_id=$10,
                 enabled=$11, updated_at=now()
               WHERE id=$1`,
              [
                existing.id, value.name, value.internalNumber, value.groupType,
                value.strategy, value.ringTimeoutSeconds, value.retrySeconds,
                value.maxWaitSeconds, value.wrapupSeconds,
                value.fallbackExtensionId, value.enabled,
              ],
            );
            await replaceMembers(existing.id, value.memberExtensionIds, client);
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw error;
          } finally {
            client.release();
          }
          try {
            await applyPbxConfiguration();
          } catch (error) {
            await restoreGroup(existing, existingMembers);
            await applyPbxConfiguration().catch(() => undefined);
            throw error;
          }
        });
        await audit("call_centre.group.updated", user.id, { groupId: existing.id }, request.ip);
        return { ok: true };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          return reply.code(409).send({ error: "That internal number is already in use" });
        }
        request.log.error({ error }, "Call group update failed");
        return reply.code(500).send({ error: "The call group could not be updated" });
      }
    },
  );

  app.delete<{ Params: GroupParams }>("/api/call-centre/groups/:id", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const existing = await groupById(request.params.id);
    if (!existing) return reply.code(404).send({ error: "Call group not found" });
    const aiReferences = await pool.query<{ count: string }>(
      "SELECT count(*) FROM ai_receptionists WHERE handoff_call_group_id = $1",
      [existing.id],
    );
    if (Number(aiReferences.rows[0]?.count ?? 0) > 0) {
      return reply.code(409).send({ error: "Remove this group from AI human handoff first" });
    }
    const existingMembers = await membersForGroup(existing.id);
    try {
      await serializedPbxMutation(async () => {
        await pool.query("DELETE FROM call_groups WHERE id = $1", [existing.id]);
        try {
          await applyPbxConfiguration();
        } catch (error) {
          await restoreGroup(existing, existingMembers);
          await applyPbxConfiguration().catch(() => undefined);
          throw error;
        }
      });
      await audit("call_centre.group.deleted", user.id, { groupId: existing.id }, request.ip);
      return reply.code(204).send();
    } catch (error) {
      request.log.error({ error }, "Call group deletion failed");
      return reply.code(500).send({ error: "The call group could not be deleted" });
    }
  });

  app.patch<{ Params: AgentParams; Body: AgentStateBody }>(
    "/api/call-centre/groups/:id/agents/:extensionId",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      try {
        const state = await updateQueueAgentState(
          request.params.id,
          request.params.extensionId,
          user.id,
          request.body ?? {},
        );
        await audit("call_centre.agent.state_changed", user.id, {
          groupId: request.params.id,
          extensionId: request.params.extensionId,
          ...state,
        }, request.ip);
        return { ok: true, ...state };
      } catch (error) {
        if (error instanceof QueueAgentNotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        if (error instanceof QueueAgentStateValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        request.log.error({ error }, "Queue agent state update failed");
        return reply.code(500).send({ error: "The queue agent state could not be updated" });
      }
    },
  );
}
