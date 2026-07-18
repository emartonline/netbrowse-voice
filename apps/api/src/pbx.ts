import { execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { config } from "./config.js";
import { pool } from "./database.js";
import { decryptSecret } from "./secrets.js";
import {
  renderIvrContexts,
  renderIvrInternalRoutes,
  type IvrMenuConfigRow,
  type IvrOptionConfigRow,
} from "./ivr.js";
import {
  renderInboundDialplanConfig,
  renderOutboundDialplanConfig,
  renderTrunkPjsipConfig,
  type DidRouteConfigRow,
  type OutboundRouteConfigRow,
  type TrunkRow,
} from "./trunks.js";
import {
  renderAiReceptionistRoutes,
  type AiReceptionistConfigRow,
} from "./ai-receptionist.js";
import {
  renderAiQueueHandoffContexts,
  renderCallGroupRoutes,
  renderQueueConfig,
  type CallGroupConfigRow,
  type CallGroupMemberConfigRow,
} from "./call-centre.js";
import { renderCampaignDialplan } from "./campaign-dialer.js";

const execFileAsync = promisify(execFile);
let mutationQueue = Promise.resolve();

export function serializedPbxMutation<T>(work: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(work, work);
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export interface ExtensionRow {
  id: string;
  extension_number: string;
  display_name: string;
  secret_ciphertext: string;
  enabled: boolean;
  max_contacts: number;
  ring_timeout_seconds: number;
  voicemail_enabled: boolean;
  voicemail_pin_ciphertext: string | null;
  dnd_enabled: boolean;
  call_waiting: boolean;
  record_calls: boolean;
  pickup_group: number | null;
  forward_mode: "off" | "always" | "busy" | "unavailable";
  forward_extension_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export type RegistrationState =
  | "registered"
  | "unregistered"
  | "unreachable"
  | "unknown";

export interface RegistrationStatus {
  state: RegistrationState;
  contactCount: number;
}

function safeCallerIdName(value: string): string {
  const cleaned = value.replace(/[\r\n"\\]/g, " ").replace(/\s+/g, " ").trim();
  return /^[A-Za-z0-9]/.test(cleaned) ? cleaned : "Extension";
}

export function renderPjsipConfig(rows: ExtensionRow[]): string {
  const sections = [
    "; Managed by Netbrowse Voice. Manual changes will be replaced.",
    "; Extension credentials are encrypted in PostgreSQL and rendered here for Asterisk.",
    "",
    "[nbvoice-transport-udp]",
    "type=transport",
    "protocol=udp",
    "bind=0.0.0.0:5060",
    "",
    "[nbvoice-transport-tcp]",
    "type=transport",
    "protocol=tcp",
    "bind=0.0.0.0:5060",
  ];

  for (const row of rows.filter((item) => item.enabled)) {
    const number = row.extension_number;
    sections.push(
      "",
      `[${number}]`,
      "type=endpoint",
      "context=nbvoice-internal",
      "disallow=all",
      "allow=ulaw,alaw,g722",
      `auth=${number}-auth`,
      `aors=${number}`,
      `callerid=\"${safeCallerIdName(row.display_name)}\" <${number}>`,
      "direct_media=no",
      "rtp_symmetric=yes",
      "force_rport=yes",
      "rewrite_contact=yes",
      ...(row.voicemail_enabled ? [`mailboxes=${number}@nbvoice`] : []),
      ...(!row.call_waiting ? ["device_state_busy_at=1"] : []),
      ...(row.pickup_group === null
        ? []
        : [`call_group=${row.pickup_group}`, `pickup_group=${row.pickup_group}`]),
      "",
      `[${number}-auth]`,
      "type=auth",
      "auth_type=userpass",
      `username=${number}`,
      `password=${decryptSecret(row.secret_ciphertext)}`,
      "",
      `[${number}]`,
      "type=aor",
      `max_contacts=${row.max_contacts}`,
      "remove_existing=yes",
      "qualify_frequency=60",
    );
  }
  return `${sections.join("\n")}\n`;
}

export function renderDialplanConfig(
  rows: ExtensionRow[],
  ivrMenus: IvrMenuConfigRow[] = [],
  ivrOptions: IvrOptionConfigRow[] = [],
  aiReceptionists: AiReceptionistConfigRow[] = [],
  callGroups: CallGroupConfigRow[] = [],
  callGroupMembers: CallGroupMemberConfigRow[] = [],
): string {
  const lines = [
    "; Managed by Netbrowse Voice. Manual changes will be replaced.",
    "",
    "[nbvoice-internal]",
    "exten => *97,1,NoOp(Netbrowse Voice own voicemail access)",
    " same => n,VoiceMailMain(${CALLERID(num)}@nbvoice)",
    " same => n,Hangup()",
    "",
    "exten => *98,1,NoOp(Netbrowse Voice mailbox access)",
    " same => n,VoiceMailMain(@nbvoice)",
    " same => n,Hangup()",
    "",
    "exten => *8,1,NoOp(Netbrowse Voice group call pickup)",
    " same => n,Pickup()",
    " same => n,Hangup()",
    "",
  ];
  const enabledRows = rows.filter((item) => item.enabled);
  const byId = new Map(enabledRows.map((item) => [item.id, item]));
  for (const row of rows.filter((item) => item.enabled)) {
    const number = row.extension_number;
    const forwardTarget = row.forward_extension_id
      ? byId.get(row.forward_extension_id)?.extension_number
      : undefined;
    lines.push(
      `exten => ${number},hint,PJSIP/${number}`,
      `exten => ${number},1,NoOp(Netbrowse Voice call to ${number})`,
    );
    if (row.dnd_enabled) {
      if (row.forward_mode === "unavailable" && forwardTarget) {
        lines.push(` same => n,Goto(${forwardTarget},1)`, "");
      } else if (row.voicemail_enabled) {
        lines.push(
          ` same => n(unavailable),VoiceMail(${number}@nbvoice,u)`,
          " same => n,Hangup()",
          "",
        );
      } else {
        lines.push(
          " same => n,Playback(vm-nobodyavail)",
          " same => n,Hangup()",
          "",
        );
      }
      continue;
    }
    if (row.forward_mode === "always" && forwardTarget) {
      lines.push(` same => n,Goto(${forwardTarget},1)`, "",);
      continue;
    }
    lines.push(
      ...(!row.call_waiting
        ? [` same => n,GotoIf($["\${DEVICE_STATE(PJSIP/${number})}"="BUSY"]?busy)`]
        : []),
      ` same => n,Set(NBVOICE_CONTACTS=\${PJSIP_DIAL_CONTACTS(${number})})`,
      ' same => n,GotoIf($["${NBVOICE_CONTACTS}"=""]?unavailable)',
      ...(row.record_calls
        ? [
            ' same => n,Set(NBVOICE_RECORDING=nbv-${UNIQUEID}.wav)',
            ' same => n,Set(CDR(userfield)=nbvoice-recording:${NBVOICE_RECORDING})',
            ' same => n,MixMonitor(/var/lib/netbrowse-voice/recordings/${NBVOICE_RECORDING},b)',
          ]
        : []),
      ` same => n,Dial(\${NBVOICE_CONTACTS},${row.ring_timeout_seconds})`,
      ...(row.record_calls ? [" same => n,StopMixMonitor()"] : []),
      ' same => n,GotoIf($["${DIALSTATUS}"="BUSY"]?busy)',
      ' same => n,GotoIf($["${DIALSTATUS}"="ANSWER"]?done:unavailable)',
    );
    if (row.forward_mode === "unavailable" && forwardTarget) {
      lines.push(` same => n(unavailable),Goto(${forwardTarget},1)`);
    } else if (row.voicemail_enabled) {
      lines.push(
        ` same => n(unavailable),VoiceMail(${number}@nbvoice,u)`,
        " same => n,Hangup()",
      );
    } else {
      lines.push(
        " same => n(unavailable),Playback(vm-nobodyavail)",
        " same => n,Hangup()",
      );
    }
    if (row.forward_mode === "busy" && forwardTarget) {
      lines.push(` same => n(busy),Goto(${forwardTarget},1)`);
    } else if (row.voicemail_enabled) {
      lines.push(
        ` same => n(busy),VoiceMail(${number}@nbvoice,b)`,
        " same => n,Hangup()",
      );
    } else {
      lines.push(" same => n(busy),Busy(5)", " same => n,Hangup()");
    }
    lines.push(" same => n(done),Hangup()", "");
  }
  lines.push(...renderCallGroupRoutes(callGroups, callGroupMembers));
  lines.push(...renderAiReceptionistRoutes(aiReceptionists));
  lines.push(...renderIvrInternalRoutes(ivrMenus));
  lines.push(...renderIvrContexts(ivrMenus, ivrOptions));
  lines.push(...renderAiQueueHandoffContexts(callGroups));
  return `${lines.join("\n")}\n`;
}

export function renderVoicemailConfig(rows: ExtensionRow[]): string {
  const lines = [
    "; Managed by Netbrowse Voice. Manual changes will be replaced.",
    "",
    "[general]",
    "format=wav",
    "attach=no",
    "maxmsg=100",
    "maxsecs=300",
    "minsecs=2",
    "review=yes",
    "operator=no",
    "saycid=yes",
    "envelope=yes",
    "",
    "[nbvoice]",
  ];
  for (const row of rows.filter(
    (item) => item.enabled && item.voicemail_enabled && item.voicemail_pin_ciphertext,
  )) {
    lines.push(
      `${row.extension_number} => ${decryptSecret(row.voicemail_pin_ciphertext!)},${safeCallerIdName(row.display_name)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function parsePjsipContacts(
  output: string,
  extensionNumbers: string[],
): Map<string, RegistrationStatus> {
  const statuses = new Map<string, RegistrationStatus>(
    extensionNumbers.map((number) => [
      number,
      { state: "unregistered", contactCount: 0 },
    ]),
  );
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*Contact:\s+([0-9]{2,8})\/\S+\s+\S+\s+(\S+)/);
    if (!match) continue;
    const number = match[1];
    const statusToken = match[2]?.toLowerCase() ?? "";
    const current = number ? statuses.get(number) : undefined;
    if (!current) continue;
    current.contactCount += 1;
    current.state = statusToken.startsWith("avail")
      ? "registered"
      : current.state === "registered"
        ? "registered"
        : "unreachable";
  }
  return statuses;
}

export async function getExtensionRegistrationStatuses(
  extensionNumbers: string[],
): Promise<Map<string, RegistrationStatus>> {
  try {
    const { stdout } = await execFileAsync(
      config.asteriskStatusCommand,
      ["-n", config.asteriskStatusHelper],
      { timeout: 5_000, maxBuffer: 1024 * 1024 },
    );
    return parsePjsipContacts(stdout, extensionNumbers);
  } catch {
    return new Map(
      extensionNumbers.map((number) => [
        number,
        { state: "unknown" as const, contactCount: 0 },
      ]),
    );
  }
}

async function atomicWrite(filename: string, content: string): Promise<void> {
  const target = `${config.asteriskStagingDir}/${filename}`;
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o640 });
  await rename(temporary, target);
}

export async function applyPbxConfiguration(): Promise<void> {
  const [
    extensionResult, trunkResult, didResult, ivrResult, ivrOptionResult, aiReceptionistResult,
    callGroupResult, callGroupMemberResult, outboundRouteResult,
  ] = await Promise.all([
    pool.query<ExtensionRow>(
      `SELECT id, extension_number, display_name, secret_ciphertext, enabled,
              max_contacts, ring_timeout_seconds, voicemail_enabled,
              voicemail_pin_ciphertext, dnd_enabled, call_waiting, record_calls, pickup_group,
              forward_mode, forward_extension_id, created_at, updated_at
         FROM extensions
        ORDER BY length(extension_number), extension_number`,
    ),
    pool.query<TrunkRow>(
      `SELECT id, name, auth_mode, provider_host, provider_port, transport,
              username, secret_ciphertext, registration_username, from_user,
              from_domain, inbound_match, dial_prefix, strip_plus,
              enabled, created_at, updated_at
         FROM sip_trunks
        ORDER BY name`,
    ),
    pool.query<DidRouteConfigRow>(
      `SELECT routes.did_number, routes.trunk_id, routes.destination_type,
              extensions.extension_number, routes.ivr_menu_id
         FROM did_routes AS routes
         JOIN sip_trunks AS trunks ON trunks.id = routes.trunk_id
         LEFT JOIN extensions ON extensions.id = routes.extension_id
         LEFT JOIN ivr_menus ON ivr_menus.id = routes.ivr_menu_id
        WHERE routes.enabled = true
          AND trunks.enabled = true
          AND (
            (routes.destination_type = 'extension' AND extensions.enabled = true)
            OR
            (routes.destination_type = 'ivr' AND ivr_menus.enabled = true)
          )
        ORDER BY length(routes.did_number), routes.did_number`,
    ),
    pool.query<IvrMenuConfigRow>(
      `SELECT menus.id, menus.name, menus.extension_number,
              sounds.asterisk_name AS greeting_asterisk_name,
              menus.timeout_seconds, menus.max_attempts,
              fallback.extension_number AS fallback_extension_number,
              menus.enabled
         FROM ivr_menus AS menus
         JOIN sound_assets AS sounds ON sounds.id = menus.greeting_sound_asset_id
         LEFT JOIN extensions AS fallback ON fallback.id = menus.fallback_extension_id
        ORDER BY length(menus.extension_number), menus.extension_number`,
    ),
    pool.query<IvrOptionConfigRow>(
      `SELECT options.ivr_menu_id, options.digit,
              extensions.extension_number AS destination_extension_number
         FROM ivr_options AS options
         JOIN ivr_menus AS menus ON menus.id = options.ivr_menu_id
         JOIN extensions ON extensions.id = options.destination_extension_id
        WHERE menus.enabled = true
          AND extensions.enabled = true
        ORDER BY options.ivr_menu_id, options.digit`,
    ),
    pool.query<AiReceptionistConfigRow>(
      `SELECT agents.id, agents.extension_number, agents.enabled, agents.provider,
              agents.disclosure_asterisk_name,
              sounds.asterisk_name AS greeting_asterisk_name
         FROM ai_receptionists AS agents
         JOIN sound_assets AS sounds ON sounds.id = agents.greeting_sound_asset_id
        ORDER BY length(agents.extension_number), agents.extension_number`,
    ),
    pool.query<CallGroupConfigRow>(
      `SELECT groups.id, groups.name, groups.extension_number, groups.group_type,
              groups.strategy, groups.ring_timeout_seconds, groups.retry_seconds,
              groups.max_wait_seconds, groups.wrapup_seconds,
              groups.fallback_extension_id,
              fallback.extension_number AS fallback_extension_number,
              groups.enabled, groups.created_by, groups.created_at, groups.updated_at
         FROM call_groups AS groups
         LEFT JOIN extensions AS fallback ON fallback.id = groups.fallback_extension_id
        ORDER BY length(groups.extension_number), groups.extension_number`,
    ),
    pool.query<CallGroupMemberConfigRow>(
      `SELECT members.call_group_id, members.extension_id,
              extensions.extension_number, extensions.display_name, members.position,
              COALESCE(states.signed_in, true) AS signed_in,
              COALESCE(states.paused, false) AS paused,
              states.pause_reason
         FROM call_group_members AS members
         JOIN call_groups AS groups ON groups.id = members.call_group_id
         JOIN extensions ON extensions.id = members.extension_id
         LEFT JOIN call_group_agent_states AS states
           ON states.call_group_id = members.call_group_id
          AND states.extension_id = members.extension_id
        WHERE groups.enabled = true AND extensions.enabled = true
        ORDER BY members.call_group_id, members.position`,
    ),
    pool.query<OutboundRouteConfigRow>(
      `SELECT routes.id, routes.name, routes.sip_trunk_id,
              routes.access_prefix, routes.outbound_caller_id,
              routes.ring_timeout_seconds, routes.enabled,
              trunks.enabled AS trunk_enabled,
              trunks.dial_prefix, trunks.strip_plus
         FROM outbound_routes AS routes
         JOIN sip_trunks AS trunks ON trunks.id = routes.sip_trunk_id
        ORDER BY routes.access_prefix, routes.name`,
    ),
  ]);
  await mkdir(config.asteriskStagingDir, { recursive: true, mode: 0o750 });
  await Promise.all([
    atomicWrite("pjsip_extensions.conf", renderPjsipConfig(extensionResult.rows)),
    atomicWrite(
      "extensions_internal.conf",
      renderDialplanConfig(
        extensionResult.rows,
        ivrResult.rows,
        ivrOptionResult.rows,
        aiReceptionistResult.rows,
        callGroupResult.rows,
        callGroupMemberResult.rows,
      ),
    ),
    atomicWrite("voicemail_netbrowse.conf", renderVoicemailConfig(extensionResult.rows)),
    atomicWrite("pjsip_trunks.conf", renderTrunkPjsipConfig(trunkResult.rows)),
    atomicWrite(
      "extensions_outbound.conf",
      renderOutboundDialplanConfig(outboundRouteResult.rows),
    ),
    atomicWrite("extensions_campaigns.conf", renderCampaignDialplan()),
    atomicWrite("queues_netbrowse.conf", renderQueueConfig(
      callGroupResult.rows,
      callGroupMemberResult.rows,
    )),
    atomicWrite(
      "extensions_inbound.conf",
      renderInboundDialplanConfig(
        didResult.rows,
        trunkResult.rows.filter((row) => row.enabled).map((row) => row.id),
      ),
    ),
  ]);
  await execFileAsync(config.asteriskApplyCommand, ["-n", config.asteriskApplyHelper], {
    // The API can invoke only this exact root-owned helper through sudoers.
    // No user input is ever passed to the privileged command.
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
}
