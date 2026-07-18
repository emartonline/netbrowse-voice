import type { FastifyInstance } from "fastify";
import { hashPassword, requireAdministrator, requireAgent } from "./auth.js";
import { audit, pool } from "./database.js";
import { getActiveCalls } from "./calls.js";
import { queueIdentifier } from "./call-centre.js";
import { getExtensionRegistrationStatuses } from "./pbx.js";
import { getQueueRuntimeStats } from "./queue-supervision.js";
import {
  QueueAgentNotFoundError,
  QueueAgentStateValidationError,
  type AgentStateChange,
  updateQueueAgentState,
  validUuid,
} from "./queue-agent-state.js";

interface AccountBody {
  displayName?: string;
  email?: string;
  password?: string;
  extensionId?: string;
  active?: boolean;
}

interface IdParams { id: string }
interface QueueParams { id: string }

interface AgentAccountRow {
  id: string;
  email: string;
  display_name: string;
  active: boolean;
  extension_id: string;
  extension_number: string;
  extension_name: string;
  queue_count: string;
  created_at: Date;
  updated_at: Date;
}

interface ExtensionRow {
  id: string;
  extension_number: string;
  display_name: string;
  enabled: boolean;
  agent_user_id: string | null;
}

interface QueueMembershipRow {
  id: string;
  name: string;
  extension_number: string;
  strategy: "ringall" | "rrmemory" | "leastrecent";
  enabled: boolean;
  signed_in: boolean;
  paused: boolean;
  pause_reason: "break" | "lunch" | "training" | "admin" | null;
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function publicAccount(row: AgentAccountRow) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    active: row.active,
    extensionId: row.extension_id,
    extensionNumber: row.extension_number,
    extensionName: row.extension_name,
    queueCount: Number(row.queue_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function agentAccount(id: string): Promise<AgentAccountRow | undefined> {
  if (!validUuid(id)) return undefined;
  const result = await pool.query<AgentAccountRow>(
    `SELECT users.id, users.email, users.display_name, users.active,
            users.extension_id, extensions.extension_number,
            extensions.display_name AS extension_name,
            count(DISTINCT members.call_group_id)
              FILTER (WHERE groups.group_type = 'queue')::text AS queue_count,
            users.created_at, users.updated_at
       FROM users
       JOIN extensions ON extensions.id = users.extension_id
       LEFT JOIN call_group_members AS members ON members.extension_id = extensions.id
       LEFT JOIN call_groups AS groups ON groups.id = members.call_group_id
      WHERE users.id = $1 AND users.role = 'agent'
      GROUP BY users.id, extensions.id`,
    [id],
  );
  return result.rows[0];
}

function accountValues(body: AccountBody, existing?: AgentAccountRow) {
  const displayName = body.displayName?.trim() ?? existing?.display_name ?? "";
  const email = body.email?.trim().toLowerCase() ?? existing?.email ?? "";
  const extensionId = body.extensionId ?? existing?.extension_id ?? "";
  const active = body.active ?? existing?.active ?? true;
  const password = body.password ?? "";
  if (displayName.length < 2 || displayName.length > 100) {
    throw new Error("Enter a valid agent name");
  }
  if (!validEmail(email)) throw new Error("Enter a valid email address");
  if (!validUuid(extensionId)) throw new Error("Choose a valid extension");
  if (typeof active !== "boolean") throw new Error("Invalid account state");
  if (!existing && password.length < 12) {
    throw new Error("Password must be at least 12 characters");
  }
  if (existing && password && password.length < 12) {
    throw new Error("New password must be at least 12 characters");
  }
  return { displayName, email, extensionId, active, password };
}

async function extensionAvailable(extensionId: string, excludingUserId?: string): Promise<boolean> {
  const result = await pool.query<{ available: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM extensions
        WHERE id = $1 AND enabled = true
     ) AND NOT EXISTS (
       SELECT 1 FROM users
        WHERE extension_id = $1 AND role = 'agent'
          AND ($2::uuid IS NULL OR id <> $2::uuid)
     ) AS available`,
    [extensionId, excludingUserId ?? null],
  );
  return result.rows[0]?.available ?? false;
}

async function workspaceSnapshot(user: { id: string; extensionId: string; displayName: string; email: string }) {
  const extensionResult = await pool.query<{
    id: string;
    extension_number: string;
    display_name: string;
    enabled: boolean;
  }>(
    `SELECT id, extension_number, display_name, enabled
       FROM extensions WHERE id = $1`,
    [user.extensionId],
  );
  const extension = extensionResult.rows[0];
  if (!extension) throw new Error("Assigned extension is unavailable");

  const memberships = await pool.query<QueueMembershipRow>(
    `SELECT groups.id, groups.name, groups.extension_number, groups.strategy,
            groups.enabled,
            COALESCE(states.signed_in, true) AS signed_in,
            COALESCE(states.paused, false) AS paused,
            states.pause_reason
       FROM call_group_members AS members
       JOIN call_groups AS groups ON groups.id = members.call_group_id
       LEFT JOIN call_group_agent_states AS states
         ON states.call_group_id = members.call_group_id
        AND states.extension_id = members.extension_id
      WHERE members.extension_id = $1 AND groups.group_type = 'queue'
      ORDER BY length(groups.extension_number), groups.extension_number`,
    [user.extensionId],
  );

  const [statuses, runtime, activeCalls, dailyResult] = await Promise.all([
    getExtensionRegistrationStatuses([extension.extension_number]).catch(() => new Map()),
    getQueueRuntimeStats().catch(() => new Map()),
    getActiveCalls().catch(() => []),
    pool.query<{
      total: string;
      answered: string;
      missed: string;
      talk_seconds: string;
    }>(
      `WITH ranked AS (
         SELECT records.*,
                row_number() OVER (
                  PARTITION BY COALESCE(NULLIF(linkedid, ''), NULLIF(uniqueid, ''), id::text)
                  ORDER BY sequence, id
                ) AS leg_rank
           FROM call_detail_records AS records
          WHERE calldate >= date_trunc('day', now())
            AND (src = $1 OR dst = $1)
       ), calls AS (SELECT * FROM ranked WHERE leg_rank = 1)
       SELECT count(*)::text AS total,
              count(*) FILTER (WHERE upper(disposition) = 'ANSWERED')::text AS answered,
              count(*) FILTER (WHERE upper(disposition) <> 'ANSWERED')::text AS missed,
              COALESCE(sum(billsec), 0)::text AS talk_seconds
         FROM calls`,
      [extension.extension_number],
    ),
  ]);
  const registrationState = extension.enabled
    ? statuses.get(extension.extension_number)?.state ?? "unknown"
    : "disabled";
  const channelPattern = new RegExp(`(?:^|/)PJSIP/${extension.extension_number}(?:[-/]|$)`, "i");
  const ownCalls = activeCalls.filter((call) =>
    call.source === extension.extension_number ||
    call.destination === extension.extension_number ||
    channelPattern.test(call.sourceChannel) ||
    channelPattern.test(call.destinationChannel)
  );
  const daily = dailyResult.rows[0];

  return {
    user: {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      role: "agent" as const,
      extensionId: user.extensionId,
      customerId: null,
    },
    extension: {
      id: extension.id,
      extensionNumber: extension.extension_number,
      displayName: extension.display_name,
      registrationState,
    },
    queues: memberships.rows.map((queue) => {
      const stats = runtime.get(queueIdentifier(queue.id));
      return {
        id: queue.id,
        name: queue.name,
        internalNumber: queue.extension_number,
        strategy: queue.strategy,
        enabled: queue.enabled,
        signedIn: queue.signed_in,
        paused: queue.paused,
        pauseReason: queue.pause_reason,
        ready: queue.enabled && queue.signed_in && !queue.paused && registrationState === "registered",
        liveStats: {
          available: Boolean(stats),
          waitingCallers: stats?.waitingCallers ?? 0,
          longestWaitSeconds: stats?.longestWaitSeconds ?? 0,
          completedCalls: stats?.completedCalls ?? 0,
          abandonedCalls: stats?.abandonedCalls ?? 0,
        },
      };
    }),
    activeCalls: ownCalls,
    today: {
      totalCalls: Number(daily?.total ?? 0),
      answeredCalls: Number(daily?.answered ?? 0),
      missedCalls: Number(daily?.missed ?? 0),
      talkSeconds: Number(daily?.talk_seconds ?? 0),
    },
    sampledAt: new Date().toISOString(),
  };
}

export function registerAgentRoutes(app: FastifyInstance): void {
  app.get("/api/agent-accounts", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const [accounts, extensions] = await Promise.all([
      pool.query<AgentAccountRow>(
        `SELECT users.id, users.email, users.display_name, users.active,
                users.extension_id, extensions.extension_number,
                extensions.display_name AS extension_name,
                count(DISTINCT members.call_group_id)
                  FILTER (WHERE groups.group_type = 'queue')::text AS queue_count,
                users.created_at, users.updated_at
           FROM users
           JOIN extensions ON extensions.id = users.extension_id
           LEFT JOIN call_group_members AS members ON members.extension_id = extensions.id
           LEFT JOIN call_groups AS groups ON groups.id = members.call_group_id
          WHERE users.role = 'agent'
          GROUP BY users.id, extensions.id
          ORDER BY users.display_name, users.email`,
      ),
      pool.query<ExtensionRow>(
        `SELECT extensions.id, extensions.extension_number,
                extensions.display_name, extensions.enabled,
                users.id AS agent_user_id
           FROM extensions
           LEFT JOIN users
             ON users.extension_id = extensions.id AND users.role = 'agent'
          ORDER BY length(extensions.extension_number), extensions.extension_number`,
      ),
    ]);
    return {
      accounts: accounts.rows.map(publicAccount),
      extensions: extensions.rows.map((extension) => ({
        id: extension.id,
        extensionNumber: extension.extension_number,
        displayName: extension.display_name,
        enabled: extension.enabled,
        agentUserId: extension.agent_user_id,
      })),
    };
  });

  app.post<{ Body: AccountBody }>("/api/agent-accounts", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    let values;
    try {
      values = accountValues(request.body ?? {});
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
    if (!await extensionAvailable(values.extensionId)) {
      return reply.code(409).send({ error: "That extension is unavailable or already assigned" });
    }
    try {
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO users
           (email, display_name, password_hash, role, active, extension_id)
         VALUES ($1,$2,$3,'agent',$4,$5)
         RETURNING id`,
        [values.email, values.displayName, hashPassword(values.password), values.active, values.extensionId],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error("Agent account insert returned no id");
      await audit("agent.account.created", user.id, {
        agentUserId: id, extensionId: values.extensionId,
      }, request.ip);
      return reply.code(201).send({ id });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "That email address or extension is already assigned" });
      }
      request.log.error({ error }, "Agent account creation failed");
      return reply.code(500).send({ error: "The agent account could not be created" });
    }
  });

  app.patch<{ Params: IdParams; Body: AccountBody }>(
    "/api/agent-accounts/:id",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const existing = await agentAccount(request.params.id);
      if (!existing) return reply.code(404).send({ error: "Agent account not found" });
      let values;
      try {
        values = accountValues(request.body ?? {}, existing);
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
      if (!await extensionAvailable(values.extensionId, existing.id)) {
        return reply.code(409).send({ error: "That extension is unavailable or already assigned" });
      }
      try {
        await pool.query(
          `UPDATE users SET
             email=$2, display_name=$3, extension_id=$4, active=$5,
             password_hash=COALESCE($6, password_hash), updated_at=now()
           WHERE id=$1 AND role='agent'`,
          [existing.id, values.email, values.displayName, values.extensionId,
            values.active, values.password ? hashPassword(values.password) : null],
        );
        if (!values.active || values.password) {
          await pool.query("DELETE FROM sessions WHERE user_id = $1", [existing.id]);
        }
        await audit("agent.account.updated", user.id, {
          agentUserId: existing.id,
          extensionId: values.extensionId,
          active: values.active,
          passwordReset: Boolean(values.password),
        }, request.ip);
        return { ok: true };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          return reply.code(409).send({ error: "That email address or extension is already assigned" });
        }
        request.log.error({ error }, "Agent account update failed");
        return reply.code(500).send({ error: "The agent account could not be updated" });
      }
    },
  );

  app.delete<{ Params: IdParams }>("/api/agent-accounts/:id", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const existing = await agentAccount(request.params.id);
    if (!existing) return reply.code(404).send({ error: "Agent account not found" });
    await pool.query("DELETE FROM users WHERE id = $1 AND role = 'agent'", [existing.id]);
    await audit("agent.account.deleted", user.id, {
      agentUserId: existing.id, extensionId: existing.extension_id,
    }, request.ip);
    return reply.code(204).send();
  });

  app.get("/api/agent/workspace", async (request, reply) => {
    const user = await requireAgent(request, reply);
    if (!user || !user.extensionId) return;
    try {
      return await workspaceSnapshot({ ...user, extensionId: user.extensionId });
    } catch (error) {
      request.log.error({ error }, "Agent workspace query failed");
      return reply.code(500).send({ error: "The agent workspace is unavailable" });
    }
  });

  app.patch<{ Params: QueueParams; Body: AgentStateChange }>(
    "/api/agent/workspace/queues/:id",
    async (request, reply) => {
      const user = await requireAgent(request, reply);
      if (!user || !user.extensionId) return;
      try {
        const state = await updateQueueAgentState(
          request.params.id,
          user.extensionId,
          user.id,
          request.body ?? {},
        );
        await audit("agent.workspace.state_changed", user.id, {
          groupId: request.params.id,
          extensionId: user.extensionId,
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
        request.log.error({ error }, "Agent workspace state update failed");
        return reply.code(500).send({ error: "Your queue state could not be updated" });
      }
    },
  );
}
