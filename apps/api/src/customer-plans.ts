export interface CustomerServicePlanValues {
  name: string;
  description: string;
  maxExtensions: number;
  maxDids: number;
  recordingStorageMb: number;
  maxAiReceptionists: number;
  maxCampaigns: number;
  selfServiceExtensions: boolean;
  recordingEnabled: boolean;
  aiReceptionistEnabled: boolean;
  campaignsEnabled: boolean;
  enabled: boolean;
}

function boundedInteger(value: unknown, label: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be a whole number between 0 and ${maximum}`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be enabled or disabled`);
  return value;
}

export function customerServicePlanValues(
  body: Partial<CustomerServicePlanValues>,
): CustomerServicePlanValues {
  const name = body.name?.trim() ?? "";
  const description = body.description?.trim() ?? "";
  if (name.length < 2 || name.length > 100) throw new Error("Enter a valid plan name");
  if (description.length > 500) throw new Error("Plan description is too long");
  const recordingEnabled = booleanValue(body.recordingEnabled ?? false, "Call recording");
  const aiReceptionistEnabled = booleanValue(body.aiReceptionistEnabled ?? false, "AI receptionist");
  const campaignsEnabled = booleanValue(body.campaignsEnabled ?? false, "Campaigns");
  const recordingStorageMb = boundedInteger(body.recordingStorageMb ?? 0, "Recording storage", 1_000_000);
  const maxAiReceptionists = boundedInteger(body.maxAiReceptionists ?? 0, "AI receptionist limit", 1_000);
  const maxCampaigns = boundedInteger(body.maxCampaigns ?? 0, "Campaign limit", 1_000);
  if (!recordingEnabled && recordingStorageMb > 0) {
    throw new Error("Enable call recording before allocating recording storage");
  }
  if (!aiReceptionistEnabled && maxAiReceptionists > 0) {
    throw new Error("Enable AI receptionist before allocating AI agents");
  }
  if (!campaignsEnabled && maxCampaigns > 0) {
    throw new Error("Enable campaigns before allocating campaigns");
  }
  return {
    name,
    description,
    maxExtensions: boundedInteger(body.maxExtensions ?? 0, "Extension limit", 10_000),
    maxDids: boundedInteger(body.maxDids ?? 0, "DID limit", 10_000),
    recordingStorageMb,
    maxAiReceptionists,
    maxCampaigns,
    selfServiceExtensions: booleanValue(body.selfServiceExtensions ?? false, "Extension self-service"),
    recordingEnabled,
    aiReceptionistEnabled,
    campaignsEnabled,
    enabled: booleanValue(body.enabled ?? true, "Plan status"),
  };
}

export interface CustomerExtensionRange {
  start: number | null;
  end: number | null;
}

export function customerExtensionRange(startValue: unknown, endValue: unknown): CustomerExtensionRange {
  if (
    (startValue === undefined || startValue === null || startValue === "")
    && (endValue === undefined || endValue === null || endValue === "")
  ) {
    return { start: null, end: null };
  }
  const start = Number(startValue);
  const end = Number(endValue);
  if (
    !Number.isInteger(start) || !Number.isInteger(end)
    || start < 10 || end < start || end > 99_999_999
    || String(start).length !== String(end).length
    || end - start > 9_999
  ) {
    throw new Error("Extension range must contain 2 to 8 digit numbers and no more than 10,000 entries");
  }
  return { start, end };
}
