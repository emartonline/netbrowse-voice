import assert from "node:assert/strict";
import test from "node:test";
import { customerExtensionRange, customerServicePlanValues } from "./customer-plans.js";

test("service plans validate quotas and feature allowances", () => {
  assert.deepEqual(customerServicePlanValues({
    name: "Business Plus",
    description: "PBX and automation",
    maxExtensions: 25,
    maxDids: 10,
    recordingStorageMb: 2048,
    maxAiReceptionists: 2,
    maxCampaigns: 3,
    selfServiceExtensions: true,
    recordingEnabled: true,
    aiReceptionistEnabled: true,
    campaignsEnabled: true,
    enabled: true,
  }), {
    name: "Business Plus",
    description: "PBX and automation",
    maxExtensions: 25,
    maxDids: 10,
    recordingStorageMb: 2048,
    maxAiReceptionists: 2,
    maxCampaigns: 3,
    selfServiceExtensions: true,
    recordingEnabled: true,
    aiReceptionistEnabled: true,
    campaignsEnabled: true,
    enabled: true,
  });
});

test("disabled features cannot retain resource allowances", () => {
  assert.throws(() => customerServicePlanValues({
    name: "Invalid",
    recordingEnabled: false,
    recordingStorageMb: 100,
  }), /Enable call recording/);
  assert.throws(() => customerServicePlanValues({
    name: "Invalid",
    aiReceptionistEnabled: false,
    maxAiReceptionists: 1,
  }), /Enable AI receptionist/);
  assert.throws(() => customerServicePlanValues({
    name: "Invalid",
    campaignsEnabled: false,
    maxCampaigns: 1,
  }), /Enable campaigns/);
});

test("customer extension ranges are bounded and optional", () => {
  assert.deepEqual(customerExtensionRange("200", "209"), { start: 200, end: 209 });
  assert.deepEqual(customerExtensionRange("", null), { start: null, end: null });
  assert.throws(() => customerExtensionRange("99", "100"), /2 to 8 digit/);
  assert.throws(() => customerExtensionRange("200", "199"), /2 to 8 digit/);
  assert.throws(() => customerExtensionRange("10000", "29999"), /10,000 entries/);
});
