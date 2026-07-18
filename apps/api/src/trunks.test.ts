import assert from "node:assert/strict";
import test from "node:test";
import { encryptSecret } from "./secrets.js";
import {
  formatTrunkDialNumber,
  parseTrunkRegistrations,
  renderInboundDialplanConfig,
  renderOutboundDialplanConfig,
  renderTrunkPjsipConfig,
  trunkSectionName,
  type TrunkRow,
} from "./trunks.js";

function trunk(overrides: Partial<TrunkRow> = {}): TrunkRow {
  return {
    id: "75fc4720-908b-462a-9567-28190f51470a",
    name: "Example Provider",
    auth_mode: "registration",
    provider_host: "sip.example.net",
    provider_port: 5060,
    transport: "udp",
    username: "27870001111",
    secret_ciphertext: encryptSecret("provider-secret-123"),
    registration_username: "27870001111",
    registration_contact_user: null,
    from_user: null,
    from_domain: null,
    inbound_match: "192.0.2.0/24",
    dial_prefix: "",
    strip_plus: true,
    enabled: true,
    created_at: new Date("2026-07-16T00:00:00Z"),
    updated_at: new Date("2026-07-16T00:00:00Z"),
    ...overrides,
  };
}

test("registration trunk renderer creates endpoint, auth, AoR, registration and identify sections", () => {
  const row = trunk({ registration_contact_user: "17770001111" });
  const section = trunkSectionName(row.id);
  const output = renderTrunkPjsipConfig([row]);
  assert.match(output, new RegExp(`\\[${section}\\]\\ntype=endpoint`));
  assert.match(output, new RegExp(`aors=${section}-aor`));
  assert.match(output, new RegExp(`outbound_auth=${section}-auth`));
  assert.match(output, /password=provider-secret-123/);
  assert.match(output, /server_uri=sip:sip\.example\.net:5060/);
  assert.match(output, /client_uri=sip:27870001111@sip\.example\.net/);
  assert.match(output, /contact_user=17770001111/);
  assert.match(output, /line=yes/);
  assert.match(output, /match=192\.0\.2\.0\/24/);
});

test("registration Contact user is omitted unless configured", () => {
  const output = renderTrunkPjsipConfig([trunk()]);
  assert.doesNotMatch(output, /contact_user=/);
});

test("IP-authenticated trunk renderer omits registration and credentials", () => {
  const output = renderTrunkPjsipConfig([
    trunk({
      auth_mode: "ip",
      username: null,
      secret_ciphertext: null,
      inbound_match: "198.51.100.20",
    }),
  ]);
  assert.match(output, /type=identify/);
  assert.match(output, /match=198\.51\.100\.20/);
  assert.doesNotMatch(output, /type=registration/);
  assert.doesNotMatch(output, /type=auth/);
});

test("digest trunk sends credentials without creating an outbound registration", () => {
  const output = renderTrunkPjsipConfig([
    trunk({
      auth_mode: "credentials",
      registration_username: null,
      from_user: "account-voice",
      from_domain: "voice.example.net",
      inbound_match: "198.51.100.20,198.51.100.21/32",
    }),
  ]);
  assert.match(output, /outbound_auth=nbvt-[0-9a-f]{32}-auth/);
  assert.match(output, /from_user=account-voice/);
  assert.match(output, /from_domain=voice\.example\.net/);
  assert.match(output, /match=198\.51\.100\.20\nmatch=198\.51\.100\.21\/32/);
  assert.doesNotMatch(output, /type=registration/);
});

test("TCP provider trunks select the managed TCP transport", () => {
  const output = renderTrunkPjsipConfig([trunk({ transport: "tcp" })]);
  assert.match(output, /transport=nbvoice-transport-tcp/);
});

test("outbound number formatting applies a carrier prefix and plus policy", () => {
  const row = trunk({ dial_prefix: "0011104", strip_plus: true });
  assert.equal(formatTrunkDialNumber("+442079460123", row), "0011104442079460123");
  assert.equal(
    formatTrunkDialNumber("+442079460123", { dial_prefix: "", strip_plus: false }),
    "+442079460123",
  );
  assert.throws(() => formatTrunkDialNumber("02079460123", row), /E\.164/);
});

test("inbound DID renderer routes exact numbers into the internal context", () => {
  const output = renderInboundDialplanConfig([
    {
      did_number: "+27115550100",
      trunk_id: "75fc4720-908b-462a-9567-28190f51470a",
      destination_type: "extension",
      extension_number: "1001",
      ivr_menu_id: null,
    },
  ]);
  assert.match(output, /\[nbvt-75fc4720908b462a956728190f51470a-inbound\]/);
  assert.match(output, /exten => \+27115550100,1,NoOp/);
  assert.match(output, /Goto\(nbvoice-internal,1001,1\)/);
  assert.match(output, /exten => _\+X!,1/);
});

test("inbound DID renderer routes a provider number directly into an IVR", () => {
  const output = renderInboundDialplanConfig([
    {
      did_number: "+27115550101",
      trunk_id: "75fc4720-908b-462a-9567-28190f51470a",
      destination_type: "ivr",
      extension_number: null,
      ivr_menu_id: "b4c26e30-c36a-428e-9ed8-7d1d678b0fa1",
    },
  ]);
  assert.match(
    output,
    /Goto\(nbvoice-ivr-b4c26e30c36a428e9ed87d1d678b0fa1,s,1\)/,
  );
  assert.doesNotMatch(output, /Goto\(nbvoice-internal/);
});

test("outbound route renderer exposes exact E.164 access-code patterns", () => {
  const output = renderOutboundDialplanConfig([{
    id: "b4c26e30-c36a-428e-9ed8-7d1d678b0fa1",
    name: "Voxbeam outbound",
    sip_trunk_id: "75fc4720-908b-462a-9567-28190f51470a",
    access_prefix: "9",
    outbound_caller_id: "+27115550100",
    ring_timeout_seconds: 60,
    enabled: true,
    trunk_enabled: true,
    dial_prefix: "0011104",
    strip_plus: true,
  }]);
  assert.match(output, /exten => _9XXXXXXXX,1,Goto\(nbvoice-outbound-b4c26e30c36a428e9ed87d1d678b0fa1,\$\{EXTEN:1\},1\)/);
  assert.match(output, /exten => _9XXXXXXXXXXXXXXX,1,Goto/);
  assert.match(output, /AGI\(agi:\/\/127\.0\.0\.1:4573\/billing-authorize\/b4c26e30-c36a-428e-9ed8-7d1d678b0fa1\/\$\{CHANNEL\(endpoint\)\}\/\$\{EXTEN\}\)/);
  assert.match(output, /GotoIf\(\$\["\$\{NBVOICE_BILLING_ALLOWED\}"="1"\]\?authorized:blocked\)/);
  assert.match(output, /Set\(CDR\(peeraccount\)=NBVOICE:BILLING_BLOCKED\)/);
  assert.match(output, /Playback\(netbrowse\/nbvoice-billing-blocked\)/);
  assert.match(output, /Set\(CDR\(accountcode\)=\$\{NBVOICE_BILLING_CUSTOMER_ID\}\)/);
  assert.match(output, /Set\(NBVOICE_OUTBOUND_DESTINATION=0011104\$\{EXTEN\}\)/);
  assert.match(output, /Set\(CALLERID\(num\)=\+27115550100\)/);
  assert.match(output, /Dial\(PJSIP\/\$\{NBVOICE_OUTBOUND_DESTINATION\}@nbvt-75fc4720908b462a956728190f51470a,60\)/);
  assert.match(output, /Set\(CDR\(peeraccount\)=NBVOICE:\$\{DIALSTATUS\}\)/);
});

test("disabled outbound routes are not published", () => {
  const output = renderOutboundDialplanConfig([{
    id: "b4c26e30-c36a-428e-9ed8-7d1d678b0fa1",
    name: "Disabled",
    sip_trunk_id: "75fc4720-908b-462a-9567-28190f51470a",
    access_prefix: "9",
    outbound_caller_id: null,
    ring_timeout_seconds: 60,
    enabled: false,
    trunk_enabled: true,
    dial_prefix: "",
    strip_plus: true,
  }]);
  assert.doesNotMatch(output, /Goto\(nbvoice-outbound-/);
});

test("registration parser reports registration, digest and IP trunk states", () => {
  const registered = trunk();
  const ip = trunk({
    id: "96ed0722-ef3e-48ac-aa04-ac80ae6dde2e",
    auth_mode: "ip",
    username: null,
    secret_ciphertext: null,
  });
  const credentials = trunk({
    id: "9ea72ecb-3e43-411e-b99f-cf920fd289f0",
    auth_mode: "credentials",
    registration_username: null,
  });
  const registration = `${trunkSectionName(registered.id)}-registration`;
  const states = parseTrunkRegistrations(
    ` ${registration}/sip:sip.example.net:5060  ${registration}-auth  Registered (exp. 287s)\n`,
    [registered, ip, credentials],
  );
  assert.equal(states.get(registered.id), "registered");
  assert.equal(states.get(ip.id), "not_required");
  assert.equal(states.get(credentials.id), "configured");
});

test("disabled trunks are not rendered", () => {
  const output = renderTrunkPjsipConfig([trunk({ enabled: false })]);
  assert.doesNotMatch(output, /type=endpoint/);
});
