export type CallGroupType = "ring_group" | "queue";
export type CallGroupStrategy = "ringall" | "rrmemory" | "leastrecent";

export interface CallGroupRow {
  id: string;
  name: string;
  extension_number: string;
  group_type: CallGroupType;
  strategy: CallGroupStrategy;
  ring_timeout_seconds: number;
  retry_seconds: number;
  max_wait_seconds: number;
  wrapup_seconds: number;
  fallback_extension_id: string | null;
  enabled: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CallGroupMemberConfigRow {
  call_group_id: string;
  extension_id: string;
  extension_number: string;
  display_name: string;
  position: number;
  signed_in: boolean;
  paused: boolean;
  pause_reason: "break" | "lunch" | "training" | "admin" | null;
}

export interface CallGroupConfigRow extends CallGroupRow {
  fallback_extension_number: string | null;
}

export function queueIdentifier(id: string): string {
  const compact = id.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) throw new Error("Invalid call group id");
  return `nbvq-${compact}`;
}

export function renderQueueConfig(
  groups: CallGroupConfigRow[],
  members: CallGroupMemberConfigRow[],
): string {
  const lines = [
    "; Managed by Netbrowse Voice. Manual changes will be replaced.",
    "; Static queue members are validated active PBX extensions.",
    "",
  ];
  const membersByGroup = new Map<string, CallGroupMemberConfigRow[]>();
  for (const member of members) {
    const groupMembers = membersByGroup.get(member.call_group_id) ?? [];
    groupMembers.push(member);
    membersByGroup.set(member.call_group_id, groupMembers);
  }
  for (const group of groups.filter((item) => item.enabled && item.group_type === "queue")) {
    lines.push(
      `[${queueIdentifier(group.id)}]`,
      `strategy=${group.strategy}`,
      `timeout=${group.ring_timeout_seconds}`,
      `retry=${group.retry_seconds}`,
      `wrapuptime=${group.wrapup_seconds}`,
      "musicclass=default",
      "joinempty=no",
      "leavewhenempty=yes",
      "autofill=yes",
      "ringinuse=no",
    );
    for (const member of (membersByGroup.get(group.id) ?? []).filter((item) => item.signed_in)) {
      lines.push(
        `member => PJSIP/${member.extension_number},0,,PJSIP/${member.extension_number},no,${group.wrapup_seconds},${member.paused ? "yes" : "no"}`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function fallbackLines(group: CallGroupConfigRow): string[] {
  return group.fallback_extension_number
    ? [` same => n(fallback),Goto(${group.fallback_extension_number},1)`]
    : [" same => n(fallback),Playback(vm-nobodyavail)", " same => n,Hangup()"];
}

export function renderCallGroupRoutes(
  groups: CallGroupConfigRow[],
  members: CallGroupMemberConfigRow[],
): string[] {
  const lines: string[] = [];
  const membersByGroup = new Map<string, CallGroupMemberConfigRow[]>();
  for (const member of members) {
    const groupMembers = membersByGroup.get(member.call_group_id) ?? [];
    groupMembers.push(member);
    membersByGroup.set(member.call_group_id, groupMembers);
  }
  for (const group of groups.filter((item) => item.enabled)) {
    const configuredMembers = membersByGroup.get(group.id) ?? [];
    const groupMembers = group.group_type === "queue"
      ? configuredMembers.filter((member) => member.signed_in)
      : configuredMembers;
    if (group.group_type === "ring_group") {
      lines.push(
        `exten => ${group.extension_number},1,NoOp(Netbrowse Voice ring group ${group.extension_number})`,
      );
      if (groupMembers.length === 0) {
        lines.push(...fallbackLines(group), "");
        continue;
      }
      lines.push(
        ` same => n,Set(NBVOICE_GROUP_MEMBERS=${groupMembers.map((member) => `PJSIP/${member.extension_number}`).join("&")})`,
        ` same => n,Dial(\${NBVOICE_GROUP_MEMBERS},${group.ring_timeout_seconds})`,
        ' same => n,GotoIf($["${DIALSTATUS}"="ANSWER"]?done:fallback)',
        ...fallbackLines(group),
        " same => n(done),Hangup()",
        "",
      );
      continue;
    }
    lines.push(
      `exten => ${group.extension_number},1,NoOp(Netbrowse Voice call queue ${group.extension_number})`,
      " same => n,Answer()",
    );
    if (groupMembers.length === 0) {
      lines.push(...fallbackLines(group), "");
      continue;
    }
    lines.push(
      ` same => n,Queue(${queueIdentifier(group.id)},t,,,${group.max_wait_seconds})`,
      ' same => n,GotoIf($["${QUEUESTATUS}"="TIMEOUT"]?fallback)',
      ' same => n,GotoIf($["${QUEUESTATUS}"="FULL"]?fallback)',
      ' same => n,GotoIf($["${QUEUESTATUS}"="JOINEMPTY"]?fallback)',
      ' same => n,GotoIf($["${QUEUESTATUS}"="LEAVEEMPTY"]?fallback:done)',
      ...fallbackLines(group),
      " same => n(done),Hangup()",
      "",
    );
  }
  return lines;
}

/**
 * The OpenAI realtime engine uses Asterisk's channel redirect command for a
 * handoff. A redirect cannot run an application first, so queue destinations
 * get this narrow, generated staging context. It begins the same default MOH
 * class as Queue() before returning to the normal internal route.
 */
export function renderAiQueueHandoffContexts(groups: CallGroupConfigRow[]): string[] {
  const queues = groups.filter((group) => group.enabled && group.group_type === "queue");
  if (queues.length === 0) return [];
  const lines = ["[nbvoice-ai-queue-handoff]"];
  for (const queue of queues) {
    lines.push(
      `exten => ${queue.extension_number},1,NoOp(Netbrowse Voice AI queue handoff ${queue.extension_number})`,
      " same => n,StartMusicOnHold(default)",
      ` same => n,Goto(nbvoice-internal,${queue.extension_number},1)`,
      "",
    );
  }
  return lines;
}
