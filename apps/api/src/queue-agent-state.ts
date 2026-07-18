import { pool } from "./database.js";
import { applyPbxConfiguration, serializedPbxMutation } from "./pbx.js";

export type PauseReason = "break" | "lunch" | "training" | "admin";

export interface AgentStateChange {
  signedIn?: boolean;
  paused?: boolean;
  pauseReason?: PauseReason | null;
}

export interface QueueAgentState {
  signedIn: boolean;
  paused: boolean;
  pauseReason: PauseReason | null;
}

interface ExistingState {
  group_type: "ring_group" | "queue";
  state_exists: boolean;
  signed_in: boolean;
  paused: boolean;
  pause_reason: PauseReason | null;
}

export class QueueAgentNotFoundError extends Error {}
export class QueueAgentStateValidationError extends Error {}

export function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function normalizeQueueAgentState(
  existing: QueueAgentState,
  change: AgentStateChange,
): QueueAgentState {
  if (change.signedIn !== undefined && typeof change.signedIn !== "boolean") {
    throw new QueueAgentStateValidationError("Invalid agent state");
  }
  if (change.paused !== undefined && typeof change.paused !== "boolean") {
    throw new QueueAgentStateValidationError("Invalid agent state");
  }
  if (
    change.pauseReason !== undefined &&
    change.pauseReason !== null &&
    !(["break", "lunch", "training", "admin"] as string[]).includes(change.pauseReason)
  ) {
    throw new QueueAgentStateValidationError("Choose a valid pause reason");
  }

  const signedIn = change.signedIn ?? existing.signedIn;
  const paused = signedIn ? (change.paused ?? existing.paused) : false;
  const pauseReason = paused
    ? (change.pauseReason ?? existing.pauseReason ?? "break")
    : null;
  return { signedIn, paused, pauseReason };
}

export async function updateQueueAgentState(
  groupId: string,
  extensionId: string,
  userId: string,
  change: AgentStateChange,
): Promise<QueueAgentState> {
  if (!validUuid(groupId) || !validUuid(extensionId)) {
    throw new QueueAgentNotFoundError("Queue agent not found");
  }
  const membership = await pool.query<ExistingState>(
    `SELECT groups.group_type,
            (states.call_group_id IS NOT NULL) AS state_exists,
            COALESCE(states.signed_in, true) AS signed_in,
            COALESCE(states.paused, false) AS paused,
            states.pause_reason
       FROM call_group_members AS members
       JOIN call_groups AS groups ON groups.id = members.call_group_id
       LEFT JOIN call_group_agent_states AS states
         ON states.call_group_id = members.call_group_id
        AND states.extension_id = members.extension_id
      WHERE members.call_group_id = $1 AND members.extension_id = $2`,
    [groupId, extensionId],
  );
  const existing = membership.rows[0];
  if (!existing || existing.group_type !== "queue") {
    throw new QueueAgentNotFoundError("Queue agent not found");
  }
  const next = normalizeQueueAgentState({
    signedIn: existing.signed_in,
    paused: existing.paused,
    pauseReason: existing.pause_reason,
  }, change);

  await serializedPbxMutation(async () => {
    await pool.query(
      `INSERT INTO call_group_agent_states
         (call_group_id, extension_id, signed_in, paused, pause_reason, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (call_group_id, extension_id) DO UPDATE SET
         signed_in=EXCLUDED.signed_in, paused=EXCLUDED.paused,
         pause_reason=EXCLUDED.pause_reason, updated_by=EXCLUDED.updated_by,
         updated_at=now()`,
      [groupId, extensionId, next.signedIn, next.paused, next.pauseReason, userId],
    );
    try {
      await applyPbxConfiguration();
    } catch (error) {
      if (existing.state_exists) {
        await pool.query(
          `UPDATE call_group_agent_states SET
             signed_in=$3, paused=$4, pause_reason=$5, updated_at=now()
           WHERE call_group_id=$1 AND extension_id=$2`,
          [groupId, extensionId, existing.signed_in, existing.paused, existing.pause_reason],
        );
      } else {
        await pool.query(
          `DELETE FROM call_group_agent_states
            WHERE call_group_id=$1 AND extension_id=$2`,
          [groupId, extensionId],
        );
      }
      await applyPbxConfiguration().catch(() => undefined);
      throw error;
    }
  });
  return next;
}
