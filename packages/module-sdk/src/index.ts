export type ModuleStatus = "active" | "disabled" | "planned" | "incompatible";

export type ModulePermission = {
  key: string;
  label: string;
  description?: string;
};

export type NavigationItem = {
  key: string;
  label: string;
  path: string;
  permission?: string;
  order?: number;
};

export type ModuleManifest = {
  schemaVersion: 1;
  key: string;
  name: string;
  version: string;
  description: string;
  minimumCoreVersion: string;
  dependencies?: Record<string, string>;
  permissions?: ModulePermission[];
  navigation?: NavigationItem[];
  events?: {
    publishes?: string[];
    subscribes?: string[];
  };
};

export const coreEvents = {
  callStarted: "call.started",
  callAnswered: "call.answered",
  callBridged: "call.bridged",
  callCompleted: "call.completed",
  recordingAvailable: "recording.available",
  extensionCreated: "extension.created",
  moduleEnabled: "module.enabled",
  moduleDisabled: "module.disabled",
} as const;

export function defineModule<T extends ModuleManifest>(manifest: T): T {
  return manifest;
}
