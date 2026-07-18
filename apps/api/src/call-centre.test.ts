import assert from "node:assert/strict";
import test from "node:test";
import {
  queueIdentifier,
  renderCallGroupRoutes,
  renderQueueConfig,
  type CallGroupConfigRow,
  type CallGroupMemberConfigRow,
} from "./call-centre.js";

const group: CallGroupConfigRow = {
  id: "cda43e55-6388-40d8-a373-a3a8ca09ce5b",
  name: "Sales Queue",
  extension_number: "600",
  group_type: "queue",
  strategy: "rrmemory",
  ring_timeout_seconds: 15,
  retry_seconds: 5,
  max_wait_seconds: 60,
  wrapup_seconds: 8,
  fallback_extension_id: "b4c26e30-c36a-428e-9ed8-7d1d678b0fa1",
  fallback_extension_number: "100",
  enabled: true,
  created_by: null,
  created_at: new Date("2026-07-16T00:00:00Z"),
  updated_at: new Date("2026-07-16T00:00:00Z"),
};

const members: CallGroupMemberConfigRow[] = [
  {
    call_group_id: group.id,
    extension_id: "b4c26e30-c36a-428e-9ed8-7d1d678b0fa1",
    extension_number: "100",
    display_name: "Michael",
    position: 0,
    signed_in: true,
    paused: false,
    pause_reason: null,
  },
  {
    call_group_id: group.id,
    extension_id: "a178de66-b1e6-4885-89cb-f175b9d54339",
    extension_number: "102",
    display_name: "Another",
    position: 1,
    signed_in: true,
    paused: true,
    pause_reason: "break",
  },
];

test("queue configuration uses bounded Asterisk-native settings and members", () => {
  const output = renderQueueConfig([group], members);
  assert.match(output, /\[nbvq-cda43e55638840d8a373a3a8ca09ce5b\]/);
  assert.match(output, /strategy=rrmemory/);
  assert.match(output, /wrapuptime=8/);
  assert.match(output, /member => PJSIP\/100,0,,PJSIP\/100,no,8,no/);
  assert.match(output, /member => PJSIP\/102,0,,PJSIP\/102,no,8,yes/);
});

test("queue dialplan enforces maximum wait and fallback", () => {
  const output = renderCallGroupRoutes([group], members).join("\n");
  assert.match(output, /exten => 600,1,NoOp\(Netbrowse Voice call queue 600\)/);
  assert.match(output, /Queue\(nbvq-cda43e55638840d8a373a3a8ca09ce5b,t,,,60\)/);
  assert.match(output, /QUEUESTATUS.*TIMEOUT/);
  assert.match(output, /QUEUESTATUS.*JOINEMPTY/);
  assert.match(output, /n\(fallback\),Goto\(100,1\)/);
});

test("ring groups ring all validated members without queue configuration", () => {
  const ringGroup = { ...group, group_type: "ring_group" as const, extension_number: "601" };
  const output = renderCallGroupRoutes([ringGroup], members).join("\n");
  assert.match(output, /Set\(NBVOICE_GROUP_MEMBERS=PJSIP\/100&PJSIP\/102\)/);
  assert.match(output, /Dial\(\$\{NBVOICE_GROUP_MEMBERS\},15\)/);
  assert.doesNotMatch(renderQueueConfig([ringGroup], members), /nbvq-/);
});

test("queue identifiers reject untrusted values", () => {
  assert.equal(queueIdentifier(group.id), "nbvq-cda43e55638840d8a373a3a8ca09ce5b");
  assert.throws(() => queueIdentifier("../../unsafe"), /Invalid call group id/);
});

test("signed-out queue agents are not rendered as callable members", () => {
  const signedOut = members.map((member, index) => index === 0
    ? { ...member, signed_in: false }
    : member);
  const output = renderQueueConfig([group], signedOut);
  assert.doesNotMatch(output, /PJSIP\/100/);
  assert.match(output, /PJSIP\/102/);
});
