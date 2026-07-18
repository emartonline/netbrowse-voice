import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePjsipContacts,
  renderDialplanConfig,
  renderPjsipConfig,
  renderVoicemailConfig,
  type ExtensionRow,
} from "./pbx.js";
import { encryptSecret } from "./secrets.js";
import type { IvrMenuConfigRow, IvrOptionConfigRow } from "./ivr.js";

function extension(overrides: Partial<ExtensionRow> = {}): ExtensionRow {
  return {
    id: "b4c26e30-c36a-428e-9ed8-7d1d678b0fa1",
    extension_number: "1001",
    display_name: "Reception",
    secret_ciphertext: encryptSecret("secure-registration-password"),
    enabled: true,
    max_contacts: 2,
    ring_timeout_seconds: 25,
    voicemail_enabled: false,
    voicemail_pin_ciphertext: null,
    dnd_enabled: false,
    call_waiting: true,
    record_calls: false,
    pickup_group: null,
    forward_mode: "off",
    forward_extension_id: null,
    created_at: new Date("2026-07-15T00:00:00Z"),
    updated_at: new Date("2026-07-15T00:00:00Z"),
    ...overrides,
  };
}

test("PJSIP renderer creates linked endpoint, auth and AoR sections", () => {
  const config = renderPjsipConfig([extension()]);
  assert.match(config, /\[nbvoice-transport-udp\][\s\S]*protocol=udp/);
  assert.match(config, /\[nbvoice-transport-tcp\][\s\S]*protocol=tcp/);
  assert.match(config, /\[1001\]\ntype=endpoint/);
  assert.match(config, /auth=1001-auth/);
  assert.match(config, /aors=1001/);
  assert.match(config, /callerid="Reception" <1001>/);
  assert.match(config, /\[1001-auth\][\s\S]*password=secure-registration-password/);
  assert.match(config, /\[1001\]\ntype=aor[\s\S]*max_contacts=2/);
  assert.doesNotMatch(config, /1001-aor/);
});

test("dialplan renderer creates a hint and internal call route", () => {
  const config = renderDialplanConfig([extension()]);
  assert.match(config, /exten => 1001,hint,PJSIP\/1001/);
  assert.match(config, /Set\(NBVOICE_CONTACTS=\$\{PJSIP_DIAL_CONTACTS\(1001\)\}\)/);
  assert.match(config, /GotoIf\(\$\["\$\{NBVOICE_CONTACTS\}"=""\]\?unavailable\)/);
  assert.match(config, /Dial\(\$\{NBVOICE_CONTACTS\},25\)/);
  assert.match(config, /GotoIf\(\$\["\$\{DIALSTATUS\}"="BUSY"\]\?busy\)/);
  assert.match(config, /Playback\(vm-nobodyavail\)/);
  assert.match(config, /Busy\(5\)/);
});

test("extension services render voicemail, MWI and pickup configuration", () => {
  const row = extension({
    voicemail_enabled: true,
    voicemail_pin_ciphertext: encryptSecret("4829"),
    call_waiting: false,
    pickup_group: 3,
  });
  const pjsip = renderPjsipConfig([row]);
  const dialplan = renderDialplanConfig([row]);
  const voicemail = renderVoicemailConfig([row]);
  assert.match(pjsip, /mailboxes=1001@nbvoice/);
  assert.match(pjsip, /device_state_busy_at=1/);
  assert.match(pjsip, /call_group=3/);
  assert.match(pjsip, /pickup_group=3/);
  assert.match(dialplan, /exten => \*97,1/);
  assert.match(dialplan, /exten => \*8,1/);
  assert.match(dialplan, /DEVICE_STATE\(PJSIP\/1001\)/);
  assert.match(dialplan, /Dial\(\$\{NBVOICE_CONTACTS\},25\)/);
  assert.match(dialplan, /VoiceMail\(1001@nbvoice,u\)/);
  assert.match(dialplan, /VoiceMail\(1001@nbvoice,b\)/);
  assert.match(voicemail, /\[nbvoice\]/);
  assert.match(voicemail, /1001 => 4829,Reception/);
});

test("recording-enabled extensions link MixMonitor WAV files to the CDR", () => {
  const dialplan = renderDialplanConfig([extension({ record_calls: true })]);
  assert.match(dialplan, /Set\(NBVOICE_RECORDING=nbv-\$\{UNIQUEID\}\.wav\)/);
  assert.match(dialplan, /Set\(CDR\(userfield\)=nbvoice-recording:\$\{NBVOICE_RECORDING\}\)/);
  assert.match(dialplan, /MixMonitor\(\/var\/lib\/netbrowse-voice\/recordings\/\$\{NBVOICE_RECORDING\},b\)/);
  assert.match(dialplan, /StopMixMonitor\(\)/);
});

test("dialplan renderer applies forwarding to another extension", () => {
  const target = extension({
    id: "cda43e55-6388-40d8-a373-a3a8ca09ce5b",
    extension_number: "1002",
    display_name: "Sales",
  });
  const source = extension({
    forward_mode: "unavailable",
    forward_extension_id: target.id,
  });
  const dialplan = renderDialplanConfig([source, target]);
  assert.match(dialplan, /n\(unavailable\),Goto\(1002,1\)/);
});

test("do not disturb sends calls to the configured voicemail action", () => {
  const dialplan = renderDialplanConfig([
    extension({
      dnd_enabled: true,
      voicemail_enabled: true,
      voicemail_pin_ciphertext: encryptSecret("4829"),
    }),
  ]);
  assert.match(dialplan, /n\(unavailable\),VoiceMail\(1001@nbvoice,u\)/);
  assert.doesNotMatch(dialplan, /PJSIP_DIAL_CONTACTS\(1001\)/);
});

test("contact parser distinguishes registered, unreachable and unregistered devices", () => {
  const statuses = parsePjsipContacts(
    ` Contact:  1001/sip:1001@192.0.2.10:5060 abc123 Avail 4.321\n` +
      ` Contact:  1002/sip:1002@192.0.2.11:5060 def456 Unavail nan\n`,
    ["1001", "1002", "1003"],
  );
  assert.deepEqual(statuses.get("1001"), { state: "registered", contactCount: 1 });
  assert.deepEqual(statuses.get("1002"), { state: "unreachable", contactCount: 1 });
  assert.deepEqual(statuses.get("1003"), { state: "unregistered", contactCount: 0 });
});

test("disabled extensions are not rendered into Asterisk", () => {
  const pjsip = renderPjsipConfig([extension({ enabled: false })]);
  const dialplan = renderDialplanConfig([extension({ enabled: false })]);
  assert.doesNotMatch(pjsip, /\[1001\]/);
  assert.doesNotMatch(dialplan, /PJSIP\/1001/);
});

test("dialplan renderer appends active IVR menus", () => {
  const menu: IvrMenuConfigRow = {
    id: "cda43e55-6388-40d8-a373-a3a8ca09ce5b",
    name: "Main Menu",
    extension_number: "700",
    greeting_asterisk_name: "netbrowse/nbvs-main-menu-cda43e55",
    timeout_seconds: 6,
    max_attempts: 2,
    fallback_extension_number: "1001",
    enabled: true,
  };
  const options: IvrOptionConfigRow[] = [{
    ivr_menu_id: menu.id,
    digit: "1",
    destination_extension_number: "1001",
  }];
  const dialplan = renderDialplanConfig([extension()], [menu], options);
  assert.match(dialplan, /exten => 700,1,NoOp\(Netbrowse Voice IVR 700\)/);
  assert.match(dialplan, /\[nbvoice-ivr-cda43e55638840d8a373a3a8ca09ce5b\]/);
  assert.match(dialplan, /Read\(NBVOICE_IVR_DIGIT,netbrowse\/nbvs-main-menu-cda43e55,1,,1,6\)/);
});

test("dialplan renderer appends active AI receptionist routes", () => {
  const dialplan = renderDialplanConfig([extension()], [], [], [{
    id: "cda43e55-6388-40d8-a373-a3a8ca09ce5b",
    extension_number: "800",
    enabled: true,
    provider: "elevenlabs",
    greeting_asterisk_name: "netbrowse/nbvs-main-greeting-cda43e55",
    disclosure_asterisk_name: null,
  }]);
  assert.match(dialplan, /exten => 800,1,NoOp\(Netbrowse Voice AI receptionist 800\)/);
  assert.match(dialplan, /AGI\(agi:\/\/127\.0\.0\.1:4573\/agent\/cda43e55-6388-40d8-a373-a3a8ca09ce5b\)/);
});
