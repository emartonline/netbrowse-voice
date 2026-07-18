import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);

export type ActiveCallState = "dialing" | "ringing" | "answered" | "voicemail";
export type CallDisposition = "answered" | "missed" | "busy" | "failed" | "unknown";
export type CallDirection = "internal" | "inbound" | "outbound" | "unknown";

export interface ActiveCall {
  id: string;
  source: string;
  destination: string;
  state: ActiveCallState;
  durationSeconds: number;
  sourceChannel: string;
  destinationChannel: string;
}

interface ConciseChannel {
  channel: string;
  context: string;
  extension: string;
  state: string;
  application: string;
  data: string;
  callerId: string;
  durationSeconds: number;
  bridgedChannel: string;
  uniqueId: string;
  linkedId: string;
}

function durationSeconds(value: string | undefined): number {
  if (!value) return 0;
  if (/^[0-9]+$/.test(value)) return Number(value);
  const clock = value.match(/^(\d+):(\d{2}):(\d{2})$/);
  return clock
    ? Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3])
    : 0;
}

function endpointNumber(value: string): string {
  return value.match(/(?:^|\/)PJSIP\/([0-9]{2,8})(?:[-/]|$)/i)?.[1]
    ?? value.match(/^PJSIP\/([0-9]{2,8})(?:[-/]|$)/i)?.[1]
    ?? "";
}

function parseChannel(line: string): ConciseChannel | undefined {
  const fields = line.split("!");
  if (fields.length < 13 || !fields[0]) return undefined;
  return {
    channel: fields[0],
    context: fields[1] ?? "",
    extension: fields[2] ?? "",
    state: fields[4] ?? "",
    application: fields[5] ?? "",
    data: fields[6] ?? "",
    callerId: fields[7] ?? "",
    durationSeconds: durationSeconds(fields[10]),
    bridgedChannel: fields[11] ?? "",
    uniqueId: fields[12] ?? fields[0],
    linkedId: fields[13] ?? "",
  };
}

function groupKey(channel: ConciseChannel): string {
  if (channel.linkedId) return channel.linkedId;
  if (channel.bridgedChannel) {
    return [channel.channel, channel.bridgedChannel].sort().join("|");
  }
  return channel.uniqueId || channel.channel;
}

function primaryChannel(channels: ConciseChannel[]): ConciseChannel {
  return channels.find((channel) =>
    channel.context === "nbvoice-internal" && channel.application.toLowerCase() === "dial"
  ) ?? channels.find((channel) => channel.context === "nbvoice-internal")
    ?? channels.find((channel) => channel.context.startsWith("nbvt-"))
    ?? channels[0]!;
}

function activeState(channels: ConciseChannel[]): ActiveCallState {
  if (channels.some((channel) => channel.application.toLowerCase() === "voicemail")) {
    return "voicemail";
  }
  if (channels.some((channel) => channel.state.toLowerCase() === "up")) {
    return "answered";
  }
  if (channels.some((channel) => channel.state.toLowerCase().includes("ring"))) {
    return "ringing";
  }
  return "dialing";
}

export function parseActiveChannels(output: string): ActiveCall[] {
  const channels = output
    .split(/\r?\n/)
    .map(parseChannel)
    .filter((channel): channel is ConciseChannel => Boolean(channel));
  const relevant = channels.filter((channel) =>
    channel.context === "nbvoice-internal" || channel.context.startsWith("nbvt-")
  );
  const groups = new Map<string, ConciseChannel[]>();
  for (const channel of relevant) {
    const key = groupKey(channel);
    groups.set(key, [...(groups.get(key) ?? []), channel]);
  }

  return [...groups.entries()].map(([id, group]) => {
    const primary = primaryChannel(group);
    const source = (/^[+0-9][0-9+*#]{1,24}$/.test(primary.callerId)
      ? primary.callerId
      : endpointNumber(primary.channel)) || "Unknown";
    const dialedEndpoint = endpointNumber(primary.data);
    const destination = dialedEndpoint
      || (/^[+0-9][0-9+*#]{1,24}$/.test(primary.extension) ? primary.extension : "")
      || "Unknown";
    const peer = group.find((channel) => channel.channel !== primary.channel);
    return {
      id,
      source,
      destination,
      state: activeState(group),
      durationSeconds: Math.max(...group.map((channel) => channel.durationSeconds), 0),
      sourceChannel: primary.channel,
      destinationChannel: primary.bridgedChannel || peer?.channel || "",
    };
  }).sort((left, right) => right.durationSeconds - left.durationSeconds);
}

export async function getActiveCalls(): Promise<ActiveCall[]> {
  const { stdout } = await execFileAsync(
    config.asteriskCallsCommand,
    ["-n", config.asteriskCallsHelper],
    { timeout: 5_000, maxBuffer: 2 * 1024 * 1024 },
  );
  return parseActiveChannels(stdout);
}

export function normalizeDisposition(
  value: string,
  peerAccount = "",
  durationSeconds = 0,
  context = "",
): CallDisposition {
  const dialStatus = peerAccount.match(/^NBVOICE:([A-Z_]{2,32})$/i)?.[1]?.toUpperCase() ?? "";
  switch (dialStatus) {
    case "ANSWER": return "answered";
    case "NOANSWER": return "missed";
    case "BUSY": return "busy";
    case "CHANUNAVAIL":
    case "CONGESTION":
    case "DONTCALL":
    case "TORTURE":
    case "INVALIDARGS": return "failed";
  }
  switch (value.trim().toUpperCase()) {
    case "ANSWERED": return "answered";
    case "NO ANSWER":
      return context.startsWith("nbvoice-outbound-") && durationSeconds <= 0
        ? "failed"
        : "missed";
    case "BUSY": return "busy";
    case "FAILED":
    case "CONGESTION": return "failed";
    default: return "unknown";
  }
}

export function callDirection(context: string, source: string, destination: string): CallDirection {
  if (/^nbvt-[0-9a-f]{32}-inbound$/i.test(context)) return "inbound";
  if (context === "nbvoice-outbound" || context.startsWith("nbvoice-outbound-")) return "outbound";
  if (context === "nbvoice-internal" || (/^[0-9]{2,8}$/.test(source) && /^[0-9]{2,8}$/.test(destination))) {
    return "internal";
  }
  return "unknown";
}
