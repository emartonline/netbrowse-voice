import assert from "node:assert/strict";
import test from "node:test";
import { callDirection, normalizeDisposition, parseActiveChannels } from "./calls.js";

function concise(fields: string[]): string {
  return fields.join("!");
}

test("parseActiveChannels groups an answered internal call by linked id", () => {
  const output = [
    concise([
      "PJSIP/100-00000001", "nbvoice-internal", "102", "4", "Up", "Dial",
      "PJSIP/102/sip:102@192.168.68.101:51856", "100", "", "", "15",
      "PJSIP/102-00000002", "1770000000.1", "1770000000.1",
    ]),
    concise([
      "PJSIP/102-00000002", "nbvoice-internal", "102", "1", "Up", "AppDial",
      "(Outgoing Line)", "100", "", "", "14", "PJSIP/100-00000001",
      "1770000000.2", "1770000000.1",
    ]),
  ].join("\n");
  assert.deepEqual(parseActiveChannels(output), [{
    id: "1770000000.1",
    source: "100",
    destination: "102",
    state: "answered",
    durationSeconds: 15,
    sourceChannel: "PJSIP/100-00000001",
    destinationChannel: "PJSIP/102-00000002",
  }]);
});

test("parseActiveChannels identifies a ringing call and ignores summary text", () => {
  const output = `${concise([
    "PJSIP/102-00000003", "nbvoice-internal", "100", "4", "Ringing", "Dial",
    "PJSIP/100/sip:100@192.168.68.101:54831", "102", "", "", "00:00:04",
    "", "1770000001.1", "1770000001.1",
  ])}\n1 active channel`;
  const calls = parseActiveChannels(output);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.source, "102");
  assert.equal(calls[0]?.destination, "100");
  assert.equal(calls[0]?.state, "ringing");
  assert.equal(calls[0]?.durationSeconds, 4);
});

test("normalizes CDR dispositions and directions", () => {
  assert.equal(normalizeDisposition("ANSWERED"), "answered");
  assert.equal(normalizeDisposition("NO ANSWER"), "missed");
  assert.equal(normalizeDisposition("CONGESTION"), "failed");
  assert.equal(normalizeDisposition("NO ANSWER", "NBVOICE:CHANUNAVAIL", 0, "nbvoice-outbound-test"), "failed");
  assert.equal(normalizeDisposition("NO ANSWER", "NBVOICE:NOANSWER", 12, "nbvoice-outbound-test"), "missed");
  assert.equal(normalizeDisposition("NO ANSWER", "", 0, "nbvoice-outbound-test"), "failed");
  assert.equal(callDirection("nbvoice-internal", "100", "102"), "internal");
  assert.equal(callDirection("nbvt-0123456789abcdef0123456789abcdef-inbound", "+27110000000", "100"), "inbound");
  assert.equal(callDirection("nbvoice-outbound-0123456789abcdef0123456789abcdef", "100", "27821234567"), "outbound");
});
