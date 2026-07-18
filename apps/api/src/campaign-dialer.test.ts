import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignResultFromAgiEnvironment,
  normalizeCampaignDialStatus,
  renderCampaignCallFile,
  renderCampaignDialplan,
} from "./campaign-dialer.js";

const attemptId = "cda43e55-6388-40d8-a373-a3a8ca09ce5b";

test("campaign dialplan uses a localhost result callback", () => {
  const output = renderCampaignDialplan();
  assert.match(output, /^\[nbvoice-campaign-originate\]$/m);
  assert.match(output, /Dial\(PJSIP\/\$\{NBVOICE_CAMPAIGN_DESTINATION\}@\$\{NBVOICE_CAMPAIGN_TRUNK\}/);
  assert.match(output, /Set\(CDR\(peeraccount\)=NBVOICE:\$\{NBVOICE_CAMPAIGN_RESULT\}\)/);
  assert.match(output, /AGI\(agi:\/\/127\.0\.0\.1:4573\/campaign-result\//);
});

test("campaign call file contains only bounded Asterisk directives", () => {
  const output = renderCampaignCallFile({
    attemptId,
    destination: "27821234567",
    destinationExtension: "600",
    trunkSection: "nbvt-0123456789abcdef0123456789abcdef",
    callerId: "+27101234567",
    ringTimeoutSeconds: 45,
  });
  assert.match(output, /^Channel: Local\/s@nbvoice-campaign-originate\/n$/m);
  assert.match(output, /^Context: nbvoice-internal$/m);
  assert.match(output, /^Extension: 600$/m);
  assert.match(output, new RegExp(`^Setvar: __NBVOICE_CAMPAIGN_ATTEMPT_ID=${attemptId}$`, "m"));
  assert.doesNotMatch(output, /System|SHELL|TrySystem/i);
});

test("campaign call file rejects destination injection", () => {
  assert.throws(() => renderCampaignCallFile({
    attemptId,
    destination: "27821234567&Local/100",
    destinationExtension: "600",
    trunkSection: "nbvt-0123456789abcdef0123456789abcdef",
    callerId: "+27101234567",
    ringTimeoutSeconds: 45,
  }), /destination/i);
});

test("campaign result callback parser accepts only attempt UUIDs and known-shaped statuses", () => {
  assert.deepEqual(campaignResultFromAgiEnvironment({
    agi_network_script: `/campaign-result/${attemptId}/NOANSWER`,
  }), { attemptId, dialStatus: "NOANSWER" });
  assert.equal(campaignResultFromAgiEnvironment({
    agi_network_script: "/campaign-result/not-a-uuid/ANSWER",
  }), undefined);
});

test("campaign dial statuses map to contact outcomes", () => {
  assert.equal(normalizeCampaignDialStatus("ANSWER"), "answered");
  assert.equal(normalizeCampaignDialStatus("NOANSWER"), "no_answer");
  assert.equal(normalizeCampaignDialStatus("BUSY"), "busy");
  assert.equal(normalizeCampaignDialStatus("CHANUNAVAIL"), "failed");
});
