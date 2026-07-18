import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import { ivrContextName } from "./ivr.js";
import { decryptSecret } from "./secrets.js";

const execFileAsync = promisify(execFile);

export interface TrunkRow {
  id: string;
  name: string;
  auth_mode: "registration" | "credentials" | "ip";
  provider_host: string;
  provider_port: number;
  transport: "udp" | "tcp";
  username: string | null;
  secret_ciphertext: string | null;
  registration_username: string | null;
  from_user: string | null;
  from_domain: string | null;
  inbound_match: string | null;
  dial_prefix: string;
  strip_plus: boolean;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DidRouteConfigRow {
  did_number: string;
  trunk_id: string;
  destination_type: "extension" | "ivr";
  extension_number: string | null;
  ivr_menu_id: string | null;
}

export interface OutboundRouteConfigRow {
  id: string;
  name: string;
  sip_trunk_id: string;
  access_prefix: string;
  outbound_caller_id: string | null;
  ring_timeout_seconds: number;
  enabled: boolean;
  trunk_enabled: boolean;
  dial_prefix: string;
  strip_plus: boolean;
}

export type TrunkRegistrationState =
  | "registered"
  | "unregistered"
  | "rejected"
  | "configured"
  | "not_required"
  | "unknown";

export function trunkSectionName(id: string): string {
  return `nbvt-${id.replaceAll("-", "").toLowerCase()}`;
}

export function outboundRouteContextName(id: string): string {
  return `nbvoice-outbound-${id.replaceAll("-", "").toLowerCase()}`;
}

export function formatTrunkDialNumber(
  e164: string,
  row: Pick<TrunkRow, "dial_prefix" | "strip_plus">,
): string {
  const normalized = e164.trim();
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) {
    throw new Error("Outbound number must be valid E.164");
  }
  const destination = row.strip_plus ? normalized.slice(1) : normalized;
  return `${row.dial_prefix}${destination}`;
}

export function renderTrunkPjsipConfig(rows: TrunkRow[]): string {
  const lines = [
    "; Managed by Netbrowse Voice. Manual changes will be replaced.",
    "; Provider credentials are encrypted in PostgreSQL and rendered here for Asterisk.",
  ];

  for (const row of rows.filter((item) => item.enabled)) {
    const section = trunkSectionName(row.id);
    const providerUri = `sip:${row.provider_host}:${row.provider_port}`;
    const sendsCredentials = row.auth_mode !== "ip";
    const inboundMatches = (row.inbound_match ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    lines.push(
      "",
      `[${section}]`,
      "type=endpoint",
      `transport=nbvoice-transport-${row.transport}`,
      `context=${section}-inbound`,
      "disallow=all",
      "allow=ulaw,alaw,g722",
      `aors=${section}-aor`,
      "direct_media=no",
      "rtp_symmetric=yes",
      "force_rport=yes",
      "rewrite_contact=yes",
      "trust_id_inbound=yes",
      ...(sendsCredentials ? [`outbound_auth=${section}-auth`] : []),
      ...(row.from_user ? [`from_user=${row.from_user}`] : []),
      ...(row.from_domain ? [`from_domain=${row.from_domain}`] : []),
      "",
      `[${section}-aor]`,
      "type=aor",
      `contact=${providerUri}`,
      "qualify_frequency=60",
    );

    if (sendsCredentials && row.username && row.secret_ciphertext) {
      lines.push(
        "",
        `[${section}-auth]`,
        "type=auth",
        "auth_type=userpass",
        `username=${row.username}`,
        `password=${decryptSecret(row.secret_ciphertext)}`,
      );
    }

    if (row.auth_mode === "registration" && row.username && row.secret_ciphertext) {
      lines.push(
        "",
        `[${section}-registration]`,
        "type=registration",
        `transport=nbvoice-transport-${row.transport}`,
        `outbound_auth=${section}-auth`,
        `server_uri=${providerUri}`,
        `client_uri=sip:${row.registration_username ?? row.username}@${row.provider_host}`,
        "retry_interval=60",
        "forbidden_retry_interval=600",
        "expiration=300",
        "line=yes",
        `endpoint=${section}`,
      );
    }

    if (inboundMatches.length > 0) {
      lines.push(
        "",
        `[${section}-identify]`,
        "type=identify",
        `endpoint=${section}`,
        ...inboundMatches.map((match) => `match=${match}`),
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderInboundDialplanConfig(
  rows: DidRouteConfigRow[],
  trunkIds: string[] = [...new Set(rows.map((row) => row.trunk_id))],
): string {
  const lines = [
    "; Managed by Netbrowse Voice. Manual changes will be replaced.",
  ];
  for (const trunkId of trunkIds) {
    lines.push("", `[${trunkSectionName(trunkId)}-inbound]`);
    for (const row of rows.filter((item) => item.trunk_id === trunkId)) {
      const destination = row.destination_type === "ivr" && row.ivr_menu_id
        ? `${ivrContextName(row.ivr_menu_id)},s,1`
        : `nbvoice-internal,${row.extension_number},1`;
      lines.push(
        `exten => ${row.did_number},1,NoOp(Netbrowse Voice inbound DID ${row.did_number})`,
        ` same => n,Goto(${destination})`,
        " same => n,Hangup()",
        "",
      );
    }
    lines.push(
      "exten => _X!,1,NoOp(Netbrowse Voice unrouted inbound number)",
      " same => n,Hangup()",
      "",
      "exten => _+X!,1,NoOp(Netbrowse Voice unrouted inbound number)",
      " same => n,Hangup()",
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderOutboundDialplanConfig(rows: OutboundRouteConfigRow[]): string {
  const lines = [
    "; Managed by Netbrowse Voice. Manual changes will be replaced.",
    "",
    "[nbvoice-internal]",
  ];
  const activeRows = rows.filter((row) => row.enabled && row.trunk_enabled);
  for (const row of activeRows) {
    const context = outboundRouteContextName(row.id);
    const trim = row.access_prefix.length;
    for (let digits = 8; digits <= 15; digits += 1) {
      lines.push(
        `exten => _${row.access_prefix}${"X".repeat(digits)},1,Goto(${context},\${EXTEN:${trim}},1)`,
      );
    }
  }
  for (const row of activeRows) {
    const context = outboundRouteContextName(row.id);
    const providerNumber = row.strip_plus
      ? `${row.dial_prefix}\${EXTEN}`
      : `+\${EXTEN}`;
    lines.push(
      "",
      `[${context}]`,
      "exten => _X!,1,NoOp(Netbrowse Voice outbound route)",
      ` same => n,AGI(agi://127.0.0.1:4573/billing-authorize/${row.id}/\${CHANNEL(endpoint)}/\${EXTEN})`,
      ' same => n,GotoIf($["${NBVOICE_BILLING_ALLOWED}"="1"]?authorized:blocked)',
      " same => n(blocked),Set(CDR(peeraccount)=NBVOICE:BILLING_BLOCKED)",
      " same => n,Playback(netbrowse/nbvoice-billing-blocked)",
      " same => n,Hangup()",
      " same => n(authorized),Set(CDR(accountcode)=${NBVOICE_BILLING_CUSTOMER_ID})",
      ` same => n,Set(NBVOICE_OUTBOUND_DESTINATION=${providerNumber})`,
      ...(row.outbound_caller_id
        ? [` same => n,Set(CALLERID(num)=${row.outbound_caller_id})`]
        : []),
      ` same => n,Dial(PJSIP/\${NBVOICE_OUTBOUND_DESTINATION}@${trunkSectionName(row.sip_trunk_id)},${row.ring_timeout_seconds})`,
      " same => n,Set(CDR(peeraccount)=NBVOICE:${DIALSTATUS})",
      " same => n,Hangup()",
    );
  }
  return `${lines.join("\n")}\n`;
}

export function parseTrunkRegistrations(
  output: string,
  rows: TrunkRow[],
): Map<string, TrunkRegistrationState> {
  const states = new Map<string, TrunkRegistrationState>();
  const idByRegistration = new Map<string, string>();
  for (const row of rows) {
    states.set(
      row.id,
      row.auth_mode === "ip"
        ? "not_required"
        : row.auth_mode === "credentials"
          ? "configured"
          : "unregistered",
    );
    if (row.auth_mode === "registration") {
      idByRegistration.set(`${trunkSectionName(row.id)}-registration`, row.id);
    }
  }
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(nbvt-[0-9a-f]{32}-registration)\/\S+.*?\s(Registered|Rejected|Unregistered|Stopped)(?:\s|\(|$)/i,
    );
    if (!match?.[1] || !match[2]) continue;
    const id = idByRegistration.get(match[1].toLowerCase());
    if (!id) continue;
    const token = match[2].toLowerCase();
    states.set(
      id,
      token === "registered"
        ? "registered"
        : token === "rejected"
          ? "rejected"
          : "unregistered",
    );
  }
  return states;
}

export async function getTrunkRegistrationStatuses(
  rows: TrunkRow[],
): Promise<Map<string, TrunkRegistrationState>> {
  try {
    const { stdout } = await execFileAsync(
      config.asteriskStatusCommand,
      ["-n", config.asteriskStatusHelper],
      { timeout: 5_000, maxBuffer: 1024 * 1024 },
    );
    return parseTrunkRegistrations(stdout, rows);
  } catch {
    return new Map(
      rows.map((row) => [
        row.id,
        row.auth_mode === "ip"
          ? "not_required" as const
          : row.auth_mode === "credentials"
            ? "configured" as const
            : "unknown" as const,
      ]),
    );
  }
}
