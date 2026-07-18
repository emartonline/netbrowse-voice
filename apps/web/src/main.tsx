import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./reseller.css";
import "./branding.css";

type Screen =
  | "loading"
  | "setup"
  | "login"
  | "dashboard"
  | "agent"
  | "customer";

type User = {
  id: string;
  email: string;
  displayName: string;
  role: "owner" | "administrator" | "agent" | "customer_admin";
  extensionId: string | null;
  customerId: string | null;
};

type PortalBranding = {
  slug: string;
  brandName: string;
  portalTitle: string;
  primaryColor: string;
  accentColor: string;
  supportEmail: string;
  supportPhone: string;
  websiteUrl: string;
  logoUrl: string | null;
  loginPath: string;
};

type BrandingSettingsData = {
  branding: PortalBranding;
  enabled: boolean;
};

type BrandingDraft = Omit<PortalBranding, "logoUrl" | "loginPath"> & {
  enabled: boolean;
};

type Service = {
  key: string;
  label: string;
  state: "online" | "offline" | "unavailable";
  detail?: string;
};

type VoiceModule = {
  key: string;
  name: string;
  version: string;
  status: string;
  description: string;
};

type DashboardData = {
  user: User;
  services: Service[];
  extensionCount: number;
  trunkCount: number;
  didCount: number;
  billingToday: Array<{ currency: string; cost: number }>;
  metrics: {
    hostname: string;
    platform: string;
    architecture: string;
    uptimeSeconds: number;
    cpuCount: number;
    loadAverage: number[];
    memory: { total: number; free: number };
    disk: { total: number; free: number };
  };
  modules: VoiceModule[];
};

type Extension = {
  id: string;
  extensionNumber: string;
  displayName: string;
  enabled: boolean;
  maxContacts: number;
  registrationState: "registered" | "unregistered" | "unreachable" | "unknown";
  deviceCount: number;
  ringTimeoutSeconds: number;
  voicemailEnabled: boolean;
  voicemailConfigured: boolean;
  dndEnabled: boolean;
  callWaiting: boolean;
  recordCalls: boolean;
  pickupGroup: number | null;
  forwardMode: "off" | "always" | "busy" | "unavailable";
  forwardExtensionId: string | null;
  forwardExtensionNumber: string | null;
  createdAt: string;
  updatedAt: string;
};

type SipCredentials = {
  username: string;
  password: string;
  port: number;
  transport: string;
};

type SipTrunk = {
  id: string;
  name: string;
  authMode: "registration" | "credentials" | "ip";
  providerHost: string;
  providerPort: number;
  transport: "udp" | "tcp";
  username: string | null;
  passwordConfigured: boolean;
  registrationUsername: string | null;
  registrationContactUser: string | null;
  fromUser: string | null;
  fromDomain: string | null;
  inboundMatch: string | null;
  dialPrefix: string;
  stripPlus: boolean;
  enabled: boolean;
  registrationState:
    | "registered"
    | "unregistered"
    | "rejected"
    | "configured"
    | "not_required"
    | "unknown";
  didCount: number;
  createdAt: string;
  updatedAt: string;
};

type DidRoute = {
  id: string;
  didNumber: string;
  trunkId: string;
  trunkName: string;
  destinationType: "extension" | "ivr";
  destinationId: string;
  destinationNumber: string;
  destinationName: string;
  enabled: boolean;
  published: boolean;
  createdAt: string;
  updatedAt: string;
};

type OutboundRoute = {
  id: string;
  name: string;
  sipTrunkId: string;
  trunkName: string;
  trunkEnabled: boolean;
  accessPrefix: string;
  outboundCallerId: string | null;
  ringTimeoutSeconds: number;
  enabled: boolean;
  published: boolean;
  providerDialPrefix: string;
  providerStripsPlus: boolean;
  createdAt: string;
  updatedAt: string;
};

type ActiveCall = {
  id: string;
  source: string;
  destination: string;
  state: "dialing" | "ringing" | "answered" | "voicemail";
  durationSeconds: number;
  sourceChannel: string;
  destinationChannel: string;
};

type CallRecord = {
  id: string;
  startedAt: string;
  callerName: string;
  source: string;
  destination: string;
  direction: "internal" | "inbound" | "outbound" | "unknown";
  status: "answered" | "missed" | "busy" | "failed" | "unknown";
  durationSeconds: number;
  ringSeconds: number;
  billableSeconds: number;
  linkedId: string;
  recordingAvailable: boolean;
  recordingId: string | null;
};

type Recording = {
  id: string;
  startedAt: string;
  callerName: string;
  source: string;
  destination: string;
  durationSeconds: number;
  billableSeconds: number;
  sizeBytes: number;
  linkedId: string;
};

type RecordingData = {
  recordings: Recording[];
  total: number;
  storageBytes: number;
  retentionDays: number;
};

type CustomerRecordingData = RecordingData & {
  storageLimitBytes: number;
  storagePercent: number;
  recordingEnabled: boolean;
  recordingReason: string;
};

type SoundAsset = {
  id: string;
  name: string;
  provider: string;
  model: string;
  voice: string;
  sourceText: string;
  instructions: string;
  speed: number;
  durationMs: number;
  sizeBytes: number;
  sampleRate: number;
  channels: number;
  asteriskName: string;
  audioAvailable: boolean;
  createdAt: string;
};

type ProviderVoice = {
  id: string;
  name: string;
  description?: string;
};

type SoundProvider = {
  key: "openai" | "google" | "elevenlabs";
  name: string;
  configured: boolean;
  model: string;
  voices: ProviderVoice[];
  recommendedVoices: string[];
  controls: {
    instructions: boolean;
    speed: boolean;
  };
  preview?: boolean;
  managedAccountRequired?: boolean;
  voiceLoadError?: string;
};

type SoundStudioData = {
  providers: SoundProvider[];
  provider: SoundProvider;
  sounds: SoundAsset[];
  total: number;
  storageBytes: number;
  aiDisclosureRequired: boolean;
};

type IvrOption = {
  digit: string;
  extensionId: string;
  extensionNumber: string;
  extensionName: string;
};

type IvrMenu = {
  id: string;
  name: string;
  internalNumber: string;
  greetingSoundId: string;
  greetingSoundName: string;
  timeoutSeconds: number;
  maxAttempts: number;
  fallbackExtensionId: string | null;
  fallbackExtensionNumber: string | null;
  enabled: boolean;
  options: IvrOption[];
  createdAt: string;
  updatedAt: string;
};

type IvrData = {
  ivrs: IvrMenu[];
  sounds: Array<{ id: string; name: string; provider: string; voice: string }>;
  extensions: Array<{
    id: string;
    extensionNumber: string;
    displayName: string;
  }>;
};

type IvrDraft = {
  id?: string;
  name: string;
  internalNumber: string;
  greetingSoundId: string;
  timeoutSeconds: number;
  maxAttempts: number;
  fallbackExtensionId: string;
  enabled: boolean;
  options: Array<{ digit: string; extensionId: string }>;
};

type CallCentreExtension = {
  id: string;
  extensionNumber: string;
  displayName: string;
  registrationState: "registered" | "unregistered" | "unreachable" | "unknown";
};

type CallGroup = {
  id: string;
  name: string;
  internalNumber: string;
  groupType: "ring_group" | "queue";
  strategy: "ringall" | "rrmemory" | "leastrecent";
  ringTimeoutSeconds: number;
  retrySeconds: number;
  maxWaitSeconds: number;
  wrapupSeconds: number;
  fallbackExtensionId: string | null;
  fallbackExtensionNumber: string | null;
  members: Array<{
    extensionId: string;
    extensionNumber: string;
    displayName: string;
    enabled: boolean;
    signedIn: boolean;
    paused: boolean;
    pauseReason: "break" | "lunch" | "training" | "admin" | null;
    registrationState:
      | "registered"
      | "unregistered"
      | "unreachable"
      | "unknown"
      | "disabled";
  }>;
  readyMembers: number;
  liveStats: {
    available: boolean;
    waitingCallers: number;
    longestWaitSeconds: number;
    averageHoldSeconds: number;
    averageTalkSeconds: number;
    completedCalls: number;
    abandonedCalls: number;
    serviceLevelPercent: number;
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type CallCentreData = {
  groups: CallGroup[];
  extensions: CallCentreExtension[];
};

type AgentAccount = {
  id: string;
  email: string;
  displayName: string;
  active: boolean;
  extensionId: string;
  extensionNumber: string;
  extensionName: string;
  queueCount: number;
  createdAt: string;
  updatedAt: string;
};

type AgentAccountData = {
  accounts: AgentAccount[];
  extensions: Array<{
    id: string;
    extensionNumber: string;
    displayName: string;
    enabled: boolean;
    agentUserId: string | null;
  }>;
};

type AgentAccountDraft = {
  id?: string;
  displayName: string;
  email: string;
  password: string;
  extensionId: string;
  active: boolean;
};

type Campaign = {
  id: string;
  name: string;
  description: string;
  status: "draft" | "ready" | "running" | "paused" | "completed" | "archived";
  dialingMode: "preview" | "progressive" | "ai";
  destinationType: "human_queue" | "ai_receptionist";
  destinationId: string;
  destinationName: string;
  sipTrunkId: string | null;
  sipTrunkName: string | null;
  outboundCallerId: string | null;
  callsPerMinute: number;
  maxConcurrentCalls: number;
  maxAttempts: number;
  retryDelayMinutes: number;
  callingWindowStart: string;
  callingWindowEnd: string;
  timezone: string;
  callingDays: number[];
  ringTimeoutSeconds: number;
  complianceAttested: boolean;
  counts: {
    total: number;
    ready: number;
    suppressed: number;
    completed: number;
    answered: number;
    active: number;
    failed: number;
  };
  createdAt: string;
  updatedAt: string;
};

type CampaignContact = {
  id: string;
  campaignId: string;
  phoneE164: string;
  firstName: string;
  lastName: string;
  externalReference: string;
  status: string;
  attemptCount: number;
  lastResult: string | null;
  createdAt: string;
};

type CampaignData = {
  campaigns: Campaign[];
  contacts: CampaignContact[];
  suppressions: Array<{
    id: string;
    phoneE164: string;
    reason: "requested" | "manual" | "regulatory";
    notes: string;
    createdAt: string;
  }>;
  options: {
    queues: Array<{ id: string; name: string; internalNumber: string }>;
    aiAgents: Array<{ id: string; name: string; internalNumber: string }>;
    trunks: Array<{ id: string; name: string }>;
  };
  dialerEnabled: boolean;
};

type CampaignDraft = {
  id?: string;
  name: string;
  description: string;
  dialingMode: "preview" | "progressive" | "ai";
  destinationType: "human_queue" | "ai_receptionist";
  destinationId: string;
  sipTrunkId: string;
  outboundCallerId: string;
  callsPerMinute: number;
  maxConcurrentCalls: number;
  maxAttempts: number;
  retryDelayMinutes: number;
  callingWindowStart: string;
  callingWindowEnd: string;
  timezone: string;
  callingDays: number[];
  ringTimeoutSeconds: number;
  complianceAttested: boolean;
};

type BillingDeck = {
  id: string;
  name: string;
  sipTrunkId: string;
  trunkName: string;
  currency: string;
  enabled: boolean;
  rateCount: number;
  createdAt: string;
  updatedAt: string;
};

type BillingRate = {
  id: string;
  rateDeckId: string;
  prefix: string;
  destinationName: string;
  costPerMinute: number;
  sellPerMinute: number;
  billingIncrementSeconds: number;
  minimumSeconds: number;
};

type CustomerRateCard = {
  id: string;
  name: string;
  currency: string;
  enabled: boolean;
  rateCount: number;
  assignedCustomerCount: number;
  createdAt: string;
  updatedAt: string;
};

type CustomerRate = {
  id: string;
  rateCardId: string;
  prefix: string;
  destinationName: string;
  pricePerMinute: number;
  billingIncrementSeconds: number;
  minimumSeconds: number;
};

type BillingData = {
  decks: BillingDeck[];
  rates: BillingRate[];
  customerRateCards: CustomerRateCard[];
  customerRates: CustomerRate[];
  charges: Array<{
    id: string;
    callStartedAt: string;
    source: string;
    destination: string;
    destinationName: string;
    trunkName: string;
    originalBillsec: number;
    chargedSeconds: number;
    costAmount: number;
    sellAmount: number;
    marginAmount: number;
    currency: string;
  }>;
  attempts: Array<{
    id: string;
    callStartedAt: string;
    source: string;
    destination: string;
    trunkName: string;
    status: "answered" | "missed" | "busy" | "failed" | "unknown";
    dialStatus: string | null;
    billingState: "rated" | "unmatched_rate" | "not_chargeable";
    billingReason: string;
    originalBillsec: number;
    chargedSeconds: number;
    costAmount: number;
    sellAmount: number;
    marginAmount: number;
    currency: string | null;
  }>;
  summaries: Array<{
    currency: string;
    todayCost: number;
    todayRevenue: number;
    todayMargin: number;
    monthCost: number;
    monthRevenue: number;
    monthMargin: number;
    ratedCalls: number;
  }>;
  rating: { scanned: number; rated: number; unmatched: number };
  trunks: Array<{ id: string; name: string; enabled: boolean }>;
};

type InvoiceSummary = {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  accountNumber: string;
  currency: string;
  billingMode: "prepaid" | "postpaid";
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  dueDate: string;
  status: "issued" | "paid";
  total: number;
  paidAmount: number;
  balanceDue: number;
  itemCount: number;
  createdAt: string;
};

type InvoiceAdminData = {
  invoices: InvoiceSummary[];
  customers: Array<{
    id: string;
    accountNumber: string;
    name: string;
    currency: string;
    billingMode: "prepaid" | "postpaid";
    active: boolean;
    uninvoicedCalls: number;
  }>;
};

type BillingDeckDraft = {
  id?: string;
  name: string;
  sipTrunkId: string;
  currency: string;
  enabled: boolean;
};

type CustomerRateCardDraft = {
  id?: string;
  name: string;
  currency: string;
  enabled: boolean;
};

type CustomerAdminData = {
  customers: Array<{
    id: string;
    accountNumber: string;
    name: string;
    billingEmail: string;
    currency: string;
    accountType: "retail" | "wholesale";
    billingMode: "prepaid" | "postpaid";
    creditLimit: number;
    active: boolean;
    balance: number;
    extensionCount: number;
    didCount: number;
    loginCount: number;
    customerRateCardId: string | null;
    customerRateCardName: string | null;
    servicePlanId: string | null;
    servicePlanName: string | null;
    extensionRangeStart: number | null;
    extensionRangeEnd: number | null;
    parentCustomerId: string | null;
    parentCustomerName: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  accounts: Array<{
    id: string;
    customerId: string;
    email: string;
    displayName: string;
    active: boolean;
    createdAt: string;
  }>;
  extensions: Array<{
    id: string;
    extensionNumber: string;
    displayName: string;
    enabled: boolean;
    customerId: string | null;
  }>;
  dids: Array<{
    id: string;
    didNumber: string;
    trunkName: string;
    enabled: boolean;
    customerId: string | null;
  }>;
  transactions: Array<{
    id: string;
    customerId: string;
    type: string;
    currency: string;
    amount: number;
    balanceAfter: number;
    note: string;
    createdAt: string;
  }>;
  rateCards: Array<{
    id: string;
    name: string;
    currency: string;
    enabled: boolean;
    rateCount: number;
  }>;
  servicePlans: Array<{
    id: string;
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
    customerCount: number;
  }>;
};

type CustomerRateCardData = {
  rateCard: {
    id: string;
    name: string;
    currency: string;
    enabled: boolean;
    updatedAt: string;
  } | null;
  rates: Array<{
    id: string;
    prefix: string;
    destinationName: string;
    ratePerMinute: number;
    billingIncrementSeconds: number;
    minimumSeconds: number;
    updatedAt: string;
  }>;
};

type CustomerRatedCallsData = {
  calls: Array<{
    id: string;
    callStartedAt: string;
    source: string;
    destination: string;
    destinationName: string;
    originalBillsec: number;
    chargedSeconds: number;
    matchedPrefix: string;
    ratePerMinute: number;
    billingIncrementSeconds: number;
    minimumSeconds: number;
    amount: number;
    currency: string;
  }>;
};

type CustomerPortalData = {
  user: User;
  branding: PortalBranding | null;
  customer: {
    id: string;
    accountNumber: string;
    name: string;
    billingEmail: string;
    currency: string;
    accountType: "retail" | "wholesale";
    billingMode: "prepaid" | "postpaid";
    creditLimit: number;
    active: boolean;
    balance: number;
  };
  entitlements: {
    servicePlanId: string | null;
    servicePlanName: string | null;
    servicePlanDescription: string | null;
    planEnabled: boolean;
    maxExtensions: number;
    maxDids: number;
    recordingStorageMb: number;
    maxAiReceptionists: number;
    maxCampaigns: number;
    selfServiceExtensions: boolean;
    recordingEnabled: boolean;
    aiReceptionistEnabled: boolean;
    campaignsEnabled: boolean;
    extensionRangeStart: number | null;
    extensionRangeEnd: number | null;
    createExtension: { allowed: boolean; reason: string; remaining: number };
    availability: {
      recording: { enabled: boolean; reason: string };
      aiReceptionist: { enabled: boolean; reason: string };
      campaigns: { enabled: boolean; reason: string };
    };
  };
  extensions: Array<{
    id: string;
    extensionNumber: string;
    displayName: string;
    enabled: boolean;
    registrationState:
      | "registered"
      | "unregistered"
      | "unreachable"
      | "unknown"
      | "disabled";
    maxContacts: number;
    ringTimeoutSeconds: number;
    voicemailEnabled: boolean;
    voicemailConfigured: boolean;
    dndEnabled: boolean;
    callWaiting: boolean;
    recordCalls: boolean;
    forwardMode: "off" | "always" | "busy" | "unavailable";
    forwardExtensionId: string | null;
    forwardExtensionNumber: string | null;
  }>;
  dids: Array<{
    id: string;
    didNumber: string;
    destinationNumber: string;
    enabled: boolean;
  }>;
  transactions: Array<{
    id: string;
    type: string;
    currency: string;
    amount: number;
    balanceAfter: number;
    note: string;
    createdAt: string;
  }>;
  usage: { today: number; month: number; ratedCalls: number };
  invoices: InvoiceSummary[];
  calls: Array<{
    id: string;
    startedAt: string;
    source: string;
    destination: string;
    direction: "internal" | "inbound" | "outbound" | "unknown";
    status: "answered" | "missed" | "busy" | "failed" | "unknown";
    durationSeconds: number;
    billableSeconds: number;
  }>;
};

type DidInventoryNumber = {
  id: string;
  didNumber: string;
  trunkId: string;
  trunkName: string;
  countryCode: string;
  region: string;
  locality: string;
  currency: string;
  setupPrice: number;
  monthlyPrice: number;
  dueToday: number;
  status: "available" | "disabled" | "assigned";
  customerId: string | null;
  customerName: string | null;
  didRouteId: string | null;
  assignedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AdminDidMarketplaceData = {
  numbers: DidInventoryNumber[];
  trunks: Array<{ id: string; name: string; enabled: boolean }>;
  summary: { available: number; assigned: number; disabled: number };
};

type CustomerMarketplaceNumber = {
  id: string;
  didNumber: string;
  countryCode: string;
  region: string;
  locality: string;
  currency: string;
  setupPrice: number;
  monthlyPrice: number;
  dueToday: number;
};

type CustomerDidMarketplaceData = {
  account: {
    currency: string;
    billingMode: "prepaid" | "postpaid";
    balance: number;
    creditLimit: number;
    availableCredit: number;
  };
  allowance: {
    maximum: number;
    assigned: number;
    delegated: number;
    used: number;
    remaining: number;
  };
  purchase: { allowed: boolean; reason: string };
  extensions: Array<{
    id: string;
    extensionNumber: string;
    displayName: string;
  }>;
  numbers: CustomerMarketplaceNumber[];
  ownedNumbers: Array<{
    purchaseId: string;
    inventoryId: string;
    didNumber: string;
    countryCode: string;
    region: string;
    locality: string;
    currency: string;
    monthlyPrice: number;
    status: "active" | "past_due";
    nextRenewalAt: string;
    destinationNumber: string | null;
    failureReason: string | null;
  }>;
};

type ResellerClientData = {
  reseller: {
    accountNumber: string;
    currency: string;
    extensionRangeStart: number;
    extensionRangeEnd: number;
  };
  capacity: {
    maxExtensions: number;
    allocatedExtensions: number;
    ownExtensions: number;
    remainingExtensions: number;
    maxDids: number;
    allocatedDids: number;
    ownDids: number;
    remainingDids: number;
    recordingStorageMb: number;
    allocatedRecordingStorageMb: number;
    remainingRecordingStorageMb: number;
  };
  clients: Array<{
    id: string;
    accountNumber: string;
    name: string;
    billingEmail: string;
    billingMode: "prepaid" | "postpaid";
    creditLimit: number;
    balance: number;
    active: boolean;
    extensionRangeStart: number;
    extensionRangeEnd: number;
    maxExtensions: number;
    maxDids: number;
    recordingStorageMb: number;
    extensionCount: number;
    didCount: number;
    loginEmail: string | null;
    createdAt: string;
  }>;
};

type ResellerClientDraft = {
  name: string;
  billingEmail: string;
  billingMode: "prepaid" | "postpaid";
  creditLimit: number;
  extensionRangeStart: number;
  extensionRangeEnd: number;
  maxExtensions: number;
  maxDids: number;
  recordingStorageMb: number;
  loginDisplayName: string;
  loginEmail: string;
  loginPassword: string;
};

type AgentWorkspaceData = {
  user: User;
  extension: {
    id: string;
    extensionNumber: string;
    displayName: string;
    registrationState:
      | "registered"
      | "unregistered"
      | "unreachable"
      | "unknown"
      | "disabled";
  };
  queues: Array<{
    id: string;
    name: string;
    internalNumber: string;
    strategy: "ringall" | "rrmemory" | "leastrecent";
    enabled: boolean;
    signedIn: boolean;
    paused: boolean;
    pauseReason: "break" | "lunch" | "training" | "admin" | null;
    ready: boolean;
    liveStats: {
      available: boolean;
      waitingCallers: number;
      longestWaitSeconds: number;
      completedCalls: number;
      abandonedCalls: number;
    };
  }>;
  activeCalls: ActiveCall[];
  today: {
    totalCalls: number;
    answeredCalls: number;
    missedCalls: number;
    talkSeconds: number;
  };
  sampledAt: string;
};

type CallGroupDraft = {
  id?: string;
  name: string;
  internalNumber: string;
  groupType: "ring_group" | "queue";
  strategy: "ringall" | "rrmemory" | "leastrecent";
  ringTimeoutSeconds: number;
  retrySeconds: number;
  maxWaitSeconds: number;
  wrapupSeconds: number;
  fallbackExtensionId: string;
  memberExtensionIds: string[];
  enabled: boolean;
};

type AiReceptionistAgent = {
  id: string;
  name: string;
  internalNumber: string;
  greetingSoundId: string;
  provider: "openai" | "google" | "elevenlabs";
  model: string;
  naturalDisclosure: boolean;
  voice: string;
  systemPrompt: string;
  knowledgeBase: string;
  handoffExtensionId: string | null;
  handoffDestinationType: "extension" | "call_group";
  handoffCallGroupId: string | null;
  maxTurns: number;
  listenTimeoutSeconds: number;
  storeTranscripts: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type AiCallSession = {
  id: string;
  agentId: string;
  agentName: string;
  callerNumber: string | null;
  status: "in_progress" | "completed" | "transferred" | "failed" | "no_input";
  turnCount: number;
  transcript: unknown;
  errorCode: string | null;
  startedAt: string;
  endedAt: string | null;
};

type AiReceptionistData = {
  agents: AiReceptionistAgent[];
  sounds: Array<{
    id: string;
    name: string;
    filename: string;
    provider: string;
    voice: string;
  }>;
  extensions: Array<{
    id: string;
    extensionNumber: string;
    displayName: string;
  }>;
  callGroups: Array<{
    id: string;
    internalNumber: string;
    name: string;
    groupType: "ring_group" | "queue";
  }>;
  providers: Array<{
    key: "openai" | "google" | "elevenlabs";
    name: string;
    configured: boolean;
    voices: ProviderVoice[];
    voiceLoadError?: string;
  }>;
  openAiConfigured: boolean;
  googleConfigured: boolean;
  elevenLabsConfigured: boolean;
  sessions: AiCallSession[];
};

type AiReceptionistDraft = {
  id?: string;
  name: string;
  internalNumber: string;
  greetingSoundId: string;
  provider: "openai" | "google" | "elevenlabs";
  voice: string;
  systemPrompt: string;
  knowledgeBase: string;
  handoffExtensionId: string;
  handoffDestinationType: "extension" | "call_group";
  handoffCallGroupId: string;
  maxTurns: number;
  listenTimeoutSeconds: number;
  storeTranscripts: boolean;
  enabled: boolean;
};

type CallHistory = {
  calls: CallRecord[];
  total: number;
  limit: number;
  offset: number;
  summary: {
    total: number;
    answered: number;
    missed: number;
    busy: number;
    failed: number;
    billableSeconds: number;
  };
};

type PayPalCheckoutConfig = {
  available: boolean;
  reason: string;
  mode: "sandbox" | "live";
  clientId: string | null;
  currency: string;
  minimumTopup: number;
  maximumTopup: number;
};

type PayPalGatewaySettings = {
  mode: "sandbox";
  clientId: string;
  secretConfigured: boolean;
  configured: boolean;
  source: "gui" | "environment" | "unconfigured";
  minimumTopup: number;
  maximumTopup: number;
};

type PayPalCheckoutOrder = {
  checkoutId: string;
  orderId: string;
  amount: number;
  currency: string;
  mode: "sandbox" | "live";
};

type PayPalButtons = {
  render: (container: HTMLElement) => Promise<void> | void;
  close?: () => Promise<void> | void;
};

type PayPalSdk = {
  Buttons: (options: {
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID?: string }) => Promise<void>;
    onCancel?: () => void;
    onError?: (error: unknown) => void;
    style?: { layout?: "vertical"; color?: "gold" | "blue" | "silver" | "black" | "white"; shape?: "rect" | "pill"; label?: "paypal" | "checkout" | "pay" | "buynow" };
  }) => PayPalButtons;
};

declare global {
  interface Window {
    paypal?: PayPalSdk;
  }
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers,
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok)
    throw new Error(body.error ?? `Request failed (${response.status})`);
  return body as T;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 GB";
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function formatFileSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
  if (value < 1024 ** 2) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  return days > 0
    ? `${days}d ${hours}h`
    : `${hours}h ${Math.floor((seconds % 3_600) / 60)}m`;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(Number.isFinite(value) ? value : 0);
  } catch {
    return `${currency} ${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
  }
}

function formatCallTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

function brandingStyle(branding?: PortalBranding | null): CSSProperties {
  if (!branding) return {};
  return {
    "--orange": branding.accentColor,
    "--orange-soft": `${branding.accentColor}21`,
    "--brand-primary": branding.primaryColor,
    "--brand-accent": branding.accentColor,
  } as CSSProperties;
}

function applyBrowserBrand(branding: PortalBranding | null): void {
  document.title = branding
    ? `${branding.brandName} · ${branding.portalTitle}`
    : "Netbrowse Voice";
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content", branding?.primaryColor ?? "#07111f",
  );
  let icon = document.querySelector<HTMLLinkElement>('link[data-tenant-favicon="true"]');
  if (!branding?.logoUrl) {
    icon?.remove();
    return;
  }
  if (!icon) {
    icon = document.createElement("link");
    icon.rel = "icon";
    icon.dataset.tenantFavicon = "true";
    document.head.append(icon);
  }
  icon.href = branding.logoUrl;
}

function Brand({ branding }: { branding?: PortalBranding | null }) {
  return (
    <div className={`brand ${branding ? "tenant-brand" : ""}`}>
      {branding?.logoUrl ? (
        <div className="brand-logo"><img src={branding.logoUrl} alt="" /></div>
      ) : (
        <div className="brand-mark" aria-hidden="true">
          {branding ? <b>{branding.brandName.slice(0, 1).toUpperCase()}</b> : <><span /><span /><span /></>}
        </div>
      )}
      <div>
        <strong>{branding?.brandName ?? "NETBROWSE"}</strong>
        <small>{branding ? "VOICE PORTAL" : "VOICE"}</small>
      </div>
    </div>
  );
}

function AuthShell({
  mode,
  onSuccess,
  branding,
  brandSlug,
}: {
  mode: "setup" | "login";
  onSuccess: () => Promise<void>;
  branding?: PortalBranding | null;
  brandSlug?: string;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api(mode === "setup" ? "/api/setup/admin" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ displayName, email, password, brandSlug }),
      });
      await onSuccess();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Request failed",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={`auth-page ${branding ? "branded-auth-page" : ""}`} style={brandingStyle(branding)}>
      <section className="auth-visual">
        <Brand branding={branding} />
        <div className="visual-copy">
          <span className="eyebrow">{branding ? "PRIVATE CUSTOMER ACCESS" : "INTELLIGENT COMMUNICATIONS"}</span>
          <h1>
            {branding ? branding.portalTitle : <>One system.<br />Every call.</>}
          </h1>
          <p>
            {branding
              ? `Sign in to manage your communications services provided by ${branding.brandName}.`
              : "A modern modular PBX with live operations, AI voice, campaigns and billing built into one control plane."}
          </p>
        </div>
        <div className="signal-art" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="mobile-brand">
            <Brand branding={branding} />
          </div>
          <span className="step-label">
            {mode === "setup" ? "INITIAL SETUP" : branding?.brandName.toUpperCase() ?? "SECURE ACCESS"}
          </span>
          <h2>
            {mode === "setup" ? "Create the owner account" : "Welcome back"}
          </h2>
          <p className="form-intro">
            {mode === "setup"
              ? "No default login exists. This account will control the first Netbrowse Voice server."
              : "Sign in to open the workspace assigned to your account."}
          </p>

          {mode === "setup" && (
            <label>
              <span>Administrator name</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                minLength={2}
                required
                placeholder="Michael Masanga"
              />
            </label>
          )}
          <label>
            <span>Email address</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              placeholder="admin@example.com"
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={
                mode === "setup" ? "new-password" : "current-password"
              }
              minLength={mode === "setup" ? 12 : undefined}
              required
              placeholder={
                mode === "setup" ? "At least 12 characters" : "Your password"
              }
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="primary-button" disabled={submitting}>
            {submitting
              ? "Please wait…"
              : mode === "setup"
                ? "Create owner account"
                : "Sign in"}
          </button>
          <small className="security-note">
            {branding
              ? `Secure access provided by ${branding.brandName}.`
              : "Administrator, agent and customer sessions are routed to separate authorised workspaces."}
          </small>
          {branding && (branding.supportEmail || branding.supportPhone || branding.websiteUrl) && (
            <div className="branded-support">
              <span>Need help?</span>
              {branding.supportEmail && <a href={`mailto:${branding.supportEmail}`}>{branding.supportEmail}</a>}
              {branding.supportPhone && <a href={`tel:${branding.supportPhone}`}>{branding.supportPhone}</a>}
              {branding.websiteUrl && <a href={branding.websiteUrl} target="_blank" rel="noreferrer">Support website</a>}
            </div>
          )}
        </form>
      </section>
    </main>
  );
}

type PageKey =
  | "overview"
  | "pbx"
  | "live"
  | "recordings"
  | "studio"
  | "ivr"
  | "ai"
  | "callcentre"
  | "campaigns"
  | "customers"
  | "didstore"
  | "billing"
  | "modules";

const navigation: { key: PageKey; label: string; planned?: boolean }[] = [
  { key: "overview", label: "Overview" },
  { key: "pbx", label: "PBX Core" },
  { key: "live", label: "Live Calls" },
  { key: "recordings", label: "Recordings" },
  { key: "studio", label: "Sound Studio" },
  { key: "ivr", label: "IVR Builder" },
  { key: "ai", label: "AI Receptionist" },
  { key: "callcentre", label: "Call Centre" },
  { key: "campaigns", label: "Campaigns" },
  { key: "customers", label: "Customers" },
  { key: "didstore", label: "DID Store" },
  { key: "billing", label: "Billing" },
  { key: "modules", label: "Modules" },
];

const pageTitles: Record<PageKey, string> = {
  overview: "Communications overview",
  pbx: "PBX core",
  live: "Live calls",
  recordings: "Call recordings",
  studio: "Sound studio",
  ivr: "Announcement and IVR builder",
  ai: "AI receptionist",
  callcentre: "Call centre core",
  campaigns: "Outbound campaigns",
  customers: "Customer accounts",
  didstore: "DID inventory and marketplace",
  billing: "Billing",
  modules: "Product modules",
};

const pageRoutes: Record<PageKey, string> = {
  overview: "/",
  pbx: "/pbx",
  live: "/live-calls",
  recordings: "/recordings",
  studio: "/sound-studio",
  ivr: "/ivr",
  ai: "/ai-receptionist",
  callcentre: "/call-centre",
  campaigns: "/campaigns",
  customers: "/customers",
  didstore: "/did-store",
  billing: "/billing",
  modules: "/modules",
};

function pageFromPath(pathname: string): PageKey {
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (
    (Object.entries(pageRoutes).find(
      ([, route]) => route === normalized,
    )?.[0] as PageKey | undefined) ?? "overview"
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span>PBX CORE</span>
            <h2>{title}</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function CredentialModal({
  credentials,
  onClose,
}: {
  credentials: SipCredentials;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState("");
  const server = window.location.hostname;
  async function copy(label: string, value: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const field = document.createElement("textarea");
      field.value = value;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1400);
  }
  const rows = [
    ["Server", server],
    ["Username", credentials.username],
    ["SIP password", credentials.password],
    ["Port", String(credentials.port)],
    ["Transport", credentials.transport],
  ];
  return (
    <Modal title="Extension credentials" onClose={onClose}>
      <div className="notice warning">
        <strong>Save this password now.</strong>
        <span>
          For security, it will not be displayed again. Resetting it will create
          a new password.
        </span>
      </div>
      <div className="credential-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <code>{value}</code>
            <button type="button" onClick={() => void copy(label, value)}>
              {copied === label ? "Copied" : "Copy"}
            </button>
          </div>
        ))}
      </div>
      <button className="primary-button" type="button" onClick={onClose}>
        I have saved the credentials
      </button>
    </Modal>
  );
}

function CreateExtensionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (credentials: SipCredentials) => Promise<void>;
}) {
  const [extensionNumber, setExtensionNumber] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [maxContacts, setMaxContacts] = useState(1);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const result = await api<{
        extension: Extension;
        credentials: SipCredentials;
      }>("/api/pbx/extensions", {
        method: "POST",
        body: JSON.stringify({ extensionNumber, displayName, maxContacts }),
      });
      await onCreated(result.credentials);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Extension creation failed",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Create extension" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <label>
          <span>Extension number</span>
          <input
            inputMode="numeric"
            pattern="[0-9]{2,8}"
            value={extensionNumber}
            onChange={(event) => setExtensionNumber(event.target.value)}
            placeholder="1001"
            required
            autoFocus
          />
          <small>2–8 digits. This becomes the SIP username.</small>
        </label>
        <label>
          <span>Display name</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            minLength={2}
            maxLength={80}
            placeholder="Reception"
            required
          />
        </label>
        <label>
          <span>Maximum registered devices</span>
          <select
            value={maxContacts}
            onChange={(event) => setMaxContacts(Number(event.target.value))}
          >
            {[1, 2, 3, 4, 5].map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
          <small>One device is recommended for each person.</small>
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button compact" disabled={submitting}>
            {submitting ? "Provisioning…" : "Create extension"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ExtensionServicesModal({
  extension,
  extensions,
  onClose,
  onSaved,
}: {
  extension: Extension;
  extensions: Extension[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [ringTimeoutSeconds, setRingTimeoutSeconds] = useState(
    extension.ringTimeoutSeconds,
  );
  const [voicemailEnabled, setVoicemailEnabled] = useState(
    extension.voicemailEnabled,
  );
  const [voicemailPin, setVoicemailPin] = useState("");
  const [dndEnabled, setDndEnabled] = useState(extension.dndEnabled);
  const [callWaiting, setCallWaiting] = useState(extension.callWaiting);
  const [recordCalls, setRecordCalls] = useState(extension.recordCalls);
  const [pickupGroup, setPickupGroup] = useState(
    extension.pickupGroup === null ? "" : String(extension.pickupGroup),
  );
  const [forwardMode, setForwardMode] = useState(extension.forwardMode);
  const [forwardExtensionId, setForwardExtensionId] = useState(
    extension.forwardExtensionId ?? "",
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api(`/api/pbx/extensions/${extension.id}/services`, {
        method: "PATCH",
        body: JSON.stringify({
          ringTimeoutSeconds,
          voicemailEnabled,
          voicemailPin: voicemailPin || undefined,
          dndEnabled,
          callWaiting,
          recordCalls,
          pickupGroup: pickupGroup === "" ? null : Number(pickupGroup),
          forwardMode,
          forwardExtensionId: forwardMode === "off" ? null : forwardExtensionId,
        }),
      });
      await onSaved();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not save extension services",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const forwardingOptions = extensions.filter(
    (item) => item.id !== extension.id && item.enabled,
  );
  return (
    <Modal
      title={`Extension ${extension.extensionNumber} services`}
      onClose={onClose}
    >
      <form className="modal-form services-form" onSubmit={submit}>
        <div className="form-section">
          <span>CALL HANDLING</span>
          <p>Control ringing, availability and internal forwarding.</p>
        </div>
        <label>
          <span>Ring timeout</span>
          <input
            type="number"
            min={5}
            max={120}
            value={ringTimeoutSeconds}
            onChange={(event) =>
              setRingTimeoutSeconds(Number(event.target.value))
            }
            required
          />
          <small>Seconds before the call uses the unavailable action.</small>
        </label>
        <label className="toggle-field">
          <input
            type="checkbox"
            checked={dndEnabled}
            onChange={(event) => setDndEnabled(event.target.checked)}
          />
          <span>
            <strong>Do not disturb</strong>
            <small>Send new calls directly to the unavailable action.</small>
          </span>
        </label>
        <label className="toggle-field">
          <input
            type="checkbox"
            checked={callWaiting}
            onChange={(event) => setCallWaiting(event.target.checked)}
          />
          <span>
            <strong>Call waiting</strong>
            <small>
              Allow another call while this extension is already busy.
            </small>
          </span>
        </label>
        <label>
          <span>Pickup group</span>
          <input
            type="number"
            min={0}
            max={63}
            value={pickupGroup}
            onChange={(event) => setPickupGroup(event.target.value)}
            placeholder="No group"
          />
          <small>
            Extensions in the same group can be configured for call pickup.
          </small>
        </label>
        <div className="form-grid">
          <label>
            <span>Forward calls</span>
            <select
              value={forwardMode}
              onChange={(event) =>
                setForwardMode(event.target.value as Extension["forwardMode"])
              }
            >
              <option value="off">Off</option>
              <option value="always">Always</option>
              <option value="unavailable">Unavailable / no answer</option>
              <option value="busy">When busy</option>
            </select>
          </label>
          <label>
            <span>Destination</span>
            <select
              value={forwardExtensionId}
              onChange={(event) => setForwardExtensionId(event.target.value)}
              disabled={forwardMode === "off"}
              required={forwardMode !== "off"}
            >
              <option value="">Choose extension</option>
              {forwardingOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.extensionNumber} · {item.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-section">
          <span>VOICEMAIL</span>
          <p>
            Messages are stored locally by Asterisk and the mailbox PIN is
            encrypted at rest.
          </p>
        </div>
        <label className="toggle-field">
          <input
            type="checkbox"
            checked={voicemailEnabled}
            onChange={(event) => setVoicemailEnabled(event.target.checked)}
          />
          <span>
            <strong>Enable mailbox</strong>
            <small>
              Use *97 from this extension or *98 to choose a mailbox.
            </small>
          </span>
        </label>
        {voicemailEnabled && (
          <label>
            <span>
              {extension.voicemailConfigured
                ? "Change voicemail PIN"
                : "Voicemail PIN"}
            </span>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4,10}"
              minLength={4}
              maxLength={10}
              value={voicemailPin}
              onChange={(event) => setVoicemailPin(event.target.value)}
              required={!extension.voicemailConfigured}
              placeholder={
                extension.voicemailConfigured
                  ? "Leave blank to keep current PIN"
                  : "4–10 digits"
              }
              autoComplete="new-password"
            />
            <small>
              {extension.voicemailConfigured
                ? "The existing PIN remains active if this is blank."
                : "Required before voicemail can be enabled."}
            </small>
          </label>
        )}
        <div className="form-section">
          <span>CALL RECORDING</span>
          <p>
            Store bridged conversations as local WAV files linked to call
            history.
          </p>
        </div>
        <div className="notice warning">
          <strong>Recording is disabled by default.</strong>
          <span>
            Enable it only when your organisation has the required notice,
            consent and retention policy.
          </span>
        </div>
        <label className="toggle-field">
          <input
            type="checkbox"
            checked={recordCalls}
            onChange={(event) => setRecordCalls(event.target.checked)}
          />
          <span>
            <strong>Automatically record calls to this extension</strong>
            <small>
              Only connected audio is retained; voicemail messages remain
              separate.
            </small>
          </span>
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button compact" disabled={submitting}>
            {submitting ? "Applying…" : "Save services"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TrunkModal({
  trunk,
  onClose,
  onSaved,
}: {
  trunk?: SipTrunk;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(trunk?.name ?? "");
  const [authMode, setAuthMode] = useState<SipTrunk["authMode"]>(
    trunk?.authMode ?? "registration",
  );
  const [providerHost, setProviderHost] = useState(trunk?.providerHost ?? "");
  const [providerPort, setProviderPort] = useState(trunk?.providerPort ?? 5060);
  const [transport, setTransport] = useState<SipTrunk["transport"]>(
    trunk?.transport ?? "udp",
  );
  const [username, setUsername] = useState(trunk?.username ?? "");
  const [password, setPassword] = useState("");
  const [registrationUsername, setRegistrationUsername] = useState(
    trunk?.registrationUsername ?? "",
  );
  const [registrationContactUser, setRegistrationContactUser] = useState(
    trunk?.registrationContactUser ?? "",
  );
  const [fromUser, setFromUser] = useState(trunk?.fromUser ?? "");
  const [fromDomain, setFromDomain] = useState(trunk?.fromDomain ?? "");
  const [inboundMatch, setInboundMatch] = useState(trunk?.inboundMatch ?? "");
  const [dialPrefix, setDialPrefix] = useState(trunk?.dialPrefix ?? "");
  const [stripPlus, setStripPlus] = useState(trunk?.stripPlus ?? true);
  const [enabled, setEnabled] = useState(trunk?.enabled ?? true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api(trunk ? `/api/pbx/trunks/${trunk.id}` : "/api/pbx/trunks", {
        method: trunk ? "PATCH" : "POST",
        body: JSON.stringify({
          name,
          authMode,
          providerHost,
          providerPort,
          transport,
          username: authMode !== "ip" ? username : undefined,
          password: password || undefined,
          registrationUsername:
            authMode === "registration" ? registrationUsername || null : null,
          registrationContactUser:
            authMode === "registration" ? registrationContactUser || null : null,
          fromUser: fromUser || null,
          fromDomain: fromDomain || null,
          inboundMatch: inboundMatch || null,
          dialPrefix,
          stripPlus,
          enabled,
        }),
      });
      await onSaved();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not save SIP trunk",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={trunk ? `Edit ${trunk.name}` : "Add SIP trunk"}
      onClose={onClose}
    >
      <form className="modal-form services-form" onSubmit={submit}>
        <div className="form-section">
          <span>PROVIDER</span>
          <p>
            Connect an ITSP or another PBX using registration or trusted source
            IP authentication.
          </p>
        </div>
        <label>
          <span>Trunk name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={2}
            maxLength={80}
            placeholder="Primary voice provider"
            required
            autoFocus
          />
        </label>
        <div className="form-grid">
          <label>
            <span>Authentication</span>
            <select
              value={authMode}
              onChange={(event) =>
                setAuthMode(event.target.value as SipTrunk["authMode"])
              }
            >
              <option value="registration">Credentials + registration</option>
              <option value="credentials">Credentials · no registration</option>
              <option value="ip">IP authentication · no credentials</option>
            </select>
          </label>
          <label>
            <span>SIP transport</span>
            <select
              value={transport}
              onChange={(event) =>
                setTransport(event.target.value as SipTrunk["transport"])
              }
            >
              <option value="udp">UDP</option>
              <option value="tcp">TCP</option>
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label>
            <span>Provider host</span>
            <input
              value={providerHost}
              onChange={(event) => setProviderHost(event.target.value)}
              maxLength={253}
              placeholder="sip.provider.example"
              required
            />
            <small>
              Registrar or SIP proxy hostname without sip: or a port.
            </small>
          </label>
          <label>
            <span>Provider port</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={providerPort}
              onChange={(event) => setProviderPort(Number(event.target.value))}
              required
            />
          </label>
        </div>
        {authMode !== "ip" && (
          <>
            <label>
              <span>Provider username</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                maxLength={128}
                placeholder="Account number or username"
                required
              />
            </label>
            <label>
              <span>
                {trunk?.passwordConfigured
                  ? "Change provider password"
                  : "Provider password"}
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                maxLength={128}
                required={!trunk?.passwordConfigured}
                placeholder={
                  trunk?.passwordConfigured
                    ? "Leave blank to retain the encrypted password"
                    : "Provider-issued password"
                }
                autoComplete="new-password"
              />
            </label>
          </>
        )}
        {authMode === "registration" && (
          <>
            <label>
              <span>Registration/AOR username</span>
              <input
                value={registrationUsername}
                onChange={(event) => setRegistrationUsername(event.target.value)}
                maxLength={128}
                placeholder="Defaults to provider username"
              />
              <small>
                Set this only when the REGISTER address-of-record differs from the
                authentication username.
              </small>
            </label>
            <label>
              <span>Registration Contact user</span>
              <input
                value={registrationContactUser}
                onChange={(event) => setRegistrationContactUser(event.target.value)}
                maxLength={128}
                placeholder="Optional provider-specific Contact username"
              />
              <small>
                Use this when a provider requires a fixed SIP Contact username.
                Callcentric requires the full account number here.
              </small>
            </label>
          </>
        )}
        {authMode === "credentials" && (
          <div className="notice">
            <strong>No REGISTER will be sent.</strong>
            <span>
              Use this for providers that challenge outbound calls with digest
              credentials but do not require registration.
            </span>
          </div>
        )}
        <div className="form-section">
          <span>INTEROPERABILITY</span>
          <p>
            Optional SIP identity and inbound network settings supplied by the
            provider.
          </p>
        </div>
        <div className="form-grid">
          <label>
            <span>SIP From user</span>
            <input
              value={fromUser}
              onChange={(event) => setFromUser(event.target.value)}
              maxLength={128}
              placeholder="Optional provider override"
            />
          </label>
          <label>
            <span>SIP From domain</span>
            <input
              value={fromDomain}
              onChange={(event) => setFromDomain(event.target.value)}
              maxLength={253}
              placeholder="voice.provider.example"
            />
          </label>
        </div>
        <label>
          <span>Inbound source IPs or CIDR networks</span>
          <textarea
            value={inboundMatch}
            onChange={(event) => setInboundMatch(event.target.value)}
            rows={2}
            placeholder="192.0.2.10, 198.51.100.0/24"
          />
          <small>
            Separate up to 16 trusted provider addresses with commas or spaces.
            Leave blank for an outbound-only trunk.
          </small>
        </label>
        <div className="form-section">
          <span>OUTBOUND NUMBER FORMAT</span>
          <p>
            Prepare E.164 campaign numbers in the exact format expected by this
            provider.
          </p>
        </div>
        <label className="toggle-field">
          <input
            type="checkbox"
            checked={stripPlus}
            onChange={(event) => setStripPlus(event.target.checked)}
          />
          <span>
            <strong>Remove leading + from E.164 numbers</strong>
            <small>
              Most wholesale carriers expect country code and number as digits
              only.
            </small>
          </span>
        </label>
        <label>
          <span>Carrier dial prefix</span>
          <input
            value={dialPrefix}
            onChange={(event) => setDialPrefix(event.target.value)}
            inputMode="numeric"
            pattern="[0-9]{0,20}"
            maxLength={20}
            placeholder="Optional route or technology prefix"
          />
          <small>
            Leave blank unless your provider specifies a route prefix. It is
            added immediately before the destination.
          </small>
        </label>
        <label className="toggle-field">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span>
            <strong>Enable trunk</strong>
            <small>
              Disabled trunks remain saved but are removed from Asterisk.
            </small>
          </span>
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button compact" disabled={submitting}>
            {submitting ? "Applying…" : trunk ? "Save trunk" : "Add trunk"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DidRouteModal({
  trunks,
  extensions,
  ivrs,
  route,
  onClose,
  onSaved,
}: {
  trunks: SipTrunk[];
  extensions: Extension[];
  ivrs: IvrMenu[];
  route?: DidRoute;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const activeTrunks = trunks.filter((item) => item.enabled);
  const activeExtensions = extensions.filter((item) => item.enabled);
  const activeIvrs = ivrs.filter((item) => item.enabled);
  const [didNumber, setDidNumber] = useState(route?.didNumber ?? "");
  const [trunkId, setTrunkId] = useState(
    route?.trunkId ?? activeTrunks[0]?.id ?? "",
  );
  const [destinationType, setDestinationType] = useState<"extension" | "ivr">(
    route?.destinationType ??
      (activeExtensions.length > 0 ? "extension" : "ivr"),
  );
  const [destinationId, setDestinationId] = useState(
    route?.destinationId ?? activeExtensions[0]?.id ?? activeIvrs[0]?.id ?? "",
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function changeDestinationType(value: "extension" | "ivr") {
    setDestinationType(value);
    setDestinationId(
      value === "ivr"
        ? (activeIvrs[0]?.id ?? "")
        : (activeExtensions[0]?.id ?? ""),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api(route ? `/api/pbx/dids/${route.id}` : "/api/pbx/dids", {
        method: route ? "PATCH" : "POST",
        body: JSON.stringify({
          didNumber,
          trunkId,
          destinationType,
          destinationId,
        }),
      });
      await onSaved();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not add DID route",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={route ? "Edit inbound DID route" : "Add inbound DID route"}
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={submit}>
        <div className="notice warning">
          <strong>Use the number exactly as your provider sends it.</strong>
          <span>
            For example, +27115550100 and 27115550100 are different inbound
            dialled numbers.
          </span>
        </div>
        <label>
          <span>Inbound number (DID)</span>
          <input
            value={didNumber}
            onChange={(event) => setDidNumber(event.target.value)}
            pattern="\+?[0-9]{3,20}"
            placeholder="+27115550100"
            required
            autoFocus
          />
        </label>
        <label>
          <span>Receiving SIP trunk</span>
          <select
            value={trunkId}
            onChange={(event) => setTrunkId(event.target.value)}
            required
          >
            <option value="">Choose trunk</option>
            {activeTrunks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            <span>Destination type</span>
            <select
              value={destinationType}
              onChange={(event) =>
                changeDestinationType(event.target.value as "extension" | "ivr")
              }
            >
              <option
                value="extension"
                disabled={activeExtensions.length === 0}
              >
                Extension
              </option>
              <option value="ivr" disabled={activeIvrs.length === 0}>
                IVR menu
              </option>
            </select>
          </label>
          <label>
            <span>
              {destinationType === "ivr"
                ? "Destination IVR"
                : "Destination extension"}
            </span>
            <select
              value={destinationId}
              onChange={(event) => setDestinationId(event.target.value)}
              required
            >
              <option value="">Choose destination</option>
              {destinationType === "ivr"
                ? activeIvrs.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.internalNumber} · {item.name}
                    </option>
                  ))
                : activeExtensions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.extensionNumber} · {item.displayName}
                    </option>
                  ))}
            </select>
          </label>
        </div>
        <div className="notice">
          <strong>
            {destinationType === "ivr"
              ? "Calls enter the selected IVR immediately."
              : "Calls use the extension's normal services."}
          </strong>
          <span>
            {destinationType === "ivr"
              ? "The greeting, keypad options, timeout and fallback come from IVR Builder."
              : "Ringing, forwarding, recording and voicemail remain controlled by the extension."}
          </span>
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button compact"
            disabled={submitting || !trunkId || !destinationId}
          >
            {submitting
              ? "Applying…"
              : route
                ? "Save DID route"
                : "Add DID route"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function OutboundRouteModal({
  route,
  trunks,
  onClose,
  onSaved,
}: {
  route?: OutboundRoute;
  trunks: SipTrunk[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const activeTrunks = trunks.filter((item) => item.enabled);
  const [name, setName] = useState(route?.name ?? "");
  const [sipTrunkId, setSipTrunkId] = useState(
    route?.sipTrunkId ?? activeTrunks[0]?.id ?? "",
  );
  const [accessPrefix, setAccessPrefix] = useState(route?.accessPrefix ?? "9");
  const [outboundCallerId, setOutboundCallerId] = useState(
    route?.outboundCallerId ?? "",
  );
  const [ringTimeoutSeconds, setRingTimeoutSeconds] = useState(
    route?.ringTimeoutSeconds ?? 60,
  );
  const [enabled, setEnabled] = useState(route?.enabled ?? true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const selectedTrunk = activeTrunks.find((item) => item.id === sipTrunkId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api(
        route
          ? `/api/pbx/outbound-routes/${route.id}`
          : "/api/pbx/outbound-routes",
        {
          method: route ? "PATCH" : "POST",
          body: JSON.stringify({
            name,
            sipTrunkId,
            accessPrefix,
            outboundCallerId: outboundCallerId || null,
            ringTimeoutSeconds,
            enabled,
          }),
        },
      );
      await onSaved();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not save outbound route",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={route ? `Edit ${route.name}` : "Add outbound route"}
      onClose={onClose}
    >
      <form className="modal-form services-form" onSubmit={submit}>
        <div className="notice warning">
          <strong>Only authorized numbers and caller IDs may be used.</strong>
          <span>
            This route will be available to every registered PBX extension. Test
            it first with a destination number you own or control.
          </span>
        </div>
        <label>
          <span>Route name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={2}
            maxLength={80}
            placeholder="Voxbeam outbound"
            required
            autoFocus
          />
        </label>
        <label>
          <span>Outbound SIP trunk</span>
          <select
            value={sipTrunkId}
            onChange={(event) => setSipTrunkId(event.target.value)}
            required
          >
            <option value="">Choose trunk</option>
            {activeTrunks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            <span>Extension access prefix</span>
            <input
              value={accessPrefix}
              onChange={(event) => setAccessPrefix(event.target.value)}
              inputMode="numeric"
              pattern="[0-9]{1,4}"
              minLength={1}
              maxLength={4}
              required
            />
            <small>
              Extensions dial this first. Example: prefix 9 followed by country
              code and number.
            </small>
          </label>
          <label>
            <span>Ring timeout</span>
            <input
              type="number"
              min={10}
              max={120}
              value={ringTimeoutSeconds}
              onChange={(event) =>
                setRingTimeoutSeconds(Number(event.target.value))
              }
              required
            />
          </label>
        </div>
        <label>
          <span>Authorized outbound caller ID</span>
          <input
            value={outboundCallerId}
            onChange={(event) => setOutboundCallerId(event.target.value)}
            pattern="\+[1-9][0-9]{7,14}"
            placeholder="Optional · +27115550100"
          />
          <small>
            Leave blank to use the provider account default. Enter only a number
            your provider has authorized.
          </small>
        </label>
        <div className="notice">
          <strong>Dialling example</strong>
          <span>
            With access prefix {accessPrefix || "9"}, call a South African
            number by dialling {accessPrefix || "9"}27 followed by the national
            number without its leading zero.{" "}
            {selectedTrunk?.dialPrefix
              ? `The trunk then adds carrier prefix ${selectedTrunk.dialPrefix}.`
              : "The trunk sends the international country code and number."}
          </span>
        </div>
        <label className="toggle-field">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span>
            <strong>Enable outbound route</strong>
            <small>
              Disabling removes the access-code patterns from Asterisk while
              retaining the route.
            </small>
          </span>
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button compact"
            disabled={submitting || !sipTrunkId}
          >
            {submitting ? "Applying…" : route ? "Save route" : "Add route"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PbxCore({
  initialCount,
  initialTrunkCount,
  initialDidCount,
  onCountsChange,
}: {
  initialCount: number;
  initialTrunkCount: number;
  initialDidCount: number;
  onCountsChange: (extensions: number, trunks: number, dids: number) => void;
}) {
  const [section, setSection] = useState<
    "extensions" | "trunks" | "dids" | "outbound"
  >("extensions");
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [trunks, setTrunks] = useState<SipTrunk[]>([]);
  const [didRoutes, setDidRoutes] = useState<DidRoute[]>([]);
  const [outboundRoutes, setOutboundRoutes] = useState<OutboundRoute[]>([]);
  const [ivrs, setIvrs] = useState<IvrMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creatingExtension, setCreatingExtension] = useState(false);
  const [creatingTrunk, setCreatingTrunk] = useState(false);
  const [creatingDid, setCreatingDid] = useState(false);
  const [creatingOutboundRoute, setCreatingOutboundRoute] = useState(false);
  const [editingDid, setEditingDid] = useState<DidRoute | null>(null);
  const [editingOutboundRoute, setEditingOutboundRoute] =
    useState<OutboundRoute | null>(null);
  const [credentials, setCredentials] = useState<SipCredentials | null>(null);
  const [editingExtension, setEditingExtension] = useState<Extension | null>(
    null,
  );
  const [editingTrunk, setEditingTrunk] = useState<SipTrunk | null>(null);
  const [busyId, setBusyId] = useState("");

  async function loadAll(silent = false) {
    if (!silent) setError("");
    try {
      const [
        extensionResult,
        trunkResult,
        didResult,
        outboundResult,
        ivrResult,
      ] = await Promise.all([
        api<{ extensions: Extension[] }>("/api/pbx/extensions"),
        api<{ trunks: SipTrunk[] }>("/api/pbx/trunks"),
        api<{ didRoutes: DidRoute[] }>("/api/pbx/dids"),
        api<{ outboundRoutes: OutboundRoute[] }>("/api/pbx/outbound-routes"),
        api<IvrData>("/api/ivrs"),
      ]);
      setExtensions(extensionResult.extensions);
      setTrunks(trunkResult.trunks);
      setDidRoutes(didResult.didRoutes);
      setOutboundRoutes(outboundResult.outboundRoutes);
      setIvrs(ivrResult.ivrs);
      onCountsChange(
        extensionResult.extensions.length,
        trunkResult.trunks.length,
        didResult.didRoutes.length,
      );
    } catch (loadError) {
      if (!silent)
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load PBX configuration",
        );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    const refresh = window.setInterval(() => void loadAll(true), 10_000);
    return () => window.clearInterval(refresh);
  }, []);

  async function extensionCreated(newCredentials: SipCredentials) {
    setCreatingExtension(false);
    await loadAll();
    setCredentials(newCredentials);
  }

  async function resetSecret(extension: Extension) {
    if (
      !window.confirm(
        `Reset the SIP password for extension ${extension.extensionNumber}? Its current device will stop registering.`,
      )
    )
      return;
    setBusyId(extension.id);
    setError("");
    try {
      const result = await api<{ credentials: SipCredentials }>(
        `/api/pbx/extensions/${extension.id}/reset-secret`,
        { method: "POST", body: "{}" },
      );
      setCredentials(result.credentials);
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "Could not reset credentials",
      );
    } finally {
      setBusyId("");
    }
  }

  async function removeExtension(extension: Extension) {
    if (
      !window.confirm(
        `Delete extension ${extension.extensionNumber} (${extension.displayName})?`,
      )
    )
      return;
    setBusyId(extension.id);
    setError("");
    try {
      await api(`/api/pbx/extensions/${extension.id}`, { method: "DELETE" });
      await loadAll();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete extension",
      );
    } finally {
      setBusyId("");
    }
  }

  async function removeTrunk(trunk: SipTrunk) {
    if (!window.confirm(`Delete SIP trunk ${trunk.name}?`)) return;
    setBusyId(trunk.id);
    setError("");
    try {
      await api(`/api/pbx/trunks/${trunk.id}`, { method: "DELETE" });
      await loadAll();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete SIP trunk",
      );
    } finally {
      setBusyId("");
    }
  }

  async function removeDid(route: DidRoute) {
    if (!window.confirm(`Delete the inbound route for ${route.didNumber}?`))
      return;
    setBusyId(route.id);
    setError("");
    try {
      await api(`/api/pbx/dids/${route.id}`, { method: "DELETE" });
      await loadAll();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete DID route",
      );
    } finally {
      setBusyId("");
    }
  }

  async function removeOutboundRoute(route: OutboundRoute) {
    if (!window.confirm(`Delete outbound route ${route.name}?`)) return;
    setBusyId(route.id);
    setError("");
    try {
      await api(`/api/pbx/outbound-routes/${route.id}`, { method: "DELETE" });
      await loadAll();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete outbound route",
      );
    } finally {
      setBusyId("");
    }
  }

  function openDidModal() {
    setError("");
    if (loading) {
      setError("PBX configuration is still loading. Try again in a moment.");
      return;
    }
    if (!trunks.some((item) => item.enabled)) {
      setSection("trunks");
      setError(
        "Add or enable a SIP trunk before creating an inbound DID route.",
      );
      return;
    }
    if (
      !extensions.some((item) => item.enabled) &&
      !ivrs.some((item) => item.enabled)
    ) {
      setSection("extensions");
      setError(
        "Create or enable a destination extension or IVR before creating an inbound DID route.",
      );
      return;
    }
    setCreatingDid(true);
  }

  function openOutboundRouteModal() {
    setError("");
    if (loading) {
      setError("PBX configuration is still loading. Try again in a moment.");
      return;
    }
    if (!trunks.some((item) => item.enabled)) {
      setSection("trunks");
      setError("Add or enable a SIP trunk before creating an outbound route.");
      return;
    }
    setCreatingOutboundRoute(true);
  }

  async function modalSaved() {
    setEditingExtension(null);
    setEditingTrunk(null);
    setEditingDid(null);
    setEditingOutboundRoute(null);
    setCreatingTrunk(false);
    setCreatingDid(false);
    setCreatingOutboundRoute(false);
    await loadAll();
  }

  const registeredCount = extensions.filter(
    (item) => item.registrationState === "registered",
  ).length;
  const extensionStatusLabels: Record<Extension["registrationState"], string> =
    {
      registered: "Registered",
      unregistered: "Unregistered",
      unreachable: "Unreachable",
      unknown: "Status unknown",
    };
  const trunkStatusLabels: Record<SipTrunk["registrationState"], string> = {
    registered: "Registered",
    unregistered: "Not registered",
    rejected: "Rejected",
    configured: "No registration",
    not_required: "IP trust",
    unknown: "Status unknown",
  };
  const trunkAuthLabels: Record<SipTrunk["authMode"], string> = {
    registration: "Registration",
    credentials: "Digest auth",
    ip: "Source IP",
  };
  const intro = {
    extensions: [
      "Extensions",
      "Create SIP accounts and apply them to Asterisk without editing configuration files.",
    ],
    trunks: [
      "SIP trunks",
      "Connect telephone providers using encrypted credentials or a trusted provider source address.",
    ],
    dids: [
      "Inbound DID routes",
      "Send each provider telephone number to an extension or directly into an IVR menu.",
    ],
    outbound: [
      "Outbound routes",
      "Let registered extensions place controlled external calls through a selected provider trunk.",
    ],
  }[section];

  return (
    <>
      <section className="page-intro pbx-intro">
        <div>
          <span className="eyebrow">ASTERISK PROVISIONING</span>
          <h2>{intro[0]}</h2>
          <p>{intro[1]}</p>
        </div>
        {section === "extensions" && (
          <button
            className="primary-button compact"
            onClick={() => setCreatingExtension(true)}
          >
            + Create extension
          </button>
        )}
        {section === "trunks" && (
          <button
            className="primary-button compact"
            onClick={() => setCreatingTrunk(true)}
          >
            + Add SIP trunk
          </button>
        )}
        {section === "dids" && (
          <button className="primary-button compact" onClick={openDidModal}>
            + Add DID route
          </button>
        )}
        {section === "outbound" && (
          <button
            className="primary-button compact"
            onClick={openOutboundRouteModal}
          >
            + Add outbound route
          </button>
        )}
      </section>
      <section className="pbx-stat-grid">
        <article>
          <span>EXTENSIONS</span>
          <strong>{loading ? initialCount : extensions.length}</strong>
          <small>Provisioned SIP accounts</small>
        </article>
        <article>
          <span>REGISTERED</span>
          <strong>{loading ? "—" : registeredCount}</strong>
          <small>Live reachable extensions</small>
        </article>
        <article>
          <span>SIP TRUNKS</span>
          <strong>{loading ? initialTrunkCount : trunks.length}</strong>
          <small>Provider connections</small>
        </article>
        <article>
          <span>INBOUND DIDS</span>
          <strong>{loading ? initialDidCount : didRoutes.length}</strong>
          <small>Exact number routes</small>
        </article>
      </section>
      <div
        className="pbx-tabs"
        role="tablist"
        aria-label="PBX configuration sections"
      >
        <button
          className={section === "extensions" ? "active" : ""}
          onClick={() => setSection("extensions")}
        >
          Extensions
        </button>
        <button
          className={section === "trunks" ? "active" : ""}
          onClick={() => setSection("trunks")}
        >
          SIP trunks <span>{trunks.length}</span>
        </button>
        <button
          className={section === "dids" ? "active" : ""}
          onClick={() => setSection("dids")}
        >
          Inbound DIDs <span>{didRoutes.length}</span>
        </button>
        <button
          className={section === "outbound" ? "active" : ""}
          onClick={() => setSection("outbound")}
        >
          Outbound routes <span>{outboundRoutes.length}</span>
        </button>
      </div>
      {error && (
        <div className="page-error" role="alert">
          <span>{error}</span>
          <button onClick={() => void loadAll()}>Try again</button>
        </div>
      )}
      <section className="panel extensions-panel">
        {section === "extensions" && (
          <>
            <div className="panel-head">
              <div>
                <span>PBX CORE</span>
                <h3>Extension directory</h3>
              </div>
              <span className="secure-pill">ENCRYPTED CREDENTIALS</span>
            </div>
            {loading ? (
              <div className="empty-state">
                <div className="loader dark" />
                <p>Loading extensions…</p>
              </div>
            ) : extensions.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">01</div>
                <h3>Create your first extension</h3>
                <p>
                  It will be ready to register as soon as Asterisk accepts the
                  generated configuration.
                </p>
                <button
                  className="secondary-button"
                  onClick={() => setCreatingExtension(true)}
                >
                  Create extension
                </button>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="extension-table">
                  <thead>
                    <tr>
                      <th>Extension</th>
                      <th>Name / services</th>
                      <th>Devices</th>
                      <th>Live status</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {extensions.map((extension) => (
                      <tr key={extension.id}>
                        <td>
                          <strong>{extension.extensionNumber}</strong>
                        </td>
                        <td>
                          <span className="extension-name">
                            {extension.displayName}
                          </span>
                          <span className="service-tags">
                            {extension.voicemailEnabled && <i>VM</i>}
                            {extension.recordCalls && <i>REC</i>}
                            {extension.dndEnabled && <i>DND</i>}
                            {extension.forwardMode !== "off" && (
                              <i>
                                FWD {extension.forwardExtensionNumber ?? ""}
                              </i>
                            )}
                          </span>
                        </td>
                        <td>
                          {extension.deviceCount} / {extension.maxContacts}
                        </td>
                        <td>
                          <span
                            className={`registration-pill ${extension.registrationState}`}
                          >
                            <i />
                            {extensionStatusLabels[extension.registrationState]}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              disabled={busyId === extension.id}
                              onClick={() => setEditingExtension(extension)}
                            >
                              Services
                            </button>
                            <button
                              disabled={busyId === extension.id}
                              onClick={() => void resetSecret(extension)}
                            >
                              Reset password
                            </button>
                            <button
                              className="danger"
                              disabled={busyId === extension.id}
                              onClick={() => void removeExtension(extension)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {section === "trunks" && (
          <>
            <div className="panel-head">
              <div>
                <span>PROVIDER CONNECTIVITY</span>
                <h3>SIP trunk directory</h3>
              </div>
              <span className="secure-pill">ENCRYPTED SECRETS</span>
            </div>
            {loading ? (
              <div className="empty-state">
                <div className="loader dark" />
                <p>Loading SIP trunks…</p>
              </div>
            ) : trunks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">02</div>
                <h3>Connect your first provider</h3>
                <p>
                  Add the SIP registrar or trusted provider address before
                  assigning inbound numbers.
                </p>
                <button
                  className="secondary-button"
                  onClick={() => setCreatingTrunk(true)}
                >
                  Add SIP trunk
                </button>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="extension-table">
                  <thead>
                    <tr>
                      <th>Trunk</th>
                      <th>Provider</th>
                      <th>Authentication</th>
                      <th>Live status</th>
                      <th>DIDs</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {trunks.map((trunk) => (
                      <tr key={trunk.id}>
                        <td>
                          <strong>{trunk.name}</strong>
                          {!trunk.enabled && (
                            <span className="muted-tag">Disabled</span>
                          )}
                        </td>
                        <td>
                          <span className="extension-name">
                            {trunk.providerHost}:{trunk.providerPort} ·{" "}
                            {trunk.transport.toUpperCase()}
                          </span>
                          <span className="subvalue">
                            {trunk.inboundMatch
                              ? `Inbound ${trunk.inboundMatch}`
                              : "No source match"}
                            {trunk.dialPrefix
                              ? ` · Prefix ${trunk.dialPrefix}`
                              : ""}
                          </span>
                        </td>
                        <td>{trunkAuthLabels[trunk.authMode]}</td>
                        <td>
                          <span
                            className={`registration-pill ${trunk.registrationState}`}
                          >
                            <i />
                            {trunkStatusLabels[trunk.registrationState]}
                          </span>
                        </td>
                        <td>{trunk.didCount}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              disabled={busyId === trunk.id}
                              onClick={() => setEditingTrunk(trunk)}
                            >
                              Edit
                            </button>
                            <button
                              className="danger"
                              disabled={busyId === trunk.id}
                              onClick={() => void removeTrunk(trunk)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {section === "dids" && (
          <>
            <div className="panel-head">
              <div>
                <span>INBOUND ROUTING</span>
                <h3>DID destinations</h3>
              </div>
              <span className="secure-pill">EXACT MATCH ROUTING</span>
            </div>
            {loading ? (
              <div className="empty-state">
                <div className="loader dark" />
                <p>Loading inbound routes…</p>
              </div>
            ) : didRoutes.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">03</div>
                <h3>Route your first telephone number</h3>
                <p>
                  Create an exact DID route after adding a provider trunk and an
                  extension or IVR destination.
                </p>
                <button className="secondary-button" onClick={openDidModal}>
                  Add DID route
                </button>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="extension-table">
                  <thead>
                    <tr>
                      <th>Inbound DID</th>
                      <th>SIP trunk</th>
                      <th>Destination</th>
                      <th>Status</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {didRoutes.map((route) => (
                      <tr key={route.id}>
                        <td>
                          <strong>{route.didNumber}</strong>
                        </td>
                        <td>{route.trunkName}</td>
                        <td>
                          <span className="extension-name">
                            {route.destinationNumber}
                          </span>
                          <span className="subvalue">
                            {route.destinationType === "ivr"
                              ? "IVR menu"
                              : "Extension"}{" "}
                            · {route.destinationName}
                          </span>
                        </td>
                        <td>
                          {route.published ? (
                            <span className="enabled-pill">
                              <i />
                              Published
                            </span>
                          ) : (
                            <span className="registration-pill unregistered">
                              <i />
                              Paused
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              disabled={busyId === route.id}
                              onClick={() => setEditingDid(route)}
                            >
                              Edit
                            </button>
                            <button
                              className="danger"
                              disabled={busyId === route.id}
                              onClick={() => void removeDid(route)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {section === "outbound" && (
          <>
            <div className="panel-head">
              <div>
                <span>OUTBOUND ROUTING</span>
                <h3>Extension access routes</h3>
              </div>
              <span className="secure-pill">EXACT LENGTH ROUTING</span>
            </div>
            {loading ? (
              <div className="empty-state">
                <div className="loader dark" />
                <p>Loading outbound routes…</p>
              </div>
            ) : outboundRoutes.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">OUT</div>
                <h3>Create the first outbound route</h3>
                <p>
                  Assign an enabled SIP trunk and an extension access prefix.
                  Only international numbers containing 8 to 15 digits will
                  match.
                </p>
                <button
                  className="secondary-button"
                  onClick={openOutboundRouteModal}
                >
                  Add outbound route
                </button>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="extension-table">
                  <thead>
                    <tr>
                      <th>Route</th>
                      <th>Dial from extension</th>
                      <th>SIP trunk</th>
                      <th>Caller ID</th>
                      <th>Status</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {outboundRoutes.map((route) => (
                      <tr key={route.id}>
                        <td>
                          <strong>{route.name}</strong>
                          {!route.enabled && (
                            <span className="muted-tag">Disabled</span>
                          )}
                        </td>
                        <td>
                          <span className="extension-name">
                            {route.accessPrefix} + country code + number
                          </span>
                          <span className="subvalue">
                            8–15 destination digits · {route.ringTimeoutSeconds}
                            s timeout
                          </span>
                        </td>
                        <td>
                          <span className="extension-name">
                            {route.trunkName}
                          </span>
                          <span className="subvalue">
                            {route.providerDialPrefix
                              ? `Carrier prefix ${route.providerDialPrefix}`
                              : "International E.164 digits"}
                          </span>
                        </td>
                        <td>{route.outboundCallerId ?? "Provider default"}</td>
                        <td>
                          {route.published ? (
                            <span className="enabled-pill">
                              <i />
                              Published
                            </span>
                          ) : (
                            <span className="registration-pill unregistered">
                              <i />
                              Paused
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              disabled={busyId === route.id}
                              onClick={() => setEditingOutboundRoute(route)}
                            >
                              Edit
                            </button>
                            <button
                              className="danger"
                              disabled={busyId === route.id}
                              onClick={() => void removeOutboundRoute(route)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
      <section className="pbx-help">
        <div>
          <span>01</span>
          <p>
            <strong>Provider trunk</strong> controls authentication, network
            identity and carrier number formatting.
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>Inbound DID</strong> sends provider calls to an internal
            destination.
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>Outbound route</strong> gives extensions an explicit access
            code for external calls.
          </p>
        </div>
      </section>
      {creatingExtension && (
        <CreateExtensionModal
          onClose={() => setCreatingExtension(false)}
          onCreated={extensionCreated}
        />
      )}
      {creatingTrunk && (
        <TrunkModal
          onClose={() => setCreatingTrunk(false)}
          onSaved={modalSaved}
        />
      )}
      {creatingDid && (
        <DidRouteModal
          trunks={trunks}
          extensions={extensions}
          ivrs={ivrs}
          onClose={() => setCreatingDid(false)}
          onSaved={modalSaved}
        />
      )}
      {editingDid && (
        <DidRouteModal
          route={editingDid}
          trunks={trunks}
          extensions={extensions}
          ivrs={ivrs}
          onClose={() => setEditingDid(null)}
          onSaved={modalSaved}
        />
      )}
      {creatingOutboundRoute && (
        <OutboundRouteModal
          trunks={trunks}
          onClose={() => setCreatingOutboundRoute(false)}
          onSaved={modalSaved}
        />
      )}
      {editingOutboundRoute && (
        <OutboundRouteModal
          route={editingOutboundRoute}
          trunks={trunks}
          onClose={() => setEditingOutboundRoute(null)}
          onSaved={modalSaved}
        />
      )}
      {credentials && (
        <CredentialModal
          credentials={credentials}
          onClose={() => setCredentials(null)}
        />
      )}
      {editingExtension && (
        <ExtensionServicesModal
          extension={editingExtension}
          extensions={extensions}
          onClose={() => setEditingExtension(null)}
          onSaved={modalSaved}
        />
      )}
      {editingTrunk && (
        <TrunkModal
          trunk={editingTrunk}
          onClose={() => setEditingTrunk(null)}
          onSaved={modalSaved}
        />
      )}
    </>
  );
}

function LiveCalls() {
  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);
  const [activeAvailable, setActiveAvailable] = useState<boolean | null>(null);
  const [history, setHistory] = useState<CallHistory | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function refreshActive() {
      try {
        const snapshot = await api<{
          available: boolean;
          calls: ActiveCall[];
        }>("/api/calls/active");
        if (!cancelled) {
          setActiveCalls(snapshot.calls);
          setActiveAvailable(snapshot.available);
        }
      } catch {
        if (!cancelled) {
          setActiveCalls([]);
          setActiveAvailable(false);
        }
      }
    }
    void refreshActive();
    const timer = window.setInterval(() => void refreshActive(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: number | undefined;
    async function refreshHistory() {
      const parameters = new URLSearchParams({ limit: "50", status });
      if (search.trim()) parameters.set("search", search.trim());
      try {
        const result = await api<CallHistory>(
          `/api/calls/history?${parameters}`,
        );
        if (!cancelled) {
          setHistory(result);
          setHistoryError("");
        }
      } catch (error) {
        if (!cancelled) {
          setHistoryError(
            error instanceof Error
              ? error.message
              : "Call history is unavailable",
          );
        }
      }
    }
    const debounce = window.setTimeout(() => {
      void refreshHistory();
      refreshTimer = window.setInterval(() => void refreshHistory(), 10_000);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
      if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
    };
  }, [search, status]);

  const summary = history?.summary;
  const ringing = activeCalls.filter(
    (call) => call.state === "ringing" || call.state === "dialing",
  ).length;
  const activeLabels: Record<ActiveCall["state"], string> = {
    dialing: "Dialing",
    ringing: "Ringing",
    answered: "Connected",
    voicemail: "Voicemail",
  };
  const historyLabels: Record<CallRecord["status"], string> = {
    answered: "Answered",
    missed: "Missed",
    busy: "Busy",
    failed: "Failed",
    unknown: "Unknown",
  };

  return (
    <>
      <section className="page-intro live-intro">
        <div>
          <span className="eyebrow">REAL-TIME ASTERISK ACTIVITY</span>
          <h2>See every call as it happens.</h2>
          <p>
            Current channels refresh every two seconds. Completed calls are
            stored in PostgreSQL for reporting, recording links and future
            billing.
          </p>
        </div>
        <div
          className={`monitor-state ${activeAvailable === false ? "offline" : ""}`}
        >
          <i />
          {activeAvailable === null
            ? "CONNECTING"
            : activeAvailable
              ? "MONITOR LIVE"
              : "MONITOR UNAVAILABLE"}
        </div>
      </section>
      <section className="pbx-stat-grid live-stat-grid">
        <article>
          <span>ACTIVE NOW</span>
          <strong>{activeAvailable === null ? "—" : activeCalls.length}</strong>
          <small>Current Asterisk calls</small>
        </article>
        <article>
          <span>RINGING</span>
          <strong>{activeAvailable === null ? "—" : ringing}</strong>
          <small>Dialing or alerting</small>
        </article>
        <article>
          <span>ANSWERED TODAY</span>
          <strong>{summary?.answered ?? "—"}</strong>
          <small>
            {formatDuration(summary?.billableSeconds ?? 0)} conversation time
          </small>
        </article>
        <article>
          <span>MISSED TODAY</span>
          <strong>{summary?.missed ?? "—"}</strong>
          <small>{summary?.total ?? 0} completed calls today</small>
        </article>
      </section>
      <section className="panel active-calls-panel">
        <div className="panel-head">
          <div>
            <span>LIVE CHANNELS</span>
            <h3>Calls in progress</h3>
          </div>
          <span className="live-pill">2 SEC REFRESH</span>
        </div>
        {activeAvailable === false ? (
          <div className="empty-state live-empty">
            <div className="empty-icon">!</div>
            <h3>Live monitor cannot reach Asterisk</h3>
            <p>
              Completed call history remains available. Check the API service
              and active-call helper after installation.
            </p>
          </div>
        ) : activeCalls.length === 0 ? (
          <div className="empty-state live-empty">
            <div className="call-idle-icon">
              <i />
              <i />
              <i />
            </div>
            <h3>No calls in progress</h3>
            <p>
              Call between extensions 100 and 102 and this panel will update
              automatically.
            </p>
          </div>
        ) : (
          <div className="active-call-grid" aria-live="polite">
            {activeCalls.map((call) => (
              <article className="active-call" key={call.id}>
                <div className="active-call-top">
                  <span className={`call-state ${call.state}`}>
                    <i />
                    {activeLabels[call.state]}
                  </span>
                  <strong>{formatDuration(call.durationSeconds)}</strong>
                </div>
                <div className="call-path">
                  <div>
                    <small>FROM</small>
                    <strong>{call.source}</strong>
                  </div>
                  <span>→</span>
                  <div>
                    <small>TO</small>
                    <strong>{call.destination}</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="panel call-history-panel">
        <div className="call-history-head">
          <div>
            <span>CALL DETAIL RECORDS</span>
            <h3>Call history</h3>
            <small>
              {history
                ? `${history.total} matching records`
                : "Loading records…"}
            </small>
          </div>
          <div className="call-filters">
            <label>
              <span className="sr-only">Search calls</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search number or caller…"
              />
            </label>
            <label>
              <span className="sr-only">Filter by status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="answered">Answered</option>
                <option value="missed">Missed</option>
                <option value="busy">Busy</option>
                <option value="failed">Failed</option>
              </select>
            </label>
          </div>
        </div>
        {historyError && (
          <div className="page-error" role="alert">
            <span>{historyError}</span>
          </div>
        )}
        {!history && !historyError ? (
          <div className="empty-state history-empty">
            <div className="loader dark" />
            <p>Loading call records…</p>
          </div>
        ) : history?.calls.length === 0 ? (
          <div className="empty-state history-empty">
            <div className="empty-icon">CDR</div>
            <h3>No matching call records</h3>
            <p>Completed calls will appear here after either party hangs up.</p>
          </div>
        ) : history ? (
          <div className="table-wrap">
            <table className="call-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Direction</th>
                  <th>Status</th>
                  <th>Ring</th>
                  <th>Talk</th>
                  <th>Recording</th>
                </tr>
              </thead>
              <tbody>
                {history.calls.map((call) => (
                  <tr key={call.id}>
                    <td>
                      <time dateTime={call.startedAt}>
                        {formatCallTime(call.startedAt)}
                      </time>
                    </td>
                    <td>
                      <strong>{call.source}</strong>
                      {call.callerName && <span>{call.callerName}</span>}
                    </td>
                    <td>
                      <strong>{call.destination}</strong>
                    </td>
                    <td>
                      <span className={`direction-pill ${call.direction}`}>
                        {call.direction}
                      </span>
                    </td>
                    <td>
                      <span className={`history-status ${call.status}`}>
                        <i />
                        {historyLabels[call.status]}
                      </span>
                    </td>
                    <td>{formatDuration(call.ringSeconds)}</td>
                    <td>{formatDuration(call.billableSeconds)}</td>
                    <td>
                      {call.recordingAvailable && call.recordingId ? (
                        <a
                          className="recording-link"
                          href={`/api/recordings/${call.recordingId}/audio`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Play
                        </a>
                      ) : (
                        <span className="no-recording">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      <section className="pbx-help live-help">
        <div>
          <span>01</span>
          <p>
            <strong>Live status</strong> comes directly from current Asterisk
            channels.
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>Call history</strong> is durable and remains after service
            restarts.
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>Billing-ready fields</strong> preserve ring and billable
            conversation time.
          </p>
        </div>
      </section>
    </>
  );
}

function Recordings() {
  const [data, setData] = useState<RecordingData | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const parameters = new URLSearchParams({ limit: "50" });
    if (search.trim()) parameters.set("search", search.trim());
    try {
      const result = await api<RecordingData>(`/api/recordings?${parameters}`);
      setData(result);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load recordings",
      );
    }
  }

  useEffect(() => {
    const debounce = window.setTimeout(() => void load(), 250);
    const refresh = window.setInterval(() => void load(), 15_000);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(refresh);
    };
  }, [search]);

  async function updateRetention(retentionDays: number) {
    setBusy("retention");
    setError("");
    try {
      await api("/api/recordings/settings", {
        method: "PATCH",
        body: JSON.stringify({ retentionDays }),
      });
      await load();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Could not update retention",
      );
    } finally {
      setBusy("");
    }
  }

  async function remove(recording: Recording) {
    if (
      !window.confirm(
        `Permanently delete the recording of ${recording.source} to ${recording.destination}?`,
      )
    )
      return;
    setBusy(recording.id);
    setError("");
    try {
      await api(`/api/recordings/${recording.id}`, { method: "DELETE" });
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete recording",
      );
    } finally {
      setBusy("");
    }
  }

  const retentionLabel =
    data?.retentionDays === 0
      ? "Forever"
      : `${data?.retentionDays ?? "—"} days`;
  return (
    <>
      <section className="page-intro recording-intro">
        <div>
          <span className="eyebrow">SECURE LOCAL AUDIO</span>
          <h2>Recorded conversations, tied to each call.</h2>
          <p>
            Playback and downloads require an authenticated Netbrowse Voice
            session. Enable recording from an extension's Services screen.
          </p>
        </div>
        <div className="recording-lock">
          <span>●</span> PRIVATE STORAGE
        </div>
      </section>
      <section className="pbx-stat-grid recording-stat-grid">
        <article>
          <span>RECORDINGS</span>
          <strong>{data?.total ?? "—"}</strong>
          <small>Available WAV files</small>
        </article>
        <article>
          <span>STORAGE USED</span>
          <strong>{data ? formatFileSize(data.storageBytes) : "—"}</strong>
          <small>Outside the public web root</small>
        </article>
        <article>
          <span>RETENTION</span>
          <strong>{retentionLabel}</strong>
          <small>Automatic cleanup policy</small>
        </article>
        <article>
          <span>ACCESS</span>
          <strong>Private</strong>
          <small>Owner session required</small>
        </article>
      </section>
      {error && (
        <div className="page-error" role="alert">
          <span>{error}</span>
          <button onClick={() => void load()}>Try again</button>
        </div>
      )}
      <section className="panel recordings-panel">
        <div className="recordings-head">
          <div>
            <span>CALL RECORDINGS</span>
            <h3>Recording archive</h3>
            <small>
              {data ? `${data.recordings.length} shown` : "Loading archive…"}
            </small>
          </div>
          <div className="recording-controls">
            <label>
              <span className="sr-only">Search recordings</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search number or caller…"
              />
            </label>
            <label>
              <span>Keep recordings</span>
              <select
                value={data?.retentionDays ?? 90}
                disabled={!data || busy === "retention"}
                onChange={(event) =>
                  void updateRetention(Number(event.target.value))
                }
              >
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
                <option value={0}>Forever</option>
              </select>
            </label>
          </div>
        </div>
        {!data ? (
          <div className="empty-state history-empty">
            <div className="loader dark" />
            <p>Loading recording archive…</p>
          </div>
        ) : data.recordings.length === 0 ? (
          <div className="empty-state recording-empty">
            <div className="empty-icon">REC</div>
            <h3>No recordings yet</h3>
            <p>
              Open PBX Core, choose an extension's Services, enable automatic
              recording, then complete a call to that extension.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="recording-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Call</th>
                  <th>Talk time</th>
                  <th>File size</th>
                  <th>Playback</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.recordings.map((recording) => (
                  <tr key={recording.id}>
                    <td>
                      <time dateTime={recording.startedAt}>
                        {formatCallTime(recording.startedAt)}
                      </time>
                    </td>
                    <td>
                      <strong>
                        {recording.source} → {recording.destination}
                      </strong>
                      {recording.callerName && (
                        <span>{recording.callerName}</span>
                      )}
                    </td>
                    <td>{formatDuration(recording.billableSeconds)}</td>
                    <td>{formatFileSize(recording.sizeBytes)}</td>
                    <td>
                      <audio
                        controls
                        preload="none"
                        src={`/api/recordings/${recording.id}/audio`}
                      />
                    </td>
                    <td>
                      <div className="recording-actions">
                        <a
                          href={`/api/recordings/${recording.id}/audio?download=1`}
                        >
                          Download
                        </a>
                        <button
                          disabled={busy === recording.id}
                          onClick={() => void remove(recording)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="pbx-help recording-help">
        <div>
          <span>01</span>
          <p>
            <strong>Enable per extension</strong> so recording remains
            intentional and opt-in.
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>Authenticated audio</strong> is never served directly by
            Nginx.
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>Retention cleanup</strong> removes audio while preserving
            the call record.
          </p>
        </div>
      </section>
    </>
  );
}

function SoundStudio() {
  const [data, setData] = useState<SoundStudioData | null>(null);
  const [selectedProvider, setSelectedProvider] =
    useState<SoundProvider["key"]>("openai");
  const [apiKey, setApiKey] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("marin");
  const [instructions, setInstructions] = useState(
    "Speak clearly, warmly, and at a natural pace.",
  );
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");

  async function load() {
    try {
      const result = await api<SoundStudioData>("/api/sound-studio");
      setData(result);
      const provider =
        result.providers.find((item) => item.key === selectedProvider) ??
        result.providers[0];
      if (provider && !provider.voices.some((item) => item.id === voice)) {
        setVoice(provider.voices[0]?.id ?? "");
      }
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load Sound Studio",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const provider =
    data?.providers.find((item) => item.key === selectedProvider) ??
    data?.providers[0];

  function chooseProvider(key: SoundProvider["key"]) {
    const next = data?.providers.find((item) => item.key === key);
    setSelectedProvider(key);
    setApiKey("");
    setError("");
    setNotice("");
    setVoice(next?.voices[0]?.id ?? "");
  }

  async function saveProvider(event: FormEvent) {
    event.preventDefault();
    setBusy("provider");
    setError("");
    setNotice("");
    try {
      await api("/api/sound-studio/settings", {
        method: "PATCH",
        body: JSON.stringify({ provider: selectedProvider, apiKey }),
      });
      setApiKey("");
      setNotice(`${provider?.name ?? "Speech"} provider configured.`);
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save provider settings",
      );
    } finally {
      setBusy("");
    }
  }

  async function removeProvider() {
    if (
      !window.confirm(
        `Remove the saved ${provider?.name ?? "provider"} API key? Existing sounds will remain available.`,
      )
    )
      return;
    setBusy("provider");
    setError("");
    setNotice("");
    try {
      await api("/api/sound-studio/settings", {
        method: "PATCH",
        body: JSON.stringify({ provider: selectedProvider, clearApiKey: true }),
      });
      setNotice(`${provider?.name ?? "Speech"} provider removed.`);
      await load();
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Could not remove provider settings",
      );
    } finally {
      setBusy("");
    }
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    setBusy("generate");
    setError("");
    setNotice("");
    try {
      await api<{ sound: SoundAsset }>("/api/sound-studio/generate", {
        method: "POST",
        body: JSON.stringify({
          provider: selectedProvider,
          name,
          text,
          voice,
          instructions,
          speed,
        }),
      });
      setName("");
      setText("");
      setNotice("Asterisk-ready sound generated successfully.");
      await load();
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Could not generate speech",
      );
    } finally {
      setBusy("");
    }
  }

  async function removeSound(sound: SoundAsset) {
    if (!window.confirm(`Permanently delete “${sound.name}”?`)) return;
    setBusy(sound.id);
    setError("");
    setNotice("");
    try {
      await api(`/api/sound-studio/${sound.id}`, { method: "DELETE" });
      setNotice("Sound deleted.");
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete sound",
      );
    } finally {
      setBusy("");
    }
  }

  async function copyAsteriskName(sound: SoundAsset) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(sound.asteriskName);
    } else {
      const field = document.createElement("textarea");
      field.value = sound.asteriskName;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopied(sound.id);
    window.setTimeout(() => setCopied(""), 1400);
  }

  const lastGenerated = data?.sounds[0]?.createdAt;
  return (
    <>
      <section className="page-intro studio-intro">
        <div>
          <span className="eyebrow">AI VOICE PRODUCTION</span>
          <h2>Turn text into telephony-ready sound.</h2>
          <p>
            Direct the voice, review the result and keep approved audio in
            Asterisk’s private sound library.
          </p>
        </div>
        <div className="studio-format">
          <strong>WAV</strong>
          <span>8 kHz · mono · PCM</span>
        </div>
      </section>
      <section className="pbx-stat-grid studio-stat-grid">
        <article>
          <span>SOUND ASSETS</span>
          <strong>{data?.total ?? "—"}</strong>
          <small>Private Asterisk files</small>
        </article>
        <article>
          <span>STORAGE USED</span>
          <strong>{data ? formatFileSize(data.storageBytes) : "—"}</strong>
          <small>Generated WAV audio</small>
        </article>
        <article>
          <span>PROVIDER</span>
          <strong>{provider?.configured ? "Ready" : "Setup"}</strong>
          <small>{provider?.name ?? "OpenAI"} · encrypted key</small>
        </article>
        <article>
          <span>LAST GENERATED</span>
          <strong>
            {lastGenerated ? formatCallTime(lastGenerated) : "None"}
          </strong>
          <small>
            {lastGenerated
              ? "Most recent approved sound"
              : "Create the first sound"}
          </small>
        </article>
      </section>
      {error && (
        <div className="page-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="studio-notice" role="status">
          <span>{notice}</span>
        </div>
      )}
      <section className="provider-tabs" aria-label="Speech provider">
        {(data?.providers ?? []).map((item) => (
          <button
            key={item.key}
            type="button"
            className={selectedProvider === item.key ? "active" : ""}
            onClick={() => chooseProvider(item.key)}
          >
            <span>{item.name}</span>
            <small>
              {item.configured ? "Configured" : "Not configured"}
              {item.preview ? " · Preview" : ""}
            </small>
          </button>
        ))}
      </section>
      <section className="studio-workspace">
        <article className="panel studio-compose">
          <div className="panel-head">
            <div>
              <span>VOICE GENERATOR</span>
              <h3>Create an announcement</h3>
            </div>
            <span className="secure-pill">AI GENERATED</span>
          </div>
          <form className="studio-form" onSubmit={generate}>
            <label>
              <span>Sound name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={2}
                maxLength={80}
                required
                placeholder="Main welcome greeting"
              />
            </label>
            <label>
              <span>
                Text to speak <em>{text.length}/4096</em>
              </span>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={4096}
                required
                rows={7}
                placeholder="Thank you for calling. Please hold while we connect your call."
              />
            </label>
            <div className="studio-form-grid">
              <label>
                <span>Voice</span>
                <select
                  value={voice}
                  disabled={
                    !provider?.configured || provider.voices.length === 0
                  }
                  onChange={(event) => setVoice(event.target.value)}
                >
                  {(provider?.voices ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.description ? ` · ${item.description}` : ""}
                      {provider?.recommendedVoices.includes(item.id)
                        ? " · Recommended"
                        : ""}
                    </option>
                  ))}
                </select>
                {provider?.voiceLoadError && (
                  <small className="field-warning">
                    {provider.voiceLoadError}
                  </small>
                )}
              </label>
              <label>
                <span>
                  Speed <em>{speed.toFixed(2)}×</em>
                </span>
                <input
                  type="range"
                  min="0.50"
                  max="1.50"
                  step="0.05"
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                />
              </label>
            </div>
            <label>
              <span>
                Voice direction <em>{instructions.length}/1000</em>
              </span>
              <textarea
                value={instructions}
                disabled={provider?.controls.instructions === false}
                onChange={(event) => setInstructions(event.target.value)}
                maxLength={1000}
                rows={3}
                placeholder={
                  provider?.controls.instructions === false
                    ? "This provider uses its saved voice characteristics and speed control."
                    : "Describe the desired tone, pacing, accent and pronunciation."
                }
              />
              <small>
                {provider?.controls.instructions === false
                  ? "ElevenLabs applies the selected account voice and speed; direction text is not sent."
                  : "For example: “Calm professional tone. Pause after each menu option. Pronounce Netbrowse as Net Browse.”"}
              </small>
            </label>
            <div className="ai-disclosure">
              <strong>AI voice disclosure</strong>
              <span>
                People who hear generated audio must be clearly informed that
                the voice is AI-generated. Add that disclosure to the call flow
                when this sound is assigned.
              </span>
            </div>
            <button
              className="primary-button"
              disabled={
                !provider?.configured ||
                provider.voices.length === 0 ||
                busy === "generate"
              }
            >
              {busy === "generate"
                ? "Generating and converting…"
                : provider?.configured
                  ? provider.voices.length
                    ? "Generate Asterisk WAV"
                    : "No voice available"
                  : "Configure provider first"}
            </button>
          </form>
        </article>
        <aside className="panel studio-provider">
          <div className="panel-head">
            <div>
              <span>PROVIDER</span>
              <h3>Speech connection</h3>
            </div>
            <span
              className={`provider-state ${provider?.configured ? "ready" : ""}`}
            >
              <i />
              {provider?.configured ? "READY" : "NOT SET"}
            </span>
          </div>
          <div className="provider-logo">
            {selectedProvider === "google"
              ? "G"
              : selectedProvider === "elevenlabs"
                ? "11"
                : "AI"}
          </div>
          <h4>{provider?.name ?? "OpenAI"}</h4>
          <p>
            The server sends only the entered script and voice controls for
            generation. The API key is encrypted before database storage.
          </p>
          <dl>
            <div>
              <dt>Model</dt>
              <dd>{provider?.model ?? "gpt-4o-mini-tts"}</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>Asterisk WAV</dd>
            </div>
            <div>
              <dt>Key visibility</dt>
              <dd>Write-only</dd>
            </div>
          </dl>
          {provider?.managedAccountRequired && (
            <div className="managed-account-note">
              <strong>Managed credentials</strong>
              <span>
                Use only a key supplied and managed by an authorized adult or
                organization account owner, in line with the provider’s terms.
              </span>
            </div>
          )}
          <form className="provider-form" onSubmit={saveProvider}>
            <label>
              <span>
                {provider?.configured
                  ? "Replace API key"
                  : `${provider?.name ?? "Provider"} API key`}
              </span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                required
                minLength={16}
                maxLength={512}
                autoComplete="new-password"
                placeholder={
                  provider?.configured
                    ? "Enter a new key"
                    : "Paste the authorized key"
                }
              />
            </label>
            <button className="secondary-button" disabled={busy === "provider"}>
              {busy === "provider"
                ? "Saving…"
                : provider?.configured
                  ? "Replace key"
                  : "Save encrypted key"}
            </button>
          </form>
          {provider?.configured && (
            <button
              className="provider-remove"
              disabled={busy === "provider"}
              onClick={() => void removeProvider()}
            >
              Remove provider key
            </button>
          )}
        </aside>
      </section>
      <section className="panel sound-library">
        <div className="panel-head">
          <div>
            <span>ASTERISK SOUND LIBRARY</span>
            <h3>Generated sounds</h3>
          </div>
          <span className="secure-pill">PRIVATE STORAGE</span>
        </div>
        {!data ? (
          <div className="empty-state history-empty">
            <div className="loader dark" />
            <p>Loading sound library…</p>
          </div>
        ) : data.sounds.length === 0 ? (
          <div className="empty-state studio-empty">
            <div className="empty-icon">WAV</div>
            <h3>No generated sounds yet</h3>
            <p>
              Configure the speech provider, enter an announcement and generate
              your first Asterisk-ready file.
            </p>
          </div>
        ) : (
          <div className="sound-grid">
            {data.sounds.map((sound) => (
              <article className="sound-card" key={sound.id}>
                <div className="sound-card-head">
                  <div className="sound-wave">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <div>
                    <h4>{sound.name}</h4>
                    <span>
                      {sound.provider} · {sound.voice} ·{" "}
                      {sound.speed.toFixed(2)}× ·{" "}
                      {Math.round(sound.durationMs / 100) / 10}s
                    </span>
                  </div>
                  <em>AI</em>
                </div>
                <p>{sound.sourceText}</p>
                {sound.audioAvailable ? (
                  <audio
                    controls
                    preload="none"
                    src={`/api/sound-studio/${sound.id}/audio`}
                  />
                ) : (
                  <div className="missing-audio">Audio file unavailable</div>
                )}
                <div className="asterisk-path">
                  <span>Asterisk name</span>
                  <code>{sound.asteriskName}</code>
                  <button onClick={() => void copyAsteriskName(sound)}>
                    {copied === sound.id ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="sound-meta">
                  <span>{formatFileSize(sound.sizeBytes)}</span>
                  <span>{sound.sampleRate / 1000} kHz mono</span>
                  <span>{formatCallTime(sound.createdAt)}</span>
                </div>
                <div className="sound-actions">
                  <a href={`/api/sound-studio/${sound.id}/audio?download=1`}>
                    Download WAV
                  </a>
                  <button
                    disabled={busy === sound.id}
                    onClick={() => void removeSound(sound)}
                  >
                    {busy === sound.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="pbx-help studio-help">
        <div>
          <span>01</span>
          <p>
            <strong>Direct pronunciation</strong> with plain-language
            instructions for names, pacing and pauses.
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>Automatic conversion</strong> produces mono 8 kHz, 16-bit
            PCM files for Asterisk.
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>Asterisk names</strong> are ready for announcements, queues
            and the upcoming IVR builder.
          </p>
        </div>
      </section>
    </>
  );
}

function IvrBuilder() {
  const [data, setData] = useState<IvrData | null>(null);
  const [draft, setDraft] = useState<IvrDraft | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      setData(await api<IvrData>("/api/ivrs"));
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load IVR Builder",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function createDraft() {
    const firstExtension = data?.extensions[0]?.id ?? "";
    const usedNumbers = new Set(
      data?.ivrs.map((ivr) => ivr.internalNumber) ?? [],
    );
    let suggestedNumber = 700;
    while (usedNumbers.has(String(suggestedNumber))) suggestedNumber += 1;
    setDraft({
      name: "",
      internalNumber: String(suggestedNumber),
      greetingSoundId: data?.sounds[0]?.id ?? "",
      timeoutSeconds: 7,
      maxAttempts: 3,
      fallbackExtensionId: "",
      enabled: true,
      options: [{ digit: "1", extensionId: firstExtension }],
    });
    setError("");
    setNotice("");
  }

  function editDraft(menu: IvrMenu) {
    setDraft({
      id: menu.id,
      name: menu.name,
      internalNumber: menu.internalNumber,
      greetingSoundId: menu.greetingSoundId,
      timeoutSeconds: menu.timeoutSeconds,
      maxAttempts: menu.maxAttempts,
      fallbackExtensionId: menu.fallbackExtensionId ?? "",
      enabled: menu.enabled,
      options: menu.options.map((option) => ({
        digit: option.digit,
        extensionId: option.extensionId,
      })),
    });
    setError("");
    setNotice("");
  }

  function updateOption(
    index: number,
    change: Partial<IvrDraft["options"][number]>,
  ) {
    setDraft((current) =>
      current
        ? {
            ...current,
            options: current.options.map((option, optionIndex) =>
              optionIndex === index ? { ...option, ...change } : option,
            ),
          }
        : current,
    );
  }

  function addOption() {
    setDraft((current) => {
      if (!current || current.options.length >= 10) return current;
      const used = new Set(current.options.map((option) => option.digit));
      const digit =
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].find(
          (candidate) => !used.has(candidate),
        ) ?? "0";
      return {
        ...current,
        options: [
          ...current.options,
          { digit, extensionId: data?.extensions[0]?.id ?? "" },
        ],
      };
    });
  }

  function removeOption(index: number) {
    setDraft((current) =>
      current && current.options.length > 1
        ? {
            ...current,
            options: current.options.filter(
              (_option, optionIndex) => optionIndex !== index,
            ),
          }
        : current,
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy("save");
    setError("");
    setNotice("");
    try {
      await api(draft.id ? `/api/ivrs/${draft.id}` : "/api/ivrs", {
        method: draft.id ? "PATCH" : "POST",
        body: JSON.stringify({
          name: draft.name,
          internalNumber: draft.internalNumber,
          greetingSoundId: draft.greetingSoundId,
          timeoutSeconds: draft.timeoutSeconds,
          maxAttempts: draft.maxAttempts,
          fallbackExtensionId: draft.fallbackExtensionId || null,
          enabled: draft.enabled,
          options: draft.options,
        }),
      });
      setDraft(null);
      setNotice(
        draft.id
          ? "IVR updated and published to Asterisk."
          : "IVR created and published to Asterisk.",
      );
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the IVR",
      );
    } finally {
      setBusy("");
    }
  }

  async function toggle(menu: IvrMenu) {
    setBusy(menu.id);
    setError("");
    setNotice("");
    try {
      await api(`/api/ivrs/${menu.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !menu.enabled }),
      });
      setNotice(`${menu.name} ${menu.enabled ? "disabled" : "enabled"}.`);
      await load();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Could not change the IVR state",
      );
    } finally {
      setBusy("");
    }
  }

  async function remove(menu: IvrMenu) {
    if (!window.confirm(`Permanently delete IVR “${menu.name}”?`)) return;
    setBusy(menu.id);
    setError("");
    setNotice("");
    try {
      await api(`/api/ivrs/${menu.id}`, { method: "DELETE" });
      setNotice("IVR deleted and removed from Asterisk.");
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete the IVR",
      );
    } finally {
      setBusy("");
    }
  }

  const activeCount = data?.ivrs.filter((menu) => menu.enabled).length ?? 0;
  const routeCount =
    data?.ivrs.reduce((total, menu) => total + menu.options.length, 0) ?? 0;
  const selectedSound = data?.sounds.find(
    (sound) => sound.id === draft?.greetingSoundId,
  );

  return (
    <>
      <section className="page-intro ivr-intro">
        <div>
          <span className="eyebrow">CALL FLOW DESIGNER</span>
          <h2>Build menus callers can navigate.</h2>
          <p>
            Turn approved Sound Studio announcements into live keypad routing
            without editing Asterisk configuration.
          </p>
        </div>
        <button
          className="primary-button compact"
          disabled={
            !data || data.sounds.length === 0 || data.extensions.length === 0
          }
          onClick={createDraft}
        >
          Add IVR menu
        </button>
      </section>
      <section className="pbx-stat-grid ivr-stat-grid">
        <article>
          <span>IVR MENUS</span>
          <strong>{data?.ivrs.length ?? "—"}</strong>
          <small>Configured call flows</small>
        </article>
        <article>
          <span>ACTIVE</span>
          <strong>{data ? activeCount : "—"}</strong>
          <small>Published internal numbers</small>
        </article>
        <article>
          <span>KEY ROUTES</span>
          <strong>{data ? routeCount : "—"}</strong>
          <small>Digits mapped to extensions</small>
        </article>
        <article>
          <span>SOUND ASSETS</span>
          <strong>{data?.sounds.length ?? "—"}</strong>
          <small>Available greetings</small>
        </article>
      </section>
      {error && (
        <div className="page-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="studio-notice" role="status">
          <span>{notice}</span>
        </div>
      )}
      {data && data.sounds.length === 0 && (
        <div className="notice warning ivr-prerequisite">
          <strong>Create a greeting first</strong>
          <span>
            Generate or upload an announcement in Sound Studio before creating
            an IVR.
          </span>
        </div>
      )}
      {data && data.extensions.length === 0 && (
        <div className="notice warning ivr-prerequisite">
          <strong>Create an extension first</strong>
          <span>
            IVR keypad options require at least one active extension
            destination.
          </span>
        </div>
      )}
      <section className="panel ivr-list-panel">
        <div className="panel-head">
          <div>
            <span>ASTERISK MENUS</span>
            <h3>Published call flows</h3>
          </div>
          <span className="secure-pill">STRICTLY VALIDATED</span>
        </div>
        {!data ? (
          <div className="empty-state history-empty">
            <div className="loader dark" />
            <p>Loading IVR menus…</p>
          </div>
        ) : data.ivrs.length === 0 ? (
          <div className="empty-state ivr-empty">
            <div className="empty-icon">IVR</div>
            <h3>No IVR menus yet</h3>
            <p>
              Create a menu, choose a greeting, assign keypad destinations and
              dial its internal number to test it.
            </p>
          </div>
        ) : (
          <div className="ivr-grid">
            {data.ivrs.map((menu) => (
              <article
                className={`ivr-card ${menu.enabled ? "" : "disabled"}`}
                key={menu.id}
              >
                <div className="ivr-card-head">
                  <div className="ivr-number">
                    <span>DIAL</span>
                    <strong>{menu.internalNumber}</strong>
                  </div>
                  <div>
                    <h4>{menu.name}</h4>
                    <span
                      className={`ivr-state ${menu.enabled ? "active" : ""}`}
                    >
                      <i />
                      {menu.enabled ? "ACTIVE" : "DISABLED"}
                    </span>
                  </div>
                </div>
                <div className="ivr-greeting">
                  <span>GREETING</span>
                  <strong>{menu.greetingSoundName}</strong>
                  <audio
                    controls
                    preload="none"
                    src={`/api/sound-studio/${menu.greetingSoundId}/audio`}
                  />
                </div>
                <div className="ivr-route-list">
                  {menu.options.map((option) => (
                    <div key={option.digit}>
                      <b>{option.digit}</b>
                      <span>routes to</span>
                      <strong>
                        {option.extensionNumber} · {option.extensionName}
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="ivr-fallback">
                  <span>Timeout / failed input</span>
                  <strong>
                    {menu.fallbackExtensionNumber
                      ? `Extension ${menu.fallbackExtensionNumber}`
                      : "Hang up"}
                  </strong>
                  <small>
                    {menu.timeoutSeconds}s · {menu.maxAttempts} invalid attempt
                    {menu.maxAttempts === 1 ? "" : "s"}
                  </small>
                </div>
                <div className="ivr-actions">
                  <button
                    disabled={busy === menu.id}
                    onClick={() => void toggle(menu)}
                  >
                    {menu.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    disabled={busy === menu.id}
                    onClick={() => editDraft(menu)}
                  >
                    Edit
                  </button>
                  <button
                    className="danger"
                    disabled={busy === menu.id}
                    onClick={() => void remove(menu)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="pbx-help ivr-help">
        <div>
          <span>01</span>
          <p>
            <strong>Dial internally</strong> using the menu number before
            connecting a real inbound DID.
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>Invalid digits</strong> replay a standard Asterisk warning
            until the attempt limit is reached.
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>Timeout fallback</strong> routes to an extension or ends the
            call cleanly.
          </p>
        </div>
      </section>

      {draft && data && (
        <Modal
          title={draft.id ? "Edit IVR menu" : "Create IVR menu"}
          onClose={() => setDraft(null)}
        >
          <form className="modal-form ivr-form" onSubmit={save}>
            <div className="form-grid">
              <label>
                <span>Menu name</span>
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  placeholder="Main company menu"
                />
              </label>
              <label>
                <span>Internal test number</span>
                <input
                  required
                  pattern="[0-9]{2,8}"
                  value={draft.internalNumber}
                  onChange={(event) =>
                    setDraft({ ...draft, internalNumber: event.target.value })
                  }
                  placeholder="700"
                />
                <small>Dial this number from extension 100 or 102.</small>
              </label>
            </div>
            <label>
              <span>Greeting from Sound Studio</span>
              <select
                required
                value={draft.greetingSoundId}
                onChange={(event) =>
                  setDraft({ ...draft, greetingSoundId: event.target.value })
                }
              >
                {data.sounds.map((sound) => (
                  <option key={sound.id} value={sound.id}>
                    {sound.name} · {sound.provider} / {sound.voice}
                  </option>
                ))}
              </select>
            </label>
            {selectedSound && (
              <audio
                className="ivr-preview"
                controls
                preload="none"
                src={`/api/sound-studio/${selectedSound.id}/audio`}
              />
            )}
            <div className="form-section">
              <span>KEYPAD DESTINATIONS</span>
              <p>Assign each spoken menu option to an active extension.</p>
            </div>
            <div className="ivr-option-editor">
              {draft.options.map((option, index) => (
                <div key={index}>
                  <label>
                    <span>Key</span>
                    <select
                      value={option.digit}
                      onChange={(event) =>
                        updateOption(index, { digit: event.target.value })
                      }
                    >
                      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map(
                        (digit) => (
                          <option key={digit} value={digit}>
                            {digit}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    <span>Destination</span>
                    <select
                      value={option.extensionId}
                      onChange={(event) =>
                        updateOption(index, { extensionId: event.target.value })
                      }
                    >
                      {data.extensions.map((extension) => (
                        <option key={extension.id} value={extension.id}>
                          {extension.extensionNumber} · {extension.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove key ${option.digit}`}
                    disabled={draft.options.length === 1}
                    onClick={() => removeOption(index)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              className="ivr-add-option"
              type="button"
              disabled={draft.options.length >= 10}
              onClick={addOption}
            >
              + Add keypad destination
            </button>
            <div className="form-section">
              <span>FAILED INPUT HANDLING</span>
              <p>
                Choose how long to wait and where unresolved calls should go.
              </p>
            </div>
            <div className="form-grid">
              <label>
                <span>Input timeout</span>
                <select
                  value={draft.timeoutSeconds}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      timeoutSeconds: Number(event.target.value),
                    })
                  }
                >
                  {[3, 5, 7, 10, 15, 20, 30].map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} seconds
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Invalid attempts</span>
                <select
                  value={draft.maxAttempts}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      maxAttempts: Number(event.target.value),
                    })
                  }
                >
                  {[1, 2, 3, 4, 5].map((attempts) => (
                    <option key={attempts} value={attempts}>
                      {attempts}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <span>Timeout / failed-input destination</span>
              <select
                value={draft.fallbackExtensionId}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    fallbackExtensionId: event.target.value,
                  })
                }
              >
                <option value="">Hang up</option>
                {data.extensions.map((extension) => (
                  <option key={extension.id} value={extension.id}>
                    Extension {extension.extensionNumber} ·{" "}
                    {extension.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) =>
                  setDraft({ ...draft, enabled: event.target.checked })
                }
              />
              <span>
                <strong>Publish this IVR</strong>
                <small>
                  Enabled menus are immediately available from the internal test
                  number.
                </small>
              </span>
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy === "save"}>
                {busy === "save"
                  ? "Validating and publishing…"
                  : draft.id
                    ? "Save and publish"
                    : "Create and publish"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function CallCentre() {
  const [data, setData] = useState<CallCentreData | null>(null);
  const [accountData, setAccountData] = useState<AgentAccountData | null>(null);
  const [draft, setDraft] = useState<CallGroupDraft | null>(null);
  const [accountDraft, setAccountDraft] = useState<AgentAccountDraft | null>(
    null,
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      const [groups, accounts] = await Promise.all([
        api<CallCentreData>("/api/call-centre/groups"),
        api<AgentAccountData>("/api/agent-accounts"),
      ]);
      setData(groups);
      setAccountData(accounts);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load Call Centre Core",
      );
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  function createAccountDraft() {
    const extension = accountData?.extensions.find(
      (item) => item.enabled && !item.agentUserId,
    );
    setAccountDraft({
      displayName: extension?.displayName ?? "",
      email: "",
      password: "",
      extensionId: extension?.id ?? "",
      active: true,
    });
    setError("");
    setNotice("");
  }

  function editAccountDraft(account: AgentAccount) {
    setAccountDraft({
      id: account.id,
      displayName: account.displayName,
      email: account.email,
      password: "",
      extensionId: account.extensionId,
      active: account.active,
    });
    setError("");
    setNotice("");
  }

  async function saveAccount(event: FormEvent) {
    event.preventDefault();
    if (!accountDraft) return;
    setBusy("account-save");
    setError("");
    try {
      await api(
        accountDraft.id
          ? `/api/agent-accounts/${accountDraft.id}`
          : "/api/agent-accounts",
        {
          method: accountDraft.id ? "PATCH" : "POST",
          body: JSON.stringify({
            displayName: accountDraft.displayName,
            email: accountDraft.email,
            extensionId: accountDraft.extensionId,
            active: accountDraft.active,
            password: accountDraft.password || undefined,
          }),
        },
      );
      setAccountDraft(null);
      setNotice(
        accountDraft.id ? "Agent account updated." : "Agent login created.",
      );
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the agent account",
      );
    } finally {
      setBusy("");
    }
  }

  async function toggleAccount(account: AgentAccount) {
    setBusy(`account:${account.id}`);
    setError("");
    try {
      await api(`/api/agent-accounts/${account.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !account.active }),
      });
      setNotice(
        `${account.displayName} ${account.active ? "disabled" : "enabled"}.`,
      );
      await load();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Could not change account state",
      );
    } finally {
      setBusy("");
    }
  }

  async function removeAccount(account: AgentAccount) {
    if (
      !window.confirm(
        `Permanently delete the login for “${account.displayName}”?`,
      )
    )
      return;
    setBusy(`account:${account.id}`);
    setError("");
    try {
      await api(`/api/agent-accounts/${account.id}`, { method: "DELETE" });
      setNotice("Agent login deleted. The PBX extension was not removed.");
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete the agent account",
      );
    } finally {
      setBusy("");
    }
  }

  function createDraft() {
    const used = new Set(
      data?.groups.map((group) => group.internalNumber) ?? [],
    );
    let suggested = 600;
    while (used.has(String(suggested))) suggested += 1;
    setDraft({
      name: "",
      internalNumber: String(suggested),
      groupType: "queue",
      strategy: "ringall",
      ringTimeoutSeconds: 15,
      retrySeconds: 5,
      maxWaitSeconds: 60,
      wrapupSeconds: 5,
      fallbackExtensionId: "",
      memberExtensionIds:
        data?.extensions.map((extension) => extension.id).slice(0, 2) ?? [],
      enabled: true,
    });
    setError("");
    setNotice("");
  }

  function editDraft(group: CallGroup) {
    setDraft({
      id: group.id,
      name: group.name,
      internalNumber: group.internalNumber,
      groupType: group.groupType,
      strategy: group.strategy,
      ringTimeoutSeconds: group.ringTimeoutSeconds,
      retrySeconds: group.retrySeconds,
      maxWaitSeconds: group.maxWaitSeconds,
      wrapupSeconds: group.wrapupSeconds,
      fallbackExtensionId: group.fallbackExtensionId ?? "",
      memberExtensionIds: group.members.map((member) => member.extensionId),
      enabled: group.enabled,
    });
    setError("");
    setNotice("");
  }

  function toggleMember(extensionId: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      memberExtensionIds: draft.memberExtensionIds.includes(extensionId)
        ? draft.memberExtensionIds.filter((id) => id !== extensionId)
        : [...draft.memberExtensionIds, extensionId],
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy("save");
    setError("");
    setNotice("");
    try {
      await api(
        draft.id
          ? `/api/call-centre/groups/${draft.id}`
          : "/api/call-centre/groups",
        {
          method: draft.id ? "PATCH" : "POST",
          body: JSON.stringify({
            name: draft.name,
            internalNumber: draft.internalNumber,
            groupType: draft.groupType,
            strategy: draft.strategy,
            ringTimeoutSeconds: draft.ringTimeoutSeconds,
            retrySeconds: draft.retrySeconds,
            maxWaitSeconds: draft.maxWaitSeconds,
            wrapupSeconds: draft.wrapupSeconds,
            fallbackExtensionId: draft.fallbackExtensionId || null,
            memberExtensionIds: draft.memberExtensionIds,
            enabled: draft.enabled,
          }),
        },
      );
      setDraft(null);
      setNotice(
        draft.id
          ? "Call group updated in Asterisk."
          : "Call group created and published to Asterisk.",
      );
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the call group",
      );
    } finally {
      setBusy("");
    }
  }

  async function toggle(group: CallGroup) {
    setBusy(group.id);
    setError("");
    try {
      await api(`/api/call-centre/groups/${group.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !group.enabled }),
      });
      setNotice(`${group.name} ${group.enabled ? "disabled" : "enabled"}.`);
      await load();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Could not change group state",
      );
    } finally {
      setBusy("");
    }
  }

  async function remove(group: CallGroup) {
    if (!window.confirm(`Permanently delete “${group.name}”?`)) return;
    setBusy(group.id);
    setError("");
    try {
      await api(`/api/call-centre/groups/${group.id}`, { method: "DELETE" });
      setNotice("Call group deleted and removed from Asterisk.");
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete the call group",
      );
    } finally {
      setBusy("");
    }
  }

  async function updateAgent(
    group: CallGroup,
    member: CallGroup["members"][number],
    change: {
      signedIn?: boolean;
      paused?: boolean;
      pauseReason?: string | null;
    },
  ) {
    const operation = `agent:${group.id}:${member.extensionId}`;
    setBusy(operation);
    setError("");
    setNotice("");
    try {
      await api(
        `/api/call-centre/groups/${group.id}/agents/${member.extensionId}`,
        {
          method: "PATCH",
          body: JSON.stringify(change),
        },
      );
      setNotice(`Extension ${member.extensionNumber} queue state updated.`);
      await load();
    } catch (stateError) {
      setError(
        stateError instanceof Error
          ? stateError.message
          : "Could not update the queue agent",
      );
    } finally {
      setBusy("");
    }
  }

  const queueCount =
    data?.groups.filter((group) => group.groupType === "queue").length ?? 0;
  const readyAgents = new Set(
    data?.groups.flatMap((group) =>
      group.members
        .filter(
          (member) =>
            member.signedIn &&
            !member.paused &&
            member.registrationState === "registered",
        )
        .map((member) => member.extensionId),
    ) ?? [],
  ).size;
  const waitingCallers =
    data?.groups.reduce(
      (total, group) =>
        total +
        (group.groupType === "queue" ? group.liveStats.waitingCallers : 0),
      0,
    ) ?? 0;
  const abandonedCalls =
    data?.groups.reduce(
      (total, group) =>
        total +
        (group.groupType === "queue" ? group.liveStats.abandonedCalls : 0),
      0,
    ) ?? 0;
  const strategyName = (strategy: CallGroup["strategy"]) =>
    strategy === "rrmemory"
      ? "Round robin"
      : strategy === "leastrecent"
        ? "Least recent"
        : "Ring all";

  return (
    <>
      <section className="page-intro call-centre-intro">
        <div>
          <span className="eyebrow">HUMAN CALL DISTRIBUTION</span>
          <h2>Route callers to the right available team.</h2>
          <p>
            Build simple ring groups or Asterisk-native queues with hold music,
            retry timing, wrap-up protection and controlled fallback.
          </p>
        </div>
        <div className="call-centre-actions">
          <button
            className="secondary-button"
            disabled={
              !accountData?.extensions.some(
                (item) => item.enabled && !item.agentUserId,
              )
            }
            onClick={createAccountDraft}
          >
            Add agent login
          </button>
          <button
            className="primary-button compact"
            disabled={!data || data.extensions.length === 0}
            onClick={createDraft}
          >
            Add call group
          </button>
        </div>
      </section>
      <section className="pbx-stat-grid call-centre-stat-grid">
        <article>
          <span>CALL GROUPS</span>
          <strong>{data?.groups.length ?? "—"}</strong>
          <small>Internal team destinations</small>
        </article>
        <article>
          <span>QUEUES</span>
          <strong>{data ? queueCount : "—"}</strong>
          <small>Asterisk hold queues</small>
        </article>
        <article>
          <span>WAITING NOW</span>
          <strong>{data ? waitingCallers : "—"}</strong>
          <small>Callers across live queues</small>
        </article>
        <article>
          <span>READY AGENTS</span>
          <strong>{data ? readyAgents : "—"}</strong>
          <small>Signed in, available and registered</small>
        </article>
        <article>
          <span>ABANDONED</span>
          <strong>{data ? abandonedCalls : "—"}</strong>
          <small>Since the current Asterisk session</small>
        </article>
      </section>
      {error && (
        <div className="page-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="studio-notice" role="status">
          <span>{notice}</span>
        </div>
      )}
      {data && data.extensions.length === 0 && (
        <div className="notice warning">
          <strong>Create extensions first</strong>
          <span>A call group requires at least one active PBX extension.</span>
        </div>
      )}
      <section className="panel call-centre-panel">
        <div className="panel-head">
          <div>
            <span>ASTERISK DISTRIBUTION</span>
            <h3>Ring groups and queues</h3>
          </div>
          <span className="secure-pill">LIVE MEMBER READINESS</span>
        </div>
        {!data ? (
          <div className="empty-state history-empty">
            <div className="loader dark" />
            <p>Loading call groups…</p>
          </div>
        ) : data.groups.length === 0 ? (
          <div className="empty-state call-centre-empty">
            <div className="empty-icon">CQ</div>
            <h3>No call groups yet</h3>
            <p>
              Create a test group with extensions 100 and 102, then dial its
              internal number.
            </p>
          </div>
        ) : (
          <div className="call-group-grid">
            {data.groups.map((group) => (
              <article
                className={`call-group-card ${group.enabled ? "" : "disabled"}`}
                key={group.id}
              >
                <div className="call-group-head">
                  <div className="call-group-number">
                    <span>DIAL</span>
                    <strong>{group.internalNumber}</strong>
                  </div>
                  <div>
                    <h4>{group.name}</h4>
                    <span
                      className={`ai-state ${group.enabled ? "active" : ""}`}
                    >
                      <i />
                      {group.enabled ? "ACTIVE" : "DISABLED"}
                    </span>
                  </div>
                  <em>
                    {group.groupType === "queue" ? "QUEUE" : "RING GROUP"}
                  </em>
                </div>
                {group.groupType === "queue" && (
                  <div className="queue-live-grid">
                    <div>
                      <span>WAITING</span>
                      <strong>
                        {group.liveStats.available
                          ? group.liveStats.waitingCallers
                          : "—"}
                      </strong>
                    </div>
                    <div>
                      <span>LONGEST</span>
                      <strong>
                        {group.liveStats.available
                          ? formatDuration(group.liveStats.longestWaitSeconds)
                          : "—"}
                      </strong>
                    </div>
                    <div>
                      <span>ANSWERED</span>
                      <strong>
                        {group.liveStats.available
                          ? group.liveStats.completedCalls
                          : "—"}
                      </strong>
                    </div>
                    <div>
                      <span>ABANDONED</span>
                      <strong>
                        {group.liveStats.available
                          ? group.liveStats.abandonedCalls
                          : "—"}
                      </strong>
                    </div>
                  </div>
                )}
                <dl>
                  <div>
                    <dt>Distribution</dt>
                    <dd>{strategyName(group.strategy)}</dd>
                  </div>
                  <div>
                    <dt>Member ring</dt>
                    <dd>{group.ringTimeoutSeconds}s</dd>
                  </div>
                  {group.groupType === "queue" && (
                    <>
                      <div>
                        <dt>Maximum wait</dt>
                        <dd>{group.maxWaitSeconds}s</dd>
                      </div>
                      <div>
                        <dt>Average hold</dt>
                        <dd>
                          {group.liveStats.available
                            ? formatDuration(group.liveStats.averageHoldSeconds)
                            : "Unavailable"}
                        </dd>
                      </div>
                      <div>
                        <dt>Service level</dt>
                        <dd>
                          {group.liveStats.available
                            ? `${group.liveStats.serviceLevelPercent.toFixed(1)}%`
                            : "Unavailable"}
                        </dd>
                      </div>
                    </>
                  )}
                  <div>
                    <dt>Fallback</dt>
                    <dd>
                      {group.fallbackExtensionNumber
                        ? `Extension ${group.fallbackExtensionNumber}`
                        : "Polite unavailable message"}
                    </dd>
                  </div>
                </dl>
                <div
                  className={`call-group-members ${group.groupType === "queue" ? "agent-console" : ""}`}
                >
                  <div className="member-summary">
                    <span>
                      {group.groupType === "queue" ? "QUEUE AGENTS" : "MEMBERS"}
                    </span>
                    <strong>
                      {group.readyMembers}/{group.members.length} ready
                    </strong>
                  </div>
                  {group.members.map((member) =>
                    group.groupType === "queue" ? (
                      <div
                        className={`queue-agent-row ${!member.signedIn ? "signed-out" : member.paused ? "paused" : member.registrationState === "registered" ? "ready" : "offline"}`}
                        key={member.extensionId}
                      >
                        <div>
                          <i />
                          <span>
                            <strong>
                              {member.extensionNumber} · {member.displayName}
                            </strong>
                            <small>
                              {!member.signedIn
                                ? "Signed out"
                                : member.paused
                                  ? `Paused · ${member.pauseReason ?? "break"}`
                                  : member.registrationState === "registered"
                                    ? "Ready"
                                    : member.registrationState}
                            </small>
                          </span>
                        </div>
                        <div className="queue-agent-controls">
                          {member.signedIn && member.paused && (
                            <select
                              aria-label={`Pause reason for ${member.extensionNumber}`}
                              value={member.pauseReason ?? "break"}
                              disabled={
                                busy ===
                                `agent:${group.id}:${member.extensionId}`
                              }
                              onChange={(event) =>
                                void updateAgent(group, member, {
                                  paused: true,
                                  pauseReason: event.target.value,
                                })
                              }
                            >
                              <option value="break">Break</option>
                              <option value="lunch">Lunch</option>
                              <option value="training">Training</option>
                              <option value="admin">Admin</option>
                            </select>
                          )}
                          {member.signedIn && (
                            <button
                              disabled={
                                busy ===
                                `agent:${group.id}:${member.extensionId}`
                              }
                              onClick={() =>
                                void updateAgent(
                                  group,
                                  member,
                                  member.paused
                                    ? { paused: false, pauseReason: null }
                                    : { paused: true, pauseReason: "break" },
                                )
                              }
                            >
                              {member.paused ? "Resume" : "Pause"}
                            </button>
                          )}
                          <button
                            disabled={
                              busy === `agent:${group.id}:${member.extensionId}`
                            }
                            onClick={() =>
                              void updateAgent(group, member, {
                                signedIn: !member.signedIn,
                                paused: false,
                                pauseReason: null,
                              })
                            }
                          >
                            {member.signedIn ? "Sign out" : "Sign in"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span
                        key={member.extensionId}
                        className={
                          member.registrationState === "registered"
                            ? "ready"
                            : ""
                        }
                      >
                        <i />
                        {member.extensionNumber} · {member.displayName}
                      </span>
                    ),
                  )}
                </div>
                <div className="ai-agent-actions">
                  <button
                    disabled={busy === group.id}
                    onClick={() => void toggle(group)}
                  >
                    {group.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    disabled={busy === group.id}
                    onClick={() => editDraft(group)}
                  >
                    Edit
                  </button>
                  <button
                    className="danger"
                    disabled={busy === group.id}
                    onClick={() => void remove(group)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="panel agent-account-panel">
        <div className="panel-head">
          <div>
            <span>RESTRICTED ACCESS</span>
            <h3>Agent login accounts</h3>
          </div>
          <span className="secure-pill">EXTENSION-BOUND</span>
        </div>
        {!accountData ? (
          <div className="empty-state history-empty">
            <div className="loader dark" />
            <p>Loading agent accounts…</p>
          </div>
        ) : accountData.accounts.length === 0 ? (
          <div className="empty-state agent-account-empty">
            <div className="empty-icon">ID</div>
            <h3>No agent logins yet</h3>
            <p>
              Create a login and bind it to one PBX extension. That user will
              only see the Agent Workspace.
            </p>
            <button
              className="secondary-button"
              disabled={
                !accountData.extensions.some(
                  (item) => item.enabled && !item.agentUserId,
                )
              }
              onClick={createAccountDraft}
            >
              Create first agent login
            </button>
          </div>
        ) : (
          <div className="agent-account-grid">
            {accountData.accounts.map((account) => (
              <article
                className={account.active ? "" : "disabled"}
                key={account.id}
              >
                <div className="agent-account-head">
                  <div className="agent-account-avatar">
                    {account.displayName
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((part) => part[0]?.toUpperCase())
                      .join("") || "AG"}
                  </div>
                  <div>
                    <h4>{account.displayName}</h4>
                    <span>{account.email}</span>
                  </div>
                  <em className={account.active ? "active" : ""}>
                    {account.active ? "ACTIVE" : "DISABLED"}
                  </em>
                </div>
                <dl>
                  <div>
                    <dt>PBX extension</dt>
                    <dd>
                      {account.extensionNumber} · {account.extensionName}
                    </dd>
                  </div>
                  <div>
                    <dt>Queue memberships</dt>
                    <dd>{account.queueCount}</dd>
                  </div>
                  <div>
                    <dt>Workspace</dt>
                    <dd>Agent-only access</dd>
                  </div>
                </dl>
                <div className="ai-agent-actions">
                  <button
                    disabled={busy === `account:${account.id}`}
                    onClick={() => void toggleAccount(account)}
                  >
                    {account.active ? "Disable" : "Enable"}
                  </button>
                  <button
                    disabled={busy === `account:${account.id}`}
                    onClick={() => editAccountDraft(account)}
                  >
                    Edit / password
                  </button>
                  <button
                    className="danger"
                    disabled={busy === `account:${account.id}`}
                    onClick={() => void removeAccount(account)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="pbx-help call-centre-help">
        <div>
          <span>01</span>
          <p>
            <strong>Ring groups</strong> call every selected member together for
            a short team route.
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>Queues</strong> provide hold music and controlled agent
            distribution while callers wait.
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>AI handoff</strong> can transfer callers directly to any
            enabled group.
          </p>
        </div>
      </section>

      {accountDraft && accountData && (
        <Modal
          title={accountDraft.id ? "Edit agent login" : "Create agent login"}
          onClose={() => setAccountDraft(null)}
        >
          <form
            className="modal-form agent-account-form"
            onSubmit={saveAccount}
          >
            <div className="notice">
              <strong>Restricted agent access</strong>
              <span>
                This login opens only the assigned extension's queues, live call
                and daily totals.
              </span>
            </div>
            <label>
              <span>Agent name</span>
              <input
                required
                minLength={2}
                maxLength={100}
                value={accountDraft.displayName}
                onChange={(event) =>
                  setAccountDraft({
                    ...accountDraft,
                    displayName: event.target.value,
                  })
                }
                placeholder="Sales Agent"
              />
            </label>
            <label>
              <span>Email address</span>
              <input
                required
                type="email"
                autoComplete="off"
                value={accountDraft.email}
                onChange={(event) =>
                  setAccountDraft({
                    ...accountDraft,
                    email: event.target.value,
                  })
                }
                placeholder="agent@example.com"
              />
            </label>
            <label>
              <span>Assigned PBX extension</span>
              <select
                required
                value={accountDraft.extensionId}
                onChange={(event) =>
                  setAccountDraft({
                    ...accountDraft,
                    extensionId: event.target.value,
                  })
                }
              >
                <option value="">Choose extension</option>
                {accountData.extensions
                  .filter(
                    (extension) =>
                      extension.enabled &&
                      (!extension.agentUserId ||
                        extension.agentUserId === accountDraft.id),
                  )
                  .map((extension) => (
                    <option key={extension.id} value={extension.id}>
                      {extension.extensionNumber} · {extension.displayName}
                    </option>
                  ))}
              </select>
              <small>One agent login can control one extension.</small>
            </label>
            <label>
              <span>
                {accountDraft.id ? "New password" : "Temporary password"}
              </span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                required={!accountDraft.id}
                value={accountDraft.password}
                onChange={(event) =>
                  setAccountDraft({
                    ...accountDraft,
                    password: event.target.value,
                  })
                }
                placeholder={
                  accountDraft.id
                    ? "Leave blank to keep current password"
                    : "At least 12 characters"
                }
              />
              <small>
                {accountDraft.id
                  ? "Entering a new password signs out existing sessions."
                  : "Give this password directly to the agent."}
              </small>
            </label>
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={accountDraft.active}
                onChange={(event) =>
                  setAccountDraft({
                    ...accountDraft,
                    active: event.target.checked,
                  })
                }
              />
              <span>
                <strong>Allow sign-in</strong>
                <small>
                  Disabled accounts cannot open the Agent Workspace.
                </small>
              </span>
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setAccountDraft(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button compact"
                disabled={busy === "account-save"}
              >
                {busy === "account-save"
                  ? "Saving…"
                  : accountDraft.id
                    ? "Save agent"
                    : "Create agent"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {draft && data && (
        <Modal
          title={draft.id ? "Edit call group" : "Create call group"}
          onClose={() => setDraft(null)}
        >
          <form className="modal-form call-group-form" onSubmit={save}>
            <div className="form-grid">
              <label>
                <span>Group name</span>
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  placeholder="Sales team"
                />
              </label>
              <label>
                <span>Internal test number</span>
                <input
                  required
                  pattern="[0-9]{2,8}"
                  value={draft.internalNumber}
                  onChange={(event) =>
                    setDraft({ ...draft, internalNumber: event.target.value })
                  }
                  placeholder="600"
                />
              </label>
            </div>
            <div className="form-grid">
              <label>
                <span>Destination type</span>
                <select
                  value={draft.groupType}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      groupType: event.target
                        .value as CallGroupDraft["groupType"],
                      strategy:
                        event.target.value === "ring_group"
                          ? "ringall"
                          : draft.strategy,
                    })
                  }
                >
                  <option value="queue">Call queue</option>
                  <option value="ring_group">Ring group</option>
                </select>
                <small>
                  Queues hold callers; ring groups immediately call all members.
                </small>
              </label>
              <label>
                <span>Distribution strategy</span>
                <select
                  value={draft.strategy}
                  disabled={draft.groupType === "ring_group"}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      strategy: event.target
                        .value as CallGroupDraft["strategy"],
                    })
                  }
                >
                  <option value="ringall">Ring all</option>
                  <option value="rrmemory">Round robin</option>
                  <option value="leastrecent">Least recently called</option>
                </select>
              </label>
            </div>
            <div className="form-section">
              <span>TEAM MEMBERS</span>
              <p>
                Select active PBX extensions. Registration readiness is shown
                live.
              </p>
            </div>
            <div className="call-member-picker">
              {data.extensions.map((extension) => (
                <label
                  key={extension.id}
                  className={
                    draft.memberExtensionIds.includes(extension.id)
                      ? "selected"
                      : ""
                  }
                >
                  <input
                    type="checkbox"
                    checked={draft.memberExtensionIds.includes(extension.id)}
                    onChange={() => toggleMember(extension.id)}
                  />
                  <span>
                    <strong>
                      {extension.extensionNumber} · {extension.displayName}
                    </strong>
                    <small>{extension.registrationState}</small>
                  </span>
                </label>
              ))}
            </div>
            <div className="form-section">
              <span>CALL TIMING</span>
              <p>
                Bounded timing prevents callers or agents from remaining stuck
                in a route.
              </p>
            </div>
            <div className="form-grid">
              <label>
                <span>Ring each member</span>
                <select
                  value={draft.ringTimeoutSeconds}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      ringTimeoutSeconds: Number(event.target.value),
                    })
                  }
                >
                  {[10, 15, 20, 25, 30, 45, 60].map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} seconds
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Maximum caller wait</span>
                <select
                  disabled={draft.groupType === "ring_group"}
                  value={draft.maxWaitSeconds}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      maxWaitSeconds: Number(event.target.value),
                    })
                  }
                >
                  {[30, 45, 60, 90, 120, 180, 300].map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} seconds
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Retry interval</span>
                <select
                  disabled={draft.groupType === "ring_group"}
                  value={draft.retrySeconds}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      retrySeconds: Number(event.target.value),
                    })
                  }
                >
                  {[2, 3, 5, 8, 10, 15, 20, 30].map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} seconds
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Agent wrap-up</span>
                <select
                  disabled={draft.groupType === "ring_group"}
                  value={draft.wrapupSeconds}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      wrapupSeconds: Number(event.target.value),
                    })
                  }
                >
                  {[0, 5, 10, 15, 20, 30, 45, 60].map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} seconds
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <span>Unavailable / timeout fallback</span>
              <select
                value={draft.fallbackExtensionId}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    fallbackExtensionId: event.target.value,
                  })
                }
              >
                <option value="">Play unavailable and end call</option>
                {data.extensions.map((extension) => (
                  <option key={extension.id} value={extension.id}>
                    {extension.extensionNumber} · {extension.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) =>
                  setDraft({ ...draft, enabled: event.target.checked })
                }
              />
              <span>
                <strong>Publish this call group</strong>
                <small>
                  Enabled groups are immediately reachable at the internal test
                  number.
                </small>
              </span>
            </label>
            {draft.memberExtensionIds.length === 0 && (
              <div className="form-error" role="alert">
                Select at least one member extension.
              </div>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={
                  busy === "save" || draft.memberExtensionIds.length === 0
                }
              >
                {busy === "save"
                  ? "Publishing…"
                  : draft.id
                    ? "Save group"
                    : "Create group"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function Campaigns() {
  const [data, setData] = useState<CampaignData | null>(null);
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [importCampaign, setImportCampaign] = useState<Campaign | null>(null);
  const [importText, setImportText] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [suppressionPhone, setSuppressionPhone] = useState("");
  const [suppressionReason, setSuppressionReason] = useState<
    "requested" | "manual" | "regulatory"
  >("requested");
  const [suppressionNotes, setSuppressionNotes] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      setData(await api<CampaignData>("/api/campaigns"));
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load campaigns",
      );
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  function destinations(type: CampaignDraft["destinationType"]) {
    return type === "human_queue"
      ? (data?.options.queues ?? [])
      : (data?.options.aiAgents ?? []);
  }

  function createDraft() {
    const destinationType: CampaignDraft["destinationType"] = data?.options
      .queues.length
      ? "human_queue"
      : "ai_receptionist";
    const options =
      destinationType === "human_queue"
        ? (data?.options.queues ?? [])
        : (data?.options.aiAgents ?? []);
    setDraft({
      name: "",
      description: "",
      dialingMode: destinationType === "human_queue" ? "progressive" : "ai",
      destinationType,
      destinationId: options[0]?.id ?? "",
      sipTrunkId: data?.options.trunks[0]?.id ?? "",
      outboundCallerId: "",
      callsPerMinute: 10,
      maxConcurrentCalls: 1,
      maxAttempts: 3,
      retryDelayMinutes: 60,
      callingWindowStart: "08:00",
      callingWindowEnd: "18:00",
      timezone: "Africa/Johannesburg",
      callingDays: [1, 2, 3, 4, 5],
      ringTimeoutSeconds: 45,
      complianceAttested: false,
    });
    setError("");
    setNotice("");
  }

  function editDraft(campaign: Campaign) {
    setDraft({
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      dialingMode: campaign.dialingMode,
      destinationType: campaign.destinationType,
      destinationId: campaign.destinationId,
      sipTrunkId: campaign.sipTrunkId ?? "",
      outboundCallerId: campaign.outboundCallerId ?? "",
      callsPerMinute: campaign.callsPerMinute,
      maxConcurrentCalls: campaign.maxConcurrentCalls,
      maxAttempts: campaign.maxAttempts,
      retryDelayMinutes: campaign.retryDelayMinutes,
      callingWindowStart: campaign.callingWindowStart,
      callingWindowEnd: campaign.callingWindowEnd,
      timezone: campaign.timezone,
      callingDays: campaign.callingDays,
      ringTimeoutSeconds: campaign.ringTimeoutSeconds,
      complianceAttested: campaign.complianceAttested,
    });
    setError("");
    setNotice("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy("campaign-save");
    setError("");
    try {
      await api(draft.id ? `/api/campaigns/${draft.id}` : "/api/campaigns", {
        method: draft.id ? "PATCH" : "POST",
        body: JSON.stringify({
          ...draft,
          sipTrunkId: draft.sipTrunkId || null,
          outboundCallerId: draft.outboundCallerId || null,
        }),
      });
      setDraft(null);
      setNotice(
        draft.id
          ? "Campaign updated and returned to draft review."
          : "Campaign created in draft state.",
      );
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save campaign",
      );
    } finally {
      setBusy("");
    }
  }

  async function changeStatus(campaign: Campaign, status: Campaign["status"]) {
    setBusy(`status:${campaign.id}`);
    setError("");
    try {
      await api(`/api/campaigns/${campaign.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setNotice(
        status === "running"
          ? `${campaign.name} started. Eligible contacts will be called within the configured schedule and pacing limits.`
          : `${campaign.name} changed to ${status}.`,
      );
      await load();
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : "Could not change campaign state",
      );
    } finally {
      setBusy("");
    }
  }

  async function remove(campaign: Campaign) {
    if (
      !window.confirm(
        `Permanently delete “${campaign.name}” and its contact list?`,
      )
    )
      return;
    setBusy(`campaign:${campaign.id}`);
    setError("");
    try {
      await api(`/api/campaigns/${campaign.id}`, { method: "DELETE" });
      setNotice("Campaign and its contacts deleted.");
      if (expandedId === campaign.id) setExpandedId("");
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete campaign",
      );
    } finally {
      setBusy("");
    }
  }

  async function importContacts(event: FormEvent) {
    event.preventDefault();
    if (!importCampaign) return;
    setBusy("contact-import");
    setError("");
    try {
      const result = await api<{
        inserted: number;
        suppressed: number;
        invalid: number;
        duplicates: number;
      }>(`/api/campaigns/${importCampaign.id}/contacts/import`, {
        method: "POST",
        body: JSON.stringify({ contacts: importText }),
      });
      setImportCampaign(null);
      setImportText("");
      setExpandedId(importCampaign.id);
      setNotice(
        `${result.inserted} contacts added · ${result.suppressed} suppressed · ${result.duplicates} duplicates · ${result.invalid} invalid.`,
      );
      await load();
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Could not import contacts",
      );
    } finally {
      setBusy("");
    }
  }

  async function deleteContact(contact: CampaignContact) {
    setBusy(`contact:${contact.id}`);
    setError("");
    try {
      await api(`/api/campaigns/${contact.campaignId}/contacts/${contact.id}`, {
        method: "DELETE",
      });
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete contact",
      );
    } finally {
      setBusy("");
    }
  }

  async function addSuppression(event: FormEvent) {
    event.preventDefault();
    setBusy("suppression-add");
    setError("");
    try {
      await api("/api/campaigns/suppressions", {
        method: "POST",
        body: JSON.stringify({
          phone: suppressionPhone,
          reason: suppressionReason,
          notes: suppressionNotes,
        }),
      });
      setSuppressionPhone("");
      setSuppressionNotes("");
      setNotice(
        "Number added to global suppression. Matching campaign contacts were blocked.",
      );
      await load();
    } catch (suppressionError) {
      setError(
        suppressionError instanceof Error
          ? suppressionError.message
          : "Could not suppress number",
      );
    } finally {
      setBusy("");
    }
  }

  async function removeSuppression(item: CampaignData["suppressions"][number]) {
    if (
      !window.confirm(
        `Remove ${item.phoneE164} from global suppression? Existing suppressed contacts will remain blocked.`,
      )
    )
      return;
    setBusy(`suppression:${item.id}`);
    setError("");
    try {
      await api(`/api/campaigns/suppressions/${item.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmRemoval: true }),
      });
      setNotice(
        "Suppression entry removed. Existing campaign contacts were not automatically reactivated.",
      );
      await load();
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Could not remove suppression",
      );
    } finally {
      setBusy("");
    }
  }

  const totalContacts =
    data?.campaigns.reduce((sum, campaign) => sum + campaign.counts.total, 0) ??
    0;
  const readyContacts =
    data?.campaigns.reduce((sum, campaign) => sum + campaign.counts.ready, 0) ??
    0;
  const readyCampaigns =
    data?.campaigns.filter((campaign) => campaign.status === "ready").length ??
    0;
  const runningCampaigns =
    data?.campaigns.filter((campaign) => campaign.status === "running")
      .length ?? 0;
  const expandedCampaign = data?.campaigns.find(
    (campaign) => campaign.id === expandedId,
  );
  const expandedContacts =
    data?.contacts.filter((contact) => contact.campaignId === expandedId) ?? [];
  const canCreate = Boolean(
    data &&
      (data.options.queues.length > 0 || data.options.aiAgents.length > 0),
  );

  return (
    <>
      <section className="page-intro campaign-intro">
        <div>
          <span className="eyebrow">OUTBOUND CAMPAIGNS</span>
          <h2>Run controlled human and AI calling.</h2>
          <p>
            Validated contacts are paced through your selected trunk and
            delivered to a queue or AI receptionist after answer.
          </p>
        </div>
        <button
          className="primary-button compact"
          disabled={!canCreate}
          onClick={createDraft}
        >
          Add campaign
        </button>
      </section>
      <div className="notice warning campaign-safety-note">
        <strong>Use consented contacts and an authorized caller ID.</strong>
        <span>
          The dialer enforces global suppression, configured calling days and
          hours, retry limits, pacing and immediate pause. Local legal
          requirements remain the operator's responsibility.
        </span>
      </div>
      <section className="pbx-stat-grid campaign-stat-grid">
        <article>
          <span>CAMPAIGNS</span>
          <strong>{data?.campaigns.length ?? "—"}</strong>
          <small>Controlled workflows</small>
        </article>
        <article>
          <span>CONTACTS</span>
          <strong>{data ? totalContacts : "—"}</strong>
          <small>Across all lists</small>
        </article>
        <article>
          <span>READY CONTACTS</span>
          <strong>{data ? readyContacts : "—"}</strong>
          <small>Not globally suppressed</small>
        </article>
        <article>
          <span>READY / RUNNING</span>
          <strong>
            {data ? `${readyCampaigns} / ${runningCampaigns}` : "—"}
          </strong>
          <small>Reviewed and active</small>
        </article>
        <article>
          <span>SUPPRESSED</span>
          <strong>{data?.suppressions.length ?? "—"}</strong>
          <small>Global do-not-call entries</small>
        </article>
      </section>
      {error && (
        <div className="page-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="studio-notice" role="status">
          <span>{notice}</span>
        </div>
      )}
      {data && !canCreate && (
        <div className="notice warning">
          <strong>Create a destination first</strong>
          <span>
            Campaigns require an enabled human queue or AI receptionist.
          </span>
        </div>
      )}
      <section className="panel campaign-panel">
        <div className="panel-head">
          <div>
            <span>CAMPAIGN WORKFLOWS</span>
            <h3>Outbound campaigns</h3>
          </div>
          <span className="secure-pill">DIALER ACTIVE</span>
        </div>
        {!data ? (
          <div className="empty-state history-empty">
            <div className="loader dark" />
            <p>Loading campaigns…</p>
          </div>
        ) : data.campaigns.length === 0 ? (
          <div className="empty-state campaign-empty">
            <div className="empty-icon">CA</div>
            <h3>No campaigns yet</h3>
            <p>
              Create a draft, import international-format contacts, and review
              every safety gate.
            </p>
            <button
              className="secondary-button"
              disabled={!canCreate}
              onClick={createDraft}
            >
              Create first campaign
            </button>
          </div>
        ) : (
          <div className="campaign-grid">
            {data.campaigns.map((campaign) => (
              <article
                className={`campaign-card ${campaign.status}`}
                key={campaign.id}
              >
                <div className="campaign-card-head">
                  <div className="campaign-icon">
                    {campaign.destinationType === "ai_receptionist"
                      ? "AI"
                      : "HU"}
                  </div>
                  <div>
                    <h4>{campaign.name}</h4>
                    <span>{campaign.destinationName}</span>
                  </div>
                  <em>{campaign.status.toUpperCase()}</em>
                </div>
                <p>{campaign.description || "No campaign description."}</p>
                <div className="campaign-progress">
                  <div>
                    <span>READY</span>
                    <strong>{campaign.counts.ready}</strong>
                  </div>
                  <div>
                    <span>ACTIVE</span>
                    <strong>{campaign.counts.active}</strong>
                  </div>
                  <div>
                    <span>DONE</span>
                    <strong>
                      {campaign.counts.completed + campaign.counts.answered}
                    </strong>
                  </div>
                  <div>
                    <span>TOTAL</span>
                    <strong>{campaign.counts.total}</strong>
                  </div>
                </div>
                <dl>
                  <div>
                    <dt>Mode</dt>
                    <dd>{campaign.dialingMode}</dd>
                  </div>
                  <div>
                    <dt>Pacing</dt>
                    <dd>
                      {campaign.callsPerMinute}/min ·{" "}
                      {campaign.maxConcurrentCalls} concurrent
                    </dd>
                  </div>
                  <div>
                    <dt>Retries</dt>
                    <dd>
                      {campaign.maxAttempts} attempts ·{" "}
                      {campaign.retryDelayMinutes} min
                    </dd>
                  </div>
                  <div>
                    <dt>Window</dt>
                    <dd>
                      {campaign.callingWindowStart}–{campaign.callingWindowEnd}{" "}
                      · {campaign.timezone}
                    </dd>
                  </div>
                  <div>
                    <dt>Trunk / caller ID</dt>
                    <dd>
                      {campaign.sipTrunkName && campaign.outboundCallerId
                        ? `${campaign.sipTrunkName} · ${campaign.outboundCallerId}`
                        : "Not ready"}
                    </dd>
                  </div>
                </dl>
                <div className="campaign-actions">
                  <button
                    onClick={() =>
                      setExpandedId(
                        expandedId === campaign.id ? "" : campaign.id,
                      )
                    }
                  >
                    {expandedId === campaign.id ? "Hide list" : "View list"}
                  </button>
                  <button
                    disabled={campaign.status === "running"}
                    onClick={() => {
                      setImportCampaign(campaign);
                      setImportText("");
                    }}
                  >
                    Import contacts
                  </button>
                  {campaign.status === "running" ? (
                    <button
                      disabled={busy === `status:${campaign.id}`}
                      onClick={() => void changeStatus(campaign, "paused")}
                    >
                      Pause now
                    </button>
                  ) : campaign.status === "ready" ||
                    campaign.status === "paused" ? (
                    <button
                      disabled={
                        campaign.dialingMode === "preview" ||
                        busy === `status:${campaign.id}`
                      }
                      title={
                        campaign.dialingMode === "preview"
                          ? "Preview mode requires the later agent-led call workflow"
                          : ""
                      }
                      onClick={() => void changeStatus(campaign, "running")}
                    >
                      {campaign.dialingMode === "preview"
                        ? "Agent-led"
                        : campaign.status === "paused"
                          ? "Resume"
                          : "Start"}
                    </button>
                  ) : campaign.status === "draft" ? (
                    <button
                      disabled={busy === `status:${campaign.id}`}
                      onClick={() => void changeStatus(campaign, "ready")}
                    >
                      Mark ready
                    </button>
                  ) : null}
                  <button
                    disabled={campaign.status === "running"}
                    onClick={() => editDraft(campaign)}
                  >
                    Edit
                  </button>
                  <button
                    className="danger"
                    disabled={
                      campaign.status === "running" ||
                      busy === `campaign:${campaign.id}`
                    }
                    onClick={() => void remove(campaign)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {expandedCampaign && (
        <section className="panel campaign-contacts-panel">
          <div className="panel-head">
            <div>
              <span>CONTACT LIST</span>
              <h3>{expandedCampaign.name}</h3>
            </div>
            <span className="secure-pill">LATEST 200</span>
          </div>
          {expandedContacts.length === 0 ? (
            <div className="empty-state campaign-list-empty">
              <p>No contacts imported yet.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="campaign-contact-table">
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Number</th>
                    <th>Reference</th>
                    <th>Status</th>
                    <th>Last result</th>
                    <th>Attempts</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {expandedContacts.map((contact) => (
                    <tr key={contact.id}>
                      <td>
                        <strong>
                          {`${contact.firstName} ${contact.lastName}`.trim() ||
                            "Unnamed"}
                        </strong>
                      </td>
                      <td>{contact.phoneE164}</td>
                      <td>{contact.externalReference || "—"}</td>
                      <td>
                        <span
                          className={`campaign-contact-state ${contact.status}`}
                        >
                          {contact.status}
                        </span>
                      </td>
                      <td>{contact.lastResult || "—"}</td>
                      <td>{contact.attemptCount}</td>
                      <td>
                        <button
                          disabled={
                            expandedCampaign.status === "running" ||
                            busy === `contact:${contact.id}`
                          }
                          onClick={() => void deleteContact(contact)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <section className="panel suppression-panel">
        <div className="panel-head">
          <div>
            <span>GLOBAL SAFETY LIST</span>
            <h3>Do-not-call suppression</h3>
          </div>
          <span className="secure-pill">ALL CAMPAIGNS</span>
        </div>
        <form className="suppression-form" onSubmit={addSuppression}>
          <input
            required
            value={suppressionPhone}
            onChange={(event) => setSuppressionPhone(event.target.value)}
            placeholder="+27821234567"
          />
          <select
            value={suppressionReason}
            onChange={(event) =>
              setSuppressionReason(
                event.target.value as typeof suppressionReason,
              )
            }
          >
            <option value="requested">Person requested</option>
            <option value="manual">Manual block</option>
            <option value="regulatory">Regulatory list</option>
          </select>
          <input
            value={suppressionNotes}
            maxLength={500}
            onChange={(event) => setSuppressionNotes(event.target.value)}
            placeholder="Optional notes"
          />
          <button
            className="primary-button compact"
            disabled={busy === "suppression-add"}
          >
            {busy === "suppression-add" ? "Adding…" : "Suppress number"}
          </button>
        </form>
        {data && data.suppressions.length > 0 && (
          <div className="suppression-list">
            {data.suppressions.map((item) => (
              <div key={item.id}>
                <span>
                  <strong>{item.phoneE164}</strong>
                  <small>
                    {item.reason}
                    {item.notes ? ` · ${item.notes}` : ""}
                  </small>
                </span>
                <button
                  disabled={busy === `suppression:${item.id}`}
                  onClick={() => void removeSuppression(item)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {draft && data && (
        <Modal
          title={draft.id ? "Edit campaign" : "Create campaign"}
          onClose={() => setDraft(null)}
        >
          <form className="modal-form campaign-form" onSubmit={save}>
            <div className="form-grid">
              <label>
                <span>Campaign name</span>
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  placeholder="Customer follow-up"
                />
              </label>
              <label>
                <span>Campaign mode</span>
                <select
                  value={draft.dialingMode}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      dialingMode: event.target
                        .value as CampaignDraft["dialingMode"],
                    })
                  }
                >
                  {draft.destinationType === "human_queue" ? (
                    <>
                      <option value="progressive">
                        Progressive · automated
                      </option>
                      <option value="preview">Preview · agent-led</option>
                    </>
                  ) : (
                    <option value="ai">AI agent · automated</option>
                  )}
                </select>
              </label>
            </div>
            <label>
              <span>Description</span>
              <textarea
                rows={3}
                maxLength={1000}
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                placeholder="Purpose and audience of this campaign"
              />
            </label>
            <div className="form-section">
              <span>CALL DESTINATION</span>
              <p>
                After the contact answers, Asterisk connects the call to this
                human queue or AI receptionist.
              </p>
            </div>
            <div className="form-grid">
              <label>
                <span>Destination type</span>
                <select
                  value={draft.destinationType}
                  onChange={(event) => {
                    const type = event.target
                      .value as CampaignDraft["destinationType"];
                    setDraft({
                      ...draft,
                      destinationType: type,
                      dialingMode:
                        type === "ai_receptionist" ? "ai" : "progressive",
                      destinationId: destinations(type)[0]?.id ?? "",
                    });
                  }}
                >
                  <option value="human_queue">Human call queue</option>
                  <option value="ai_receptionist">AI receptionist</option>
                </select>
              </label>
              <label>
                <span>Destination</span>
                <select
                  required
                  value={draft.destinationId}
                  onChange={(event) =>
                    setDraft({ ...draft, destinationId: event.target.value })
                  }
                >
                  <option value="">Choose destination</option>
                  {destinations(draft.destinationType).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.internalNumber} · {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-grid">
              <label>
                <span>Outbound SIP trunk</span>
                <select
                  value={draft.sipTrunkId}
                  onChange={(event) =>
                    setDraft({ ...draft, sipTrunkId: event.target.value })
                  }
                >
                  <option value="">Assign later</option>
                  {data.options.trunks.map((trunk) => (
                    <option key={trunk.id} value={trunk.id}>
                      {trunk.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Verified outbound caller ID</span>
                <input
                  value={draft.outboundCallerId}
                  onChange={(event) =>
                    setDraft({ ...draft, outboundCallerId: event.target.value })
                  }
                  placeholder="+27101234567"
                />
                <small>
                  Use only a number authorized by the selected provider.
                </small>
              </label>
            </div>
            <div className="form-section">
              <span>PACING AND RETRIES</span>
              <p>The live dialer never exceeds these configured limits.</p>
            </div>
            <div className="form-grid">
              <label>
                <span>Calls per minute</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={draft.callsPerMinute}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      callsPerMinute: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>Maximum concurrent</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={draft.maxConcurrentCalls}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      maxConcurrentCalls: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>Maximum attempts</span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={draft.maxAttempts}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      maxAttempts: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>Retry delay (minutes)</span>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={draft.retryDelayMinutes}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      retryDelayMinutes: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>Answer timeout</span>
                <select
                  value={draft.ringTimeoutSeconds}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      ringTimeoutSeconds: Number(event.target.value),
                    })
                  }
                >
                  {[20, 30, 45, 60, 90, 120].map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} seconds
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-section">
              <span>CALLING WINDOW</span>
              <p>
                Contacts are processed only on the selected days and during this
                destination-local window.
              </p>
            </div>
            <div className="form-grid">
              <label>
                <span>Start</span>
                <input
                  type="time"
                  required
                  value={draft.callingWindowStart}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      callingWindowStart: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                <span>End</span>
                <input
                  type="time"
                  required
                  value={draft.callingWindowEnd}
                  onChange={(event) =>
                    setDraft({ ...draft, callingWindowEnd: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="campaign-day-picker">
              {[
                [1, "Mon"],
                [2, "Tue"],
                [3, "Wed"],
                [4, "Thu"],
                [5, "Fri"],
                [6, "Sat"],
                [0, "Sun"],
              ].map(([day, label]) => (
                <label
                  className={
                    draft.callingDays.includes(day as number) ? "selected" : ""
                  }
                  key={day}
                >
                  <input
                    type="checkbox"
                    checked={draft.callingDays.includes(day as number)}
                    onChange={() => {
                      const value = day as number;
                      setDraft({
                        ...draft,
                        callingDays: draft.callingDays.includes(value)
                          ? draft.callingDays.filter((item) => item !== value)
                          : [...draft.callingDays, value],
                      });
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <label>
              <span>IANA timezone</span>
              <input
                required
                value={draft.timezone}
                onChange={(event) =>
                  setDraft({ ...draft, timezone: event.target.value })
                }
                placeholder="Africa/Johannesburg"
              />
            </label>
            <div className="notice warning">
              <strong>Configuration confirmation</strong>
              <span>
                This is a technical safeguard, not legal advice. The
                organisation operating the system must verify consent,
                identification, calling-time and suppression requirements for
                every location involved.
              </span>
            </div>
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={draft.complianceAttested}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    complianceAttested: event.target.checked,
                  })
                }
              />
              <span>
                <strong>
                  I confirm this list has an approved calling basis
                </strong>
                <small>Required before the campaign can be marked ready.</small>
              </span>
            </label>
            {draft.callingDays.length === 0 && (
              <div className="form-error" role="alert">
                Choose at least one calling day.
              </div>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={
                  busy === "campaign-save" || draft.callingDays.length === 0
                }
              >
                {busy === "campaign-save"
                  ? "Saving…"
                  : draft.id
                    ? "Save campaign"
                    : "Create draft"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {importCampaign && (
        <Modal
          title={`Import contacts · ${importCampaign.name}`}
          onClose={() => setImportCampaign(null)}
        >
          <form
            className="modal-form campaign-import-form"
            onSubmit={importContacts}
          >
            <div className="notice">
              <strong>International format required</strong>
              <span>
                Enter one contact per line: phone, first name, last name,
                reference. A header row is optional.
              </span>
            </div>
            <textarea
              required
              rows={13}
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={
                "phone,first_name,last_name,reference\n+27821234567,Jane,Doe,crm-1001\n+27829876543,John,Smith,crm-1002"
              }
            />
            <small>
              Maximum 1,000 lines per import. Duplicates are skipped and global
              suppressions are applied immediately.
            </small>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setImportCampaign(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={busy === "contact-import"}
              >
                {busy === "contact-import"
                  ? "Validating…"
                  : "Validate and import"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function Billing({ isOwner }: { isOwner: boolean }) {
  const [data, setData] = useState<BillingData | null>(null);
  const [invoiceData, setInvoiceData] = useState<InvoiceAdminData | null>(null);
  const [draft, setDraft] = useState<BillingDeckDraft | null>(null);
  const [customerRateCardDraft, setCustomerRateCardDraft] =
    useState<CustomerRateCardDraft | null>(null);
  const [invoiceDraft, setInvoiceDraft] = useState<{
    customerId: string;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
  } | null>(null);
  const [paymentDraft, setPaymentDraft] = useState<{
    invoice: InvoiceSummary;
    amount: string;
    reference: string;
  } | null>(null);
  const [importDeck, setImportDeck] = useState<BillingDeck | null>(null);
  const [importText, setImportText] = useState("");
  const [customerImportCard, setCustomerImportCard] =
    useState<CustomerRateCard | null>(null);
  const [customerImportText, setCustomerImportText] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [expandedCustomerRateCardId, setExpandedCustomerRateCardId] =
    useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(showError = true) {
    try {
      const [billing, invoices] = await Promise.all([
        api<BillingData>("/api/billing"),
        api<InvoiceAdminData>("/api/billing/invoices"),
      ]);
      setData(billing);
      setInvoiceData(invoices);
      if (showError) setError("");
    } catch (loadError) {
      if (showError)
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load billing",
        );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function createDraft() {
    const used = new Set(data?.decks.map((deck) => deck.sipTrunkId) ?? []);
    const trunk = data?.trunks.find(
      (item) => item.enabled && !used.has(item.id),
    );
    setDraft({
      name: trunk ? `${trunk.name} rates` : "",
      sipTrunkId: trunk?.id ?? "",
      currency: "ZAR",
      enabled: true,
    });
    setError("");
  }

  function editDraft(deck: BillingDeck) {
    setDraft({
      id: deck.id,
      name: deck.name,
      sipTrunkId: deck.sipTrunkId,
      currency: deck.currency,
      enabled: deck.enabled,
    });
    setError("");
  }

  function createCustomerRateCardDraft() {
    setCustomerRateCardDraft({ name: "", currency: "ZAR", enabled: true });
    setError("");
  }

  function editCustomerRateCardDraft(card: CustomerRateCard) {
    setCustomerRateCardDraft({
      id: card.id,
      name: card.name,
      currency: card.currency,
      enabled: card.enabled,
    });
    setError("");
  }

  function createInvoiceDraft() {
    const today = new Date().toISOString().slice(0, 10);
    const due = new Date();
    due.setUTCDate(due.getUTCDate() + 14);
    const customer =
      invoiceData?.customers.find((item) => item.uninvoicedCalls > 0) ??
      invoiceData?.customers[0];
    setInvoiceDraft({
      customerId: customer?.id ?? "",
      periodStart: `${today.slice(0, 8)}01`,
      periodEnd: today,
      dueDate: due.toISOString().slice(0, 10),
    });
    setError("");
  }

  async function issueInvoice(event: FormEvent) {
    event.preventDefault();
    if (!invoiceDraft) return;
    setBusy("invoice-create");
    setError("");
    try {
      const created = await api<{
        invoiceNumber: string;
        total: number;
        itemCount: number;
      }>("/api/billing/invoices", {
        method: "POST",
        body: JSON.stringify(invoiceDraft),
      });
      setInvoiceDraft(null);
      setNotice(
        `${created.invoiceNumber} issued with ${created.itemCount} rated call${created.itemCount === 1 ? "" : "s"}.`,
      );
      await load();
    } catch (invoiceError) {
      setError(
        invoiceError instanceof Error
          ? invoiceError.message
          : "Could not create invoice",
      );
    } finally {
      setBusy("");
    }
  }

  async function recordPayment(event: FormEvent) {
    event.preventDefault();
    if (!paymentDraft) return;
    setBusy("invoice-payment");
    setError("");
    try {
      const result = await api<{ invoiceNumber: string; status: string }>(
        `/api/billing/invoices/${paymentDraft.invoice.id}/payments`,
        {
          method: "POST",
          body: JSON.stringify({
            amount: Number(paymentDraft.amount),
            reference: paymentDraft.reference,
          }),
        },
      );
      setPaymentDraft(null);
      setNotice(
        `${result.invoiceNumber} payment recorded${result.status === "paid" ? " and invoice settled" : ""}.`,
      );
      await load();
    } catch (paymentError) {
      setError(
        paymentError instanceof Error
          ? paymentError.message
          : "Could not record payment",
      );
    } finally {
      setBusy("");
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy("deck-save");
    setError("");
    try {
      await api(
        draft.id
          ? `/api/billing/rate-decks/${draft.id}`
          : "/api/billing/rate-decks",
        {
          method: draft.id ? "PATCH" : "POST",
          body: JSON.stringify(draft),
        },
      );
      setDraft(null);
      setNotice(
        draft.id
          ? "Rate deck updated."
          : "Rate deck created. Import rates to begin charging calls.",
      );
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the rate deck",
      );
    } finally {
      setBusy("");
    }
  }

  async function remove(deck: BillingDeck) {
    if (
      !window.confirm(
        `Delete ${deck.name}? Existing rated-call amounts will remain in the audit history.`,
      )
    )
      return;
    setBusy(`deck:${deck.id}`);
    setError("");
    try {
      await api(`/api/billing/rate-decks/${deck.id}`, { method: "DELETE" });
      if (expandedId === deck.id) setExpandedId("");
      setNotice(
        "Rate deck deleted. Historical charge snapshots were preserved.",
      );
      await load();
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Could not delete the rate deck",
      );
    } finally {
      setBusy("");
    }
  }

  async function importRates(event: FormEvent) {
    event.preventDefault();
    if (!importDeck) return;
    setBusy("rate-import");
    setError("");
    try {
      const result = await api<{
        inserted: number;
        invalid: number;
        duplicates: number;
      }>(`/api/billing/rate-decks/${importDeck.id}/rates/import`, {
        method: "POST",
        body: JSON.stringify({ rates: importText, replace: true }),
      });
      setImportDeck(null);
      setImportText("");
      setExpandedId(importDeck.id);
      setNotice(
        `${result.inserted} rates imported. ${result.invalid} invalid and ${result.duplicates} duplicate rows skipped.`,
      );
      await load();
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Could not import rates",
      );
    } finally {
      setBusy("");
    }
  }

  async function saveCustomerRateCard(event: FormEvent) {
    event.preventDefault();
    if (!customerRateCardDraft) return;
    setBusy("customer-rate-card-save");
    setError("");
    try {
      await api(
        customerRateCardDraft.id
          ? `/api/billing/customer-rate-cards/${customerRateCardDraft.id}`
          : "/api/billing/customer-rate-cards",
        {
          method: customerRateCardDraft.id ? "PATCH" : "POST",
          body: JSON.stringify(customerRateCardDraft),
        },
      );
      setNotice(
        customerRateCardDraft.id
          ? "Customer rate card updated."
          : "Customer rate card created. Import customer prices next.",
      );
      setCustomerRateCardDraft(null);
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the customer rate card",
      );
    } finally {
      setBusy("");
    }
  }

  async function removeCustomerRateCard(card: CustomerRateCard) {
    if (
      !window.confirm(
        `Delete ${card.name}? Assigned cards must be moved first.`,
      )
    )
      return;
    setBusy(`customer-rate-card:${card.id}`);
    setError("");
    try {
      await api(`/api/billing/customer-rate-cards/${card.id}`, {
        method: "DELETE",
      });
      if (expandedCustomerRateCardId === card.id)
        setExpandedCustomerRateCardId("");
      setNotice(
        "Customer rate card deleted. Historical call charges remain unchanged.",
      );
      await load();
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Could not delete the customer rate card",
      );
    } finally {
      setBusy("");
    }
  }

  async function importCustomerRates(event: FormEvent) {
    event.preventDefault();
    if (!customerImportCard) return;
    setBusy("customer-rate-import");
    setError("");
    try {
      const result = await api<{
        inserted: number;
        invalid: number;
        duplicates: number;
      }>(
        `/api/billing/customer-rate-cards/${customerImportCard.id}/rates/import`,
        {
          method: "POST",
          body: JSON.stringify({ rates: customerImportText, replace: true }),
        },
      );
      setExpandedCustomerRateCardId(customerImportCard.id);
      setCustomerImportCard(null);
      setCustomerImportText("");
      setNotice(
        `${result.inserted} customer prices imported. ${result.invalid} invalid and ${result.duplicates} duplicate rows skipped.`,
      );
      await load();
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Could not import customer prices",
      );
    } finally {
      setBusy("");
    }
  }

  async function rateNow() {
    setBusy("rate-now");
    setError("");
    try {
      const result = await api<{ rated: number; unmatched: number }>(
        "/api/billing/rate-now",
        { method: "POST" },
      );
      setNotice(
        `${result.rated} completed call${result.rated === 1 ? "" : "s"} rated.${result.unmatched ? ` ${result.unmatched} call legs had no matching prefix.` : ""}`,
      );
      await load();
    } catch (ratingError) {
      setError(
        ratingError instanceof Error
          ? ratingError.message
          : "Could not rate completed calls",
      );
    } finally {
      setBusy("");
    }
  }

  const summary = data?.summaries[0];
  const currency = summary?.currency ?? data?.decks[0]?.currency ?? "ZAR";
  const ratedCalls =
    data?.summaries.reduce((sum, item) => sum + item.ratedCalls, 0) ?? 0;
  const availableTrunks = data?.trunks.filter((trunk) => trunk.enabled) ?? [];
  const expandedDeck = data?.decks.find((deck) => deck.id === expandedId);
  const expandedRates =
    data?.rates.filter((rate) => rate.rateDeckId === expandedId) ?? [];
  const expandedCustomerRateCard = data?.customerRateCards.find(
    (card) => card.id === expandedCustomerRateCardId,
  );
  const expandedCustomerRates =
    data?.customerRates.filter(
      (rate) => rate.rateCardId === expandedCustomerRateCardId,
    ) ?? [];

  return (
    <>
      <section className="page-intro billing-intro">
        <div>
          <span className="eyebrow">BILLING AND MARGINS</span>
          <h2>Turn completed calls into auditable charges.</h2>
          <p>
            Assign one rate deck to each provider trunk. Answered calls are
            matched by longest prefix and rated from preserved CDR conversation
            time.
          </p>
        </div>
        <div className="billing-intro-actions">
          <button
            className="secondary-button"
            disabled={busy === "rate-now"}
            onClick={() => void rateNow()}
          >
            {busy === "rate-now" ? "Rating…" : "Rate calls now"}
          </button>
          <button
            className="primary-button compact"
            disabled={
              availableTrunks.length === 0 ||
              availableTrunks.every((trunk) =>
                data?.decks.some((deck) => deck.sipTrunkId === trunk.id),
              )
            }
            onClick={createDraft}
          >
            Add rate deck
          </button>
        </div>
      </section>
      {error && (
        <div className="page-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="studio-notice" role="status">
          <span>{notice}</span>
        </div>
      )}
      {data && data.summaries.length > 1 && (
        <div className="notice warning">
          <strong>Multiple currencies are active</strong>
          <span>
            Summary cards show {currency}. Each charge keeps its own currency
            and is never converted automatically.
          </span>
        </div>
      )}
      <section className="pbx-stat-grid billing-stat-grid">
        <article>
          <span>TODAY'S COST</span>
          <strong>{formatMoney(summary?.todayCost ?? 0, currency)}</strong>
          <small>Provider expense</small>
        </article>
        <article>
          <span>TODAY'S REVENUE</span>
          <strong>{formatMoney(summary?.todayRevenue ?? 0, currency)}</strong>
          <small>Configured sell price</small>
        </article>
        <article>
          <span>TODAY'S MARGIN</span>
          <strong>{formatMoney(summary?.todayMargin ?? 0, currency)}</strong>
          <small>Revenue less provider cost</small>
        </article>
        <article>
          <span>RATED CALLS</span>
          <strong>{ratedCalls}</strong>
          <small>Immutable charge snapshots</small>
        </article>
      </section>
      {isOwner && <PayPalSandboxSettingsPanel />}
      <section className="panel billing-invoices-panel">
        <div className="panel-head">
          <div>
            <span>CUSTOMER INVOICES</span>
            <h3>Statements and payments</h3>
          </div>
          <button
            className="primary-button compact"
            disabled={!invoiceData || invoiceData.customers.length === 0}
            onClick={createInvoiceDraft}
          >
            Create invoice
          </button>
        </div>
        {!invoiceData ? (
          <div className="empty-state">
            <div className="loader dark" />
            <p>Loading invoices…</p>
          </div>
        ) : invoiceData.invoices.length === 0 ? (
          <div className="empty-state billing-invoice-empty">
            <div className="empty-icon">IN</div>
            <h3>No invoices yet</h3>
            <p>
              Create the first customer statement. A zero-usage period is
              allowed.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="billing-table invoice-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th>Due</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoiceData.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <strong>{invoice.invoiceNumber}</strong>
                      <small>
                        {invoice.itemCount} call
                        {invoice.itemCount === 1 ? "" : "s"}
                      </small>
                    </td>
                    <td>
                      <strong>{invoice.customerName}</strong>
                      <small>{invoice.accountNumber}</small>
                    </td>
                    <td>
                      <strong>
                        {invoice.periodStart} – {invoice.periodEnd}
                      </strong>
                      <small>Due {invoice.dueDate}</small>
                    </td>
                    <td>
                      <span className={`invoice-status ${invoice.status}`}>
                        {invoice.status}
                      </span>
                      <small>{invoice.billingMode}</small>
                    </td>
                    <td>{formatMoney(invoice.total, invoice.currency)}</td>
                    <td>{formatMoney(invoice.paidAmount, invoice.currency)}</td>
                    <td>{formatMoney(invoice.balanceDue, invoice.currency)}</td>
                    <td>
                      <div className="invoice-actions">
                        <a
                          className="primary-download"
                          href={`/api/billing/invoices/${invoice.id}/invoice.pdf`}
                        >
                          Download PDF
                        </a>
                        <a
                          href={`/api/billing/invoices/${invoice.id}/statement.csv`}
                        >
                          CSV
                        </a>
                        {invoice.status === "issued" &&
                          invoice.billingMode === "postpaid" && (
                            <button
                              onClick={() => {
                                setPaymentDraft({
                                  invoice,
                                  amount: String(invoice.balanceDue),
                                  reference: "",
                                });
                                setError("");
                              }}
                            >
                              Record payment
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel billing-decks-panel">
        <div className="panel-head">
          <div>
            <span>RATE DECKS</span>
            <h3>Provider pricing</h3>
          </div>
          <span className="secure-pill">LONGEST PREFIX</span>
        </div>
        {!data ? (
          <div className="empty-state">
            <div className="loader dark" />
            <p>Loading billing…</p>
          </div>
        ) : data.decks.length === 0 ? (
          <div className="empty-state billing-empty">
            <div className="empty-icon">BI</div>
            <h3>No provider cost decks yet</h3>
            <p>
              Create a cost deck for Voxbeam or another trunk, then import the
              price charged by that provider.
            </p>
            <button
              className="secondary-button"
              disabled={availableTrunks.length === 0}
              onClick={createDraft}
            >
              Create first cost deck
            </button>
          </div>
        ) : (
          <div className="billing-deck-grid">
            {data.decks.map((deck) => (
              <article
                className={!deck.enabled ? "disabled" : ""}
                key={deck.id}
              >
                <div className="billing-deck-head">
                  <div>PC</div>
                  <span>
                    <strong>{deck.name}</strong>
                    <small>{deck.trunkName}</small>
                  </span>
                  <em className={deck.enabled ? "active" : ""}>
                    {deck.enabled ? "ACTIVE" : "DISABLED"}
                  </em>
                </div>
                <dl>
                  <div>
                    <dt>Currency</dt>
                    <dd>{deck.currency}</dd>
                  </div>
                  <div>
                    <dt>Costs</dt>
                    <dd>{deck.rateCount}</dd>
                  </div>
                  <div>
                    <dt>Matching</dt>
                    <dd>Longest prefix</dd>
                  </div>
                </dl>
                <div className="billing-deck-actions">
                  <button
                    onClick={() =>
                      setExpandedId(expandedId === deck.id ? "" : deck.id)
                    }
                  >
                    {expandedId === deck.id ? "Hide costs" : "View costs"}
                  </button>
                  <button
                    onClick={() => {
                      setImportDeck(deck);
                      setImportText("");
                      setError("");
                    }}
                  >
                    Import CSV
                  </button>
                  <button onClick={() => editDraft(deck)}>Edit</button>
                  <button
                    className="danger"
                    disabled={busy === `deck:${deck.id}`}
                    onClick={() => void remove(deck)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {expandedDeck && (
        <section className="panel billing-rates-panel">
          <div className="panel-head">
            <div>
              <span>PROVIDER COST ENTRIES</span>
              <h3>{expandedDeck.name}</h3>
            </div>
            <span className="secure-pill">PRIVATE COSTS</span>
          </div>
          {expandedRates.length === 0 ? (
            <div className="empty-state billing-rate-empty">
              <p>
                Import provider costs to activate cost and margin calculation
                for this trunk.
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="billing-table">
                <thead>
                  <tr>
                    <th>Prefix</th>
                    <th>Destination</th>
                    <th>Provider cost/min</th>
                    <th>Increment</th>
                    <th>Minimum</th>
                  </tr>
                </thead>
                <tbody>
                  {expandedRates.map((rate) => (
                    <tr key={rate.id}>
                      <td>
                        <strong>{rate.prefix}</strong>
                      </td>
                      <td>{rate.destinationName || "Unnamed"}</td>
                      <td>
                        {formatMoney(rate.costPerMinute, expandedDeck.currency)}
                      </td>
                      <td>{rate.billingIncrementSeconds}s</td>
                      <td>{rate.minimumSeconds}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <section className="panel billing-decks-panel customer-rate-card-admin">
        <div className="panel-head">
          <div>
            <span>CUSTOMER RATE CARDS</span>
            <h3>Independent customer pricing</h3>
          </div>
          <button
            className="primary-button compact"
            onClick={createCustomerRateCardDraft}
          >
            Add customer rate card
          </button>
        </div>
        {!data ? (
          <div className="empty-state">
            <div className="loader dark" />
            <p>Loading customer pricing…</p>
          </div>
        ) : data.customerRateCards.length === 0 ? (
          <div className="empty-state billing-empty">
            <div className="empty-icon">CR</div>
            <h3>No customer rate cards yet</h3>
            <p>
              Create a retail or wholesale price list. It remains separate from
              provider costs.
            </p>
            <button
              className="secondary-button"
              onClick={createCustomerRateCardDraft}
            >
              Create first customer card
            </button>
          </div>
        ) : (
          <div className="billing-deck-grid">
            {data.customerRateCards.map((card) => (
              <article
                className={!card.enabled ? "disabled" : ""}
                key={card.id}
              >
                <div className="billing-deck-head">
                  <div>CR</div>
                  <span>
                    <strong>{card.name}</strong>
                    <small>
                      {card.assignedCustomerCount} assigned customer
                      {card.assignedCustomerCount === 1 ? "" : "s"}
                    </small>
                  </span>
                  <em className={card.enabled ? "active" : ""}>
                    {card.enabled ? "ACTIVE" : "DISABLED"}
                  </em>
                </div>
                <dl>
                  <div>
                    <dt>Currency</dt>
                    <dd>{card.currency}</dd>
                  </div>
                  <div>
                    <dt>Prices</dt>
                    <dd>{card.rateCount}</dd>
                  </div>
                  <div>
                    <dt>Matching</dt>
                    <dd>Longest prefix</dd>
                  </div>
                </dl>
                <div className="billing-deck-actions">
                  <button
                    onClick={() =>
                      setExpandedCustomerRateCardId(
                        expandedCustomerRateCardId === card.id ? "" : card.id,
                      )
                    }
                  >
                    {expandedCustomerRateCardId === card.id
                      ? "Hide prices"
                      : "View prices"}
                  </button>
                  <button
                    onClick={() => {
                      setCustomerImportCard(card);
                      setCustomerImportText("");
                      setError("");
                    }}
                  >
                    Import CSV
                  </button>
                  <button onClick={() => editCustomerRateCardDraft(card)}>
                    Edit
                  </button>
                  <button
                    className="danger"
                    disabled={busy === `customer-rate-card:${card.id}`}
                    onClick={() => void removeCustomerRateCard(card)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {expandedCustomerRateCard && (
        <section className="panel billing-rates-panel">
          <div className="panel-head">
            <div>
              <span>CUSTOMER PRICE ENTRIES</span>
              <h3>{expandedCustomerRateCard.name}</h3>
            </div>
            <span className="secure-pill">CUSTOMER VISIBLE</span>
          </div>
          {expandedCustomerRates.length === 0 ? (
            <div className="empty-state billing-rate-empty">
              <p>
                Import customer prices before assigning this card to an account.
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="billing-table">
                <thead>
                  <tr>
                    <th>Prefix</th>
                    <th>Destination</th>
                    <th>Customer rate/min</th>
                    <th>Increment</th>
                    <th>Minimum</th>
                  </tr>
                </thead>
                <tbody>
                  {expandedCustomerRates.map((rate) => (
                    <tr key={rate.id}>
                      <td>
                        <strong>{rate.prefix}</strong>
                      </td>
                      <td>{rate.destinationName || "Unnamed"}</td>
                      <td>
                        {formatMoney(
                          rate.pricePerMinute,
                          expandedCustomerRateCard.currency,
                        )}
                      </td>
                      <td>{rate.billingIncrementSeconds}s</td>
                      <td>{rate.minimumSeconds}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <section className="panel billing-charges-panel">
        <div className="panel-head">
          <div>
            <span>BILLING CDR ACTIVITY</span>
            <h3>Recent outbound attempts</h3>
          </div>
          <span className="secure-pill">AUTOMATIC</span>
        </div>
        {!data || data.attempts.length === 0 ? (
          <div className="empty-state billing-charge-empty">
            <p>
              Outbound call attempts will appear here, including failed and
              non-chargeable calls.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="billing-table billing-charge-table">
              <thead>
                <tr>
                  <th>Call time</th>
                  <th>Destination</th>
                  <th>Trunk</th>
                  <th>Call status</th>
                  <th>Billing</th>
                  <th>Talk</th>
                  <th>Cost</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.attempts.map((attempt) => {
                  const attemptCurrency = attempt.currency ?? currency;
                  const shownDestination = attempt.destination.startsWith("+")
                    ? attempt.destination
                    : `+${attempt.destination}`;
                  return (
                    <tr key={attempt.id}>
                      <td>
                        <time dateTime={attempt.callStartedAt}>
                          {formatCallTime(attempt.callStartedAt)}
                        </time>
                      </td>
                      <td>
                        <strong>{shownDestination}</strong>
                        <small>From {attempt.source}</small>
                      </td>
                      <td>{attempt.trunkName}</td>
                      <td>
                        <span
                          className={`billing-call-status ${attempt.status}`}
                        >
                          {attempt.status}
                        </span>
                        <small>{attempt.dialStatus ?? "CDR outcome"}</small>
                      </td>
                      <td>
                        <span
                          className={`billing-state ${attempt.billingState}`}
                        >
                          {attempt.billingState.replaceAll("_", " ")}
                        </span>
                        <small>{attempt.billingReason}</small>
                      </td>
                      <td>{formatDuration(attempt.originalBillsec)}</td>
                      <td>
                        {formatMoney(attempt.costAmount, attemptCurrency)}
                      </td>
                      <td>
                        {formatMoney(attempt.sellAmount, attemptCurrency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="pbx-help billing-help">
        <div>
          <span>01</span>
          <p>
            <strong>Only answered calls</strong> with positive conversation time
            are rated; failed attempts remain zero-cost.
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>Longest-prefix matching</strong> selects the most specific
            destination rate.
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>Charge snapshots</strong> remain unchanged when rates are
            edited later.
          </p>
        </div>
      </section>

      {draft && data && (
        <Modal
          title={draft.id ? "Edit rate deck" : "Create rate deck"}
          onClose={() => setDraft(null)}
        >
          <form className="modal-form billing-deck-form" onSubmit={save}>
            <label>
              <span>Rate deck name</span>
              <input
                required
                minLength={2}
                maxLength={100}
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder="Voxbeam standard rates"
              />
            </label>
            <label>
              <span>Provider trunk</span>
              <select
                required
                value={draft.sipTrunkId}
                onChange={(event) =>
                  setDraft({ ...draft, sipTrunkId: event.target.value })
                }
              >
                <option value="">Choose trunk</option>
                {data.trunks.map((trunk) => (
                  <option
                    key={trunk.id}
                    value={trunk.id}
                    disabled={
                      !trunk.enabled ||
                      (!draft.id &&
                        data.decks.some((deck) => deck.sipTrunkId === trunk.id))
                    }
                  >
                    {trunk.name}
                    {trunk.enabled ? "" : " · Disabled"}
                  </option>
                ))}
              </select>
              <small>Each trunk can have one active rate deck.</small>
            </label>
            <label>
              <span>Currency</span>
              <input
                required
                pattern="[A-Za-z]{3}"
                maxLength={3}
                value={draft.currency}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    currency: event.target.value.toUpperCase(),
                  })
                }
                placeholder="ZAR"
              />
              <small>
                Use an ISO three-letter code such as ZAR, USD or GBP.
              </small>
            </label>
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) =>
                  setDraft({ ...draft, enabled: event.target.checked })
                }
              />
              <span>
                <strong>Enable automatic rating</strong>
                <small>
                  Disabled decks preserve existing charges but do not rate new
                  calls.
                </small>
              </span>
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={busy === "deck-save"}
              >
                {busy === "deck-save" ? "Saving…" : "Save rate deck"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {importDeck && (
        <Modal
          title={`Import provider costs · ${importDeck.name}`}
          onClose={() => setImportDeck(null)}
        >
          <form
            className="modal-form billing-import-form"
            onSubmit={importRates}
          >
            <div className="notice">
              <strong>CSV columns</strong>
              <span>
                prefix, destination, cost_per_minute, increment_seconds,
                minimum_seconds
              </span>
            </div>
            <textarea
              required
              rows={14}
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={
                "prefix,destination,cost_per_minute,increment_seconds,minimum_seconds\n27,South Africa,0.50,60,0\n2782,South Africa mobile,0.70,30,30"
              }
            />
            <small>
              This replaces the current provider cost entries. Previously rated
              calls keep their immutable cost snapshot.
            </small>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setImportDeck(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={busy === "rate-import"}
              >
                {busy === "rate-import" ? "Importing…" : "Validate and import"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {customerRateCardDraft && (
        <Modal
          title={
            customerRateCardDraft.id
              ? "Edit customer rate card"
              : "Create customer rate card"
          }
          onClose={() => setCustomerRateCardDraft(null)}
        >
          <form
            className="modal-form billing-deck-form"
            onSubmit={saveCustomerRateCard}
          >
            <div className="notice">
              <strong>Independent customer pricing</strong>
              <span>
                This card contains only the rates charged to customers. Provider
                costs remain in the trunk cost deck.
              </span>
            </div>
            <label>
              <span>Rate card name</span>
              <input
                required
                minLength={2}
                maxLength={100}
                value={customerRateCardDraft.name}
                onChange={(event) =>
                  setCustomerRateCardDraft({
                    ...customerRateCardDraft,
                    name: event.target.value,
                  })
                }
                placeholder="Standard business rates"
              />
            </label>
            <label>
              <span>Currency</span>
              <input
                required
                pattern="[A-Za-z]{3}"
                maxLength={3}
                value={customerRateCardDraft.currency}
                onChange={(event) =>
                  setCustomerRateCardDraft({
                    ...customerRateCardDraft,
                    currency: event.target.value.toUpperCase(),
                  })
                }
                placeholder="ZAR"
              />
            </label>
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={customerRateCardDraft.enabled}
                onChange={(event) =>
                  setCustomerRateCardDraft({
                    ...customerRateCardDraft,
                    enabled: event.target.checked,
                  })
                }
              />
              <span>
                <strong>Enable customer pricing</strong>
                <small>
                  Only enabled cards can authorize and rate new customer calls.
                </small>
              </span>
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setCustomerRateCardDraft(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={busy === "customer-rate-card-save"}
              >
                {busy === "customer-rate-card-save"
                  ? "Saving…"
                  : "Save customer card"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {customerImportCard && (
        <Modal
          title={`Import customer prices · ${customerImportCard.name}`}
          onClose={() => setCustomerImportCard(null)}
        >
          <form
            className="modal-form billing-import-form"
            onSubmit={importCustomerRates}
          >
            <div className="notice">
              <strong>CSV columns</strong>
              <span>
                prefix, destination, price_per_minute, increment_seconds,
                minimum_seconds
              </span>
            </div>
            <textarea
              required
              rows={14}
              value={customerImportText}
              onChange={(event) => setCustomerImportText(event.target.value)}
              placeholder={
                "prefix,destination,price_per_minute,increment_seconds,minimum_seconds\n27,South Africa,0.80,60,0\n2782,South Africa mobile,1.10,30,30"
              }
            />
            <small>
              This replaces the card's customer prices. Historical calls and
              invoices keep their original charged amount.
            </small>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setCustomerImportCard(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={busy === "customer-rate-import"}
              >
                {busy === "customer-rate-import"
                  ? "Importing…"
                  : "Validate and import"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {invoiceDraft && invoiceData && (
        <Modal
          title="Create customer invoice"
          onClose={() => setInvoiceDraft(null)}
        >
          <form className="modal-form invoice-form" onSubmit={issueInvoice}>
            <div className="notice">
              <strong>Immutable customer statement</strong>
              <span>
                Uninvoiced rated calls in the inclusive date range are added. If
                there are none, a valid zero-usage statement is created.
              </span>
            </div>
            <label>
              <span>Customer</span>
              <select
                required
                value={invoiceDraft.customerId}
                onChange={(event) =>
                  setInvoiceDraft({
                    ...invoiceDraft,
                    customerId: event.target.value,
                  })
                }
              >
                <option value="">Choose customer</option>
                {invoiceData.customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} · {customer.accountNumber} ·{" "}
                    {customer.uninvoicedCalls} uninvoiced call
                    {customer.uninvoicedCalls === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                <span>Period start</span>
                <input
                  required
                  type="date"
                  value={invoiceDraft.periodStart}
                  onChange={(event) =>
                    setInvoiceDraft({
                      ...invoiceDraft,
                      periodStart: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                <span>Period end</span>
                <input
                  required
                  type="date"
                  min={invoiceDraft.periodStart}
                  value={invoiceDraft.periodEnd}
                  onChange={(event) =>
                    setInvoiceDraft({
                      ...invoiceDraft,
                      periodEnd: event.target.value,
                    })
                  }
                />
              </label>
            </div>
            <label>
              <span>Due date</span>
              <input
                required
                type="date"
                value={invoiceDraft.dueDate}
                onChange={(event) =>
                  setInvoiceDraft({
                    ...invoiceDraft,
                    dueDate: event.target.value,
                  })
                }
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setInvoiceDraft(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={busy === "invoice-create"}
              >
                {busy === "invoice-create" ? "Creating…" : "Create invoice"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {paymentDraft && (
        <Modal
          title={`Record payment · ${paymentDraft.invoice.invoiceNumber}`}
          onClose={() => setPaymentDraft(null)}
        >
          <form className="modal-form" onSubmit={recordPayment}>
            <div className="notice">
              <strong>Remaining balance</strong>
              <span>
                {formatMoney(
                  paymentDraft.invoice.balanceDue,
                  paymentDraft.invoice.currency,
                )}{" "}
                · Payment credits the customer's postpaid wallet.
              </span>
            </div>
            <label>
              <span>Amount</span>
              <input
                required
                type="number"
                min="0.000001"
                max={paymentDraft.invoice.balanceDue}
                step="0.000001"
                value={paymentDraft.amount}
                onChange={(event) =>
                  setPaymentDraft({
                    ...paymentDraft,
                    amount: event.target.value,
                  })
                }
              />
            </label>
            <label>
              <span>Payment reference</span>
              <input
                required
                minLength={2}
                maxLength={120}
                value={paymentDraft.reference}
                onChange={(event) =>
                  setPaymentDraft({
                    ...paymentDraft,
                    reference: event.target.value,
                  })
                }
                placeholder="EFT reference or receipt number"
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPaymentDraft(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={busy === "invoice-payment"}
              >
                {busy === "invoice-payment" ? "Posting…" : "Record payment"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function Customers() {
  type Customer = CustomerAdminData["customers"][number];
  type ServicePlan = CustomerAdminData["servicePlans"][number];
  type Draft = {
    id?: string;
    name: string;
    billingEmail: string;
    currency: string;
    accountType: "retail" | "wholesale";
    billingMode: "prepaid" | "postpaid";
    creditLimit: string;
    active: boolean;
    customerRateCardId: string;
    servicePlanId: string;
    extensionRangeStart: string;
    extensionRangeEnd: string;
    loginDisplayName: string;
    loginEmail: string;
    loginPassword: string;
  };
  type PlanDraft = Omit<ServicePlan, "id" | "customerCount"> & { id?: string };
  const [data, setData] = useState<CustomerAdminData | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [services, setServices] = useState<{
    customer: Customer;
    extensionIds: string[];
    didRouteIds: string[];
  } | null>(null);
  const [wallet, setWallet] = useState<{
    customer: Customer;
    amount: string;
    note: string;
  } | null>(null);
  const [password, setPassword] = useState<{
    customer: Customer;
    value: string;
  } | null>(null);
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      setData(await api<CustomerAdminData>("/api/customers"));
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load customers",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function createCustomer() {
    setDraft({
      name: "",
      billingEmail: "",
      currency: "ZAR",
      accountType: "retail",
      billingMode: "prepaid",
      creditLimit: "0",
      active: true,
      customerRateCardId:
        data?.rateCards.find((card) => card.enabled && card.currency === "ZAR")
          ?.id ?? "",
      servicePlanId: data?.servicePlans.find((plan) => plan.enabled)?.id ?? "",
      extensionRangeStart: "",
      extensionRangeEnd: "",
      loginDisplayName: "",
      loginEmail: "",
      loginPassword: "",
    });
    setError("");
  }

  function editCustomer(customer: Customer) {
    setDraft({
      id: customer.id,
      name: customer.name,
      billingEmail: customer.billingEmail,
      currency: customer.currency,
      accountType: customer.accountType,
      billingMode: customer.billingMode,
      creditLimit: String(customer.creditLimit),
      active: customer.active,
      customerRateCardId: customer.customerRateCardId ?? "",
      servicePlanId: customer.servicePlanId ?? "",
      extensionRangeStart:
        customer.extensionRangeStart === null
          ? ""
          : String(customer.extensionRangeStart),
      extensionRangeEnd:
        customer.extensionRangeEnd === null
          ? ""
          : String(customer.extensionRangeEnd),
      loginDisplayName: "",
      loginEmail: "",
      loginPassword: "",
    });
    setError("");
  }

  function editServices(customer: Customer) {
    setServices({
      customer,
      extensionIds:
        data?.extensions
          .filter((item) => item.customerId === customer.id)
          .map((item) => item.id) ?? [],
      didRouteIds:
        data?.dids
          .filter((item) => item.customerId === customer.id)
          .map((item) => item.id) ?? [],
    });
    setError("");
  }

  async function saveCustomer(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy("customer");
    setError("");
    try {
      const payload = {
        ...draft,
        creditLimit: Number(draft.creditLimit || 0),
        extensionRangeStart:
          draft.extensionRangeStart === ""
            ? null
            : Number(draft.extensionRangeStart),
        extensionRangeEnd:
          draft.extensionRangeEnd === ""
            ? null
            : Number(draft.extensionRangeEnd),
      };
      await api(draft.id ? `/api/customers/${draft.id}` : "/api/customers", {
        method: draft.id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      setNotice(
        draft.id
          ? "Customer account updated."
          : "Customer and isolated portal login created.",
      );
      setDraft(null);
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the customer",
      );
    } finally {
      setBusy("");
    }
  }

  function newPlan() {
    setPlanDraft({
      name: "",
      description: "",
      maxExtensions: 10,
      maxDids: 5,
      recordingStorageMb: 1024,
      maxAiReceptionists: 1,
      maxCampaigns: 1,
      selfServiceExtensions: true,
      recordingEnabled: true,
      aiReceptionistEnabled: true,
      campaignsEnabled: true,
      enabled: true,
    });
    setError("");
  }

  function editPlan(plan: ServicePlan) {
    const { id, customerCount: _customerCount, ...values } = plan;
    setPlanDraft({ id, ...values });
    setError("");
  }

  async function savePlan(event: FormEvent) {
    event.preventDefault();
    if (!planDraft) return;
    setBusy("plan");
    setError("");
    try {
      await api(
        planDraft.id
          ? `/api/customer-plans/${planDraft.id}`
          : "/api/customer-plans",
        {
          method: planDraft.id ? "PATCH" : "POST",
          body: JSON.stringify(planDraft),
        },
      );
      setNotice(
        planDraft.id ? "Service plan updated." : "Service plan created.",
      );
      setPlanDraft(null);
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the service plan",
      );
    } finally {
      setBusy("");
    }
  }

  async function deletePlan(plan: ServicePlan) {
    if (!window.confirm(`Delete service plan ${plan.name}?`)) return;
    setBusy(`delete-plan-${plan.id}`);
    setError("");
    try {
      await api(`/api/customer-plans/${plan.id}`, { method: "DELETE" });
      setNotice("Service plan deleted.");
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete the service plan",
      );
    } finally {
      setBusy("");
    }
  }

  async function saveServices(event: FormEvent) {
    event.preventDefault();
    if (!services) return;
    setBusy("services");
    setError("");
    try {
      await api(`/api/customers/${services.customer.id}/services`, {
        method: "PUT",
        body: JSON.stringify({
          extensionIds: services.extensionIds,
          didRouteIds: services.didRouteIds,
        }),
      });
      setNotice(`Services assigned to ${services.customer.name}.`);
      setServices(null);
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not assign services",
      );
    } finally {
      setBusy("");
    }
  }

  async function postWallet(event: FormEvent) {
    event.preventDefault();
    if (!wallet) return;
    setBusy("wallet");
    setError("");
    try {
      await api(`/api/customers/${wallet.customer.id}/wallet-transactions`, {
        method: "POST",
        body: JSON.stringify({
          amount: Number(wallet.amount),
          note: wallet.note,
        }),
      });
      setNotice(`Wallet transaction posted for ${wallet.customer.name}.`);
      setWallet(null);
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not post the wallet transaction",
      );
    } finally {
      setBusy("");
    }
  }

  async function resetCustomerPassword(event: FormEvent) {
    event.preventDefault();
    if (!password) return;
    setBusy("password");
    setError("");
    try {
      await api(`/api/customers/${password.customer.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: password.value }),
      });
      setNotice(
        `Portal password reset for ${password.customer.name}. Existing sessions were signed out.`,
      );
      setPassword(null);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not reset the password",
      );
    } finally {
      setBusy("");
    }
  }

  const activeCustomers =
    data?.customers.filter((customer) => customer.active).length ?? 0;
  const prepaidCustomers =
    data?.customers.filter((customer) => customer.billingMode === "prepaid")
      .length ?? 0;
  const assignedExtensions =
    data?.extensions.filter((extension) => extension.customerId).length ?? 0;
  const primaryCurrency = data?.customers[0]?.currency ?? "ZAR";
  const totalBalance =
    data?.customers
      .filter((customer) => customer.currency === primaryCurrency)
      .reduce((sum, customer) => sum + customer.balance, 0) ?? 0;

  return (
    <>
      <section className="page-intro customer-intro">
        <div>
          <span className="eyebrow">TENANT ACCOUNTS</span>
          <h2>Give each customer a private communications portal.</h2>
          <p>
            Customer logins are separated from the administrator control centre.
            Assign their services and customer-visible selling rate card without
            exposing provider costs.
          </p>
        </div>
        <button className="primary-button compact" onClick={createCustomer}>
          Add customer
        </button>
      </section>
      {error && (
        <div className="page-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="studio-notice" role="status">
          <span>{notice}</span>
        </div>
      )}
      <section className="pbx-stat-grid customer-stat-grid">
        <article>
          <span>ACTIVE CUSTOMERS</span>
          <strong>{activeCustomers}</strong>
          <small>{data?.customers.length ?? 0} total accounts</small>
        </article>
        <article>
          <span>PREPAID</span>
          <strong>{prepaidCustomers}</strong>
          <small>
            Postpaid: {(data?.customers.length ?? 0) - prepaidCustomers}
          </small>
        </article>
        <article>
          <span>ASSIGNED EXTENSIONS</span>
          <strong>{assignedExtensions}</strong>
          <small>{data?.extensions.length ?? 0} PBX extensions</small>
        </article>
        <article>
          <span>WALLET BALANCE</span>
          <strong>{formatMoney(totalBalance, primaryCurrency)}</strong>
          <small>{primaryCurrency} accounts</small>
        </article>
      </section>
      <section className="panel customer-list-panel">
        <div className="panel-head">
          <div>
            <span>SERVICE ENTITLEMENTS</span>
            <h3>Customer service plans</h3>
          </div>
          <button className="secondary-button compact" onClick={newPlan}>
            Add service plan
          </button>
        </div>
        {!data ? (
          <div className="empty-state">
            <div className="loader dark" />
          </div>
        ) : data.servicePlans.length === 0 ? (
          <div className="empty-state">
            <p>No service plans yet.</p>
            <button className="secondary-button" onClick={newPlan}>
              Create first plan
            </button>
          </div>
        ) : (
          <div className="billing-deck-grid">
            {data.servicePlans.map((plan) => (
              <article className="customer-plan-card" key={plan.id}>
                <div className="customer-plan-card-head">
                  <div>
                    <span className={plan.enabled ? "active" : "disabled"}>
                      {plan.enabled ? "ACTIVE PLAN" : "DISABLED PLAN"}
                    </span>
                    <h4>{plan.name}</h4>
                  </div>
                  <em className={plan.enabled ? "active" : "disabled"}>
                    {plan.customerCount} customer
                    {plan.customerCount === 1 ? "" : "s"}
                  </em>
                </div>
                <p>{plan.description || "No description"}</p>
                <dl>
                  <div>
                    <dt>Extensions</dt>
                    <dd>{plan.maxExtensions}</dd>
                  </div>
                  <div>
                    <dt>DIDs</dt>
                    <dd>{plan.maxDids}</dd>
                  </div>
                  <div>
                    <dt>Recording</dt>
                    <dd>
                      {plan.recordingEnabled
                        ? `${plan.recordingStorageMb} MB`
                        : "Not included"}
                    </dd>
                  </div>
                  <div>
                    <dt>AI / campaigns</dt>
                    <dd>
                      {plan.maxAiReceptionists} / {plan.maxCampaigns}
                    </dd>
                  </div>
                </dl>
                <small>
                  {plan.selfServiceExtensions
                    ? "Customer extension self-service enabled"
                    : "Extensions managed by administrator"}
                </small>
                <div className="billing-deck-actions">
                  <button onClick={() => editPlan(plan)}>Edit</button>
                  <button
                    className="danger-link"
                    disabled={
                      plan.customerCount > 0 ||
                      busy === `delete-plan-${plan.id}`
                    }
                    title={
                      plan.customerCount > 0
                        ? "Reassign its customers before deleting this plan"
                        : ""
                    }
                    onClick={() => void deletePlan(plan)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="panel customer-list-panel">
        <div className="panel-head">
          <div>
            <span>CUSTOMER DIRECTORY</span>
            <h3>Portal tenants</h3>
          </div>
          <span className="secure-pill">STRICTLY ISOLATED</span>
        </div>
        {!data ? (
          <div className="empty-state">
            <div className="loader dark" />
            <p>Loading customer accounts…</p>
          </div>
        ) : data.customers.length === 0 ? (
          <div className="empty-state customer-empty">
            <div className="empty-icon">CU</div>
            <h3>No customer accounts yet</h3>
            <p>Create the first customer, portal login and wallet.</p>
            <button className="secondary-button" onClick={createCustomer}>
              Create first customer
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="customer-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Login</th>
                  <th>Billing</th>
                  <th>Balance</th>
                  <th>Services</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.customers.map((customer) => {
                  const account = data.accounts.find(
                    (item) => item.customerId === customer.id,
                  );
                  return (
                    <tr key={customer.id}>
                      <td>
                        <strong>{customer.name}</strong>
                        <small>
                          {customer.accountNumber} · {customer.billingEmail}
                        </small>
                        {customer.parentCustomerName && <small>Reseller: {customer.parentCustomerName}</small>}
                      </td>
                      <td>
                        <strong>{account?.displayName ?? "No login"}</strong>
                        <small>{account?.email ?? "Unavailable"}</small>
                      </td>
                      <td>
                        <span
                          className={`customer-mode ${customer.billingMode}`}
                        >
                          {customer.billingMode}
                        </span>
                        <small>
                          {customer.accountType === "wholesale"
                            ? "Wholesale"
                            : "Standard"}{" "}
                          ·{" "}
                          {customer.customerRateCardName ??
                            "No customer rate card"}
                        </small>
                      </td>
                      <td>
                        <strong>
                          {formatMoney(customer.balance, customer.currency)}
                        </strong>
                        <small>
                          {customer.billingMode === "postpaid"
                            ? `${formatMoney(customer.creditLimit, customer.currency)} credit`
                            : "Current wallet"}
                        </small>
                      </td>
                      <td>
                        <strong>
                          {customer.extensionCount} ext · {customer.didCount}{" "}
                          DID
                        </strong>
                        <small>
                          {customer.servicePlanName ?? "No service plan"}
                          {customer.extensionRangeStart === null
                            ? ""
                            : ` · ${customer.extensionRangeStart}–${customer.extensionRangeEnd}`}
                        </small>
                      </td>
                      <td>
                        <span
                          className={`customer-status ${customer.active ? "active" : "disabled"}`}
                        >
                          {customer.active ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td>
                        <div className="customer-actions">
                          <button onClick={() => editCustomer(customer)}>
                            Edit
                          </button>
                          <button onClick={() => editServices(customer)}>
                            Services
                          </button>
                          <button
                            onClick={() => {
                              setWallet({ customer, amount: "", note: "" });
                              setError("");
                            }}
                          >
                            Wallet
                          </button>
                          <button
                            onClick={() => {
                              setPassword({ customer, value: "" });
                              setError("");
                            }}
                          >
                            Password
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {data && data.transactions.length > 0 && (
        <section className="panel customer-ledger-panel">
          <div className="panel-head">
            <div>
              <span>IMMUTABLE LEDGER</span>
              <h3>Recent wallet transactions</h3>
            </div>
            <span className="secure-pill">AUDITED</span>
          </div>
          <div className="table-wrap">
            <table className="customer-ledger-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Note</th>
                  <th>Amount</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.slice(0, 25).map((transaction) => {
                  const customer = data.customers.find(
                    (item) => item.id === transaction.customerId,
                  );
                  const currency = transaction.currency;
                  return (
                    <tr key={transaction.id}>
                      <td>{formatCallTime(transaction.createdAt)}</td>
                      <td>{customer?.name ?? "Deleted customer"}</td>
                      <td>
                        <span className="ledger-type">{transaction.type}</span>
                      </td>
                      <td>{transaction.note}</td>
                      <td
                        className={
                          transaction.amount >= 0 ? "positive" : "negative"
                        }
                      >
                        {transaction.amount >= 0 ? "+" : ""}
                        {formatMoney(transaction.amount, currency)}
                      </td>
                      <td>{formatMoney(transaction.balanceAfter, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="pbx-help customer-help">
        <div>
          <span>01</span>
          <p>
            <strong>Portal isolation</strong> is enforced by the authenticated
            customer ID on every customer API request.
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>Service assignments</strong> prevent an extension or DID
            from belonging to two customers.
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>Wallet entries</strong> are append-only and cannot be edited
            or deleted.
          </p>
        </div>
      </section>

      {planDraft && (
        <Modal title={planDraft.id ? "Edit service plan" : "Create service plan"} onClose={() => setPlanDraft(null)}>
          <form className="modal-form" onSubmit={savePlan}>
            <label><span>Plan name</span><input required minLength={2} maxLength={100} value={planDraft.name} onChange={(event) => setPlanDraft({ ...planDraft, name: event.target.value })} placeholder="Business Plus" /></label>
            <label><span>Description</span><textarea maxLength={500} rows={3} value={planDraft.description} onChange={(event) => setPlanDraft({ ...planDraft, description: event.target.value })} placeholder="Customer-facing summary of included services" /></label>
            <div className="form-grid">
              <label><span>Maximum extensions</span><input required type="number" min="0" max="10000" value={planDraft.maxExtensions} onChange={(event) => setPlanDraft({ ...planDraft, maxExtensions: Number(event.target.value) })} /></label>
              <label><span>Maximum DIDs</span><input required type="number" min="0" max="10000" value={planDraft.maxDids} onChange={(event) => setPlanDraft({ ...planDraft, maxDids: Number(event.target.value) })} /></label>
              <label><span>Recording storage (MB)</span><input required type="number" min="0" max="10000000" disabled={!planDraft.recordingEnabled} value={planDraft.recordingStorageMb} onChange={(event) => setPlanDraft({ ...planDraft, recordingStorageMb: Number(event.target.value) })} /></label>
              <label><span>AI receptionists</span><input required type="number" min="0" max="1000" disabled={!planDraft.aiReceptionistEnabled} value={planDraft.maxAiReceptionists} onChange={(event) => setPlanDraft({ ...planDraft, maxAiReceptionists: Number(event.target.value) })} /></label>
              <label><span>Campaigns</span><input required type="number" min="0" max="1000" disabled={!planDraft.campaignsEnabled} value={planDraft.maxCampaigns} onChange={(event) => setPlanDraft({ ...planDraft, maxCampaigns: Number(event.target.value) })} /></label>
            </div>
            <label className="toggle-field"><input type="checkbox" checked={planDraft.selfServiceExtensions} onChange={(event) => setPlanDraft({ ...planDraft, selfServiceExtensions: event.target.checked })} /><span><strong>Extension self-service</strong><small>Customers can provision from their assigned number range.</small></span></label>
            <label className="toggle-field"><input type="checkbox" checked={planDraft.recordingEnabled} onChange={(event) => setPlanDraft({ ...planDraft, recordingEnabled: event.target.checked, recordingStorageMb: event.target.checked ? Math.max(1, planDraft.recordingStorageMb) : 0 })} /><span><strong>Call recording</strong><small>Allows recording controls in the customer portal.</small></span></label>
            <label className="toggle-field"><input type="checkbox" checked={planDraft.aiReceptionistEnabled} onChange={(event) => setPlanDraft({ ...planDraft, aiReceptionistEnabled: event.target.checked, maxAiReceptionists: event.target.checked ? Math.max(1, planDraft.maxAiReceptionists) : 0 })} /><span><strong>AI receptionist</strong><small>Reserves the configured AI agent allowance.</small></span></label>
            <label className="toggle-field"><input type="checkbox" checked={planDraft.campaignsEnabled} onChange={(event) => setPlanDraft({ ...planDraft, campaignsEnabled: event.target.checked, maxCampaigns: event.target.checked ? Math.max(1, planDraft.maxCampaigns) : 0 })} /><span><strong>Campaigns</strong><small>Reserves the configured campaign allowance.</small></span></label>
            <label className="toggle-field"><input type="checkbox" checked={planDraft.enabled} onChange={(event) => setPlanDraft({ ...planDraft, enabled: event.target.checked })} /><span><strong>Plan enabled</strong><small>Only enabled plans may be assigned or used for tenant actions.</small></span></label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPlanDraft(null)}>Cancel</button><button className="primary-button" disabled={busy === "plan"}>{busy === "plan" ? "Saving…" : "Save service plan"}</button></div>
          </form>
        </Modal>
      )}
      {draft && data && (
        <Modal
          title={draft.id ? "Edit customer" : "Create customer and login"}
          onClose={() => setDraft(null)}
        >
          <form className="modal-form customer-form" onSubmit={saveCustomer}>
            <div className="form-section">
              <span>ORGANISATION</span>
              <p>
                This identity owns the portal, wallet and assigned PBX services.
              </p>
            </div>
            <label>
              <span>Customer name</span>
              <input
                required
                minLength={2}
                maxLength={120}
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder="Example Telecom"
              />
            </label>
            <label>
              <span>Billing email</span>
              <input
                required
                type="email"
                value={draft.billingEmail}
                onChange={(event) =>
                  setDraft({ ...draft, billingEmail: event.target.value })
                }
                placeholder="billing@example.com"
              />
            </label>
            <label>
              <span>Customer type</span>
              <select
                value={draft.accountType}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    accountType: event.target.value as "retail" | "wholesale",
                  })
                }
              >
                <option value="retail">Standard business customer</option>
                <option value="wholesale">Wholesale / reseller customer</option>
              </select>
              <small>
                Wholesale customers see their charged prices as buying rates.
              </small>
            </label>
            <div className="form-grid">
              <label>
                <span>Currency</span>
                <input
                  required
                  pattern="[A-Za-z]{3}"
                  maxLength={3}
                  value={draft.currency}
                  onChange={(event) => {
                    const currency = event.target.value.toUpperCase();
                    const selected = data.rateCards.find(
                      (card) => card.id === draft.customerRateCardId,
                    );
                    setDraft({
                      ...draft,
                      currency,
                      customerRateCardId:
                        selected && selected.currency !== currency
                          ? ""
                          : draft.customerRateCardId,
                    });
                  }}
                />
              </label>
              <label>
                <span>Billing mode</span>
                <select
                  value={draft.billingMode}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      billingMode: event.target.value as "prepaid" | "postpaid",
                      creditLimit:
                        event.target.value === "prepaid"
                          ? "0"
                          : draft.creditLimit,
                    })
                  }
                >
                  <option value="prepaid">Prepaid wallet</option>
                  <option value="postpaid">Postpaid credit</option>
                </select>
              </label>
            </div>
            <label>
              <span>Customer rate card</span>
              <select
                value={draft.customerRateCardId}
                onChange={(event) =>
                  setDraft({ ...draft, customerRateCardId: event.target.value })
                }
              >
                <option value="">No rate card assigned</option>
                {data.rateCards
                  .filter((card) => card.currency === draft.currency)
                  .map((card) => (
                    <option
                      key={card.id}
                      value={card.id}
                      disabled={!card.enabled}
                    >
                      {card.name} · {card.rateCount} rates
                      {card.enabled ? "" : " · Disabled"}
                    </option>
                  ))}
              </select>
              <small>
                This independent card defines the rates visible and charged to
                the customer. Provider costs and margins remain private.
              </small>
            </label>
            <div className="form-section">
              <span>SERVICE PLAN</span>
              <p>Controls tenant quotas and the PBX features available in the customer portal.</p>
            </div>
            <label>
              <span>Service plan</span>
              <select required value={draft.servicePlanId} onChange={(event) => setDraft({ ...draft, servicePlanId: event.target.value })}>
                <option value="">Choose service plan</option>
                {data.servicePlans.map((plan) => <option key={plan.id} value={plan.id} disabled={!plan.enabled}>{plan.name} · {plan.maxExtensions} ext · {plan.maxDids} DID{plan.enabled ? "" : " · Disabled"}</option>)}
              </select>
            </label>
            <div className="form-grid">
              <label><span>Extension range start</span><input inputMode="numeric" pattern="[0-9]{2,8}" value={draft.extensionRangeStart} onChange={(event) => setDraft({ ...draft, extensionRangeStart: event.target.value })} placeholder="200" /></label>
              <label><span>Extension range end</span><input inputMode="numeric" pattern="[0-9]{2,8}" value={draft.extensionRangeEnd} onChange={(event) => setDraft({ ...draft, extensionRangeEnd: event.target.value })} placeholder="209" /></label>
            </div>
            <small>Leave both blank when extensions will only be assigned by an administrator. Ranges cannot overlap another customer.</small>
            {draft.billingMode === "postpaid" && (
              <label>
                <span>Credit limit</span>
                <input
                  required
                  type="number"
                  min="0"
                  max="100000000"
                  step="0.000001"
                  value={draft.creditLimit}
                  onChange={(event) =>
                    setDraft({ ...draft, creditLimit: event.target.value })
                  }
                />
              </label>
            )}
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(event) =>
                  setDraft({ ...draft, active: event.target.checked })
                }
              />
              <span>
                <strong>Active customer</strong>
                <small>Disabled customers cannot sign in.</small>
              </span>
            </label>
            {!draft.id && (
              <>
                <div className="form-section">
                  <span>PRIMARY PORTAL LOGIN</span>
                  <p>
                    The customer uses these credentials on the normal Netbrowse
                    Voice sign-in screen.
                  </p>
                </div>
                <label>
                  <span>Login name</span>
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    value={draft.loginDisplayName}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        loginDisplayName: event.target.value,
                      })
                    }
                    placeholder="Customer administrator"
                  />
                </label>
                <label>
                  <span>Login email</span>
                  <input
                    required
                    type="email"
                    value={draft.loginEmail}
                    onChange={(event) =>
                      setDraft({ ...draft, loginEmail: event.target.value })
                    }
                    placeholder="admin@example.com"
                  />
                </label>
                <label>
                  <span>Temporary password</span>
                  <input
                    required
                    type="password"
                    minLength={12}
                    value={draft.loginPassword}
                    onChange={(event) =>
                      setDraft({ ...draft, loginPassword: event.target.value })
                    }
                    placeholder="At least 12 characters"
                  />
                </label>
              </>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy === "customer"}>
                {busy === "customer"
                  ? "Saving…"
                  : draft.id
                    ? "Save customer"
                    : "Create customer"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {services && data && (
        <Modal
          title={`Assign services · ${services.customer.name}`}
          onClose={() => setServices(null)}
        >
          <form
            className="modal-form customer-services-form"
            onSubmit={saveServices}
          >
            <div className="notice">
              <strong>Tenant boundary</strong>
              <span>
                Only selected services will appear in this customer's portal.
              </span>
            </div>
            <div className="service-picker">
              <section>
                <h3>Extensions</h3>
                {data.extensions.length === 0 ? (
                  <p>No extensions available.</p>
                ) : (
                  data.extensions.map((extension) => {
                    const unavailable = Boolean(
                      extension.customerId &&
                        extension.customerId !== services.customer.id,
                    );
                    return (
                      <label
                        className={unavailable ? "unavailable" : ""}
                        key={extension.id}
                      >
                        <input
                          type="checkbox"
                          disabled={unavailable}
                          checked={services.extensionIds.includes(extension.id)}
                          onChange={(event) =>
                            setServices({
                              ...services,
                              extensionIds: event.target.checked
                                ? [...services.extensionIds, extension.id]
                                : services.extensionIds.filter(
                                    (id) => id !== extension.id,
                                  ),
                            })
                          }
                        />
                        <span>
                          <strong>
                            {extension.extensionNumber} ·{" "}
                            {extension.displayName}
                          </strong>
                          <small>
                            {unavailable
                              ? "Assigned to another customer"
                              : extension.enabled
                                ? "Available"
                                : "Extension disabled"}
                          </small>
                        </span>
                      </label>
                    );
                  })
                )}
              </section>
              <section>
                <h3>Inbound DIDs</h3>
                {data.dids.length === 0 ? (
                  <p>No DID routes available.</p>
                ) : (
                  data.dids.map((did) => {
                    const unavailable = Boolean(
                      did.customerId && did.customerId !== services.customer.id,
                    );
                    return (
                      <label
                        className={unavailable ? "unavailable" : ""}
                        key={did.id}
                      >
                        <input
                          type="checkbox"
                          disabled={unavailable}
                          checked={services.didRouteIds.includes(did.id)}
                          onChange={(event) =>
                            setServices({
                              ...services,
                              didRouteIds: event.target.checked
                                ? [...services.didRouteIds, did.id]
                                : services.didRouteIds.filter(
                                    (id) => id !== did.id,
                                  ),
                            })
                          }
                        />
                        <span>
                          <strong>{did.didNumber}</strong>
                          <small>
                            {unavailable
                              ? "Assigned to another customer"
                              : `${did.trunkName}${did.enabled ? "" : " · Disabled"}`}
                          </small>
                        </span>
                      </label>
                    );
                  })
                )}
              </section>
            </div>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setServices(null)}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy === "services"}>
                {busy === "services" ? "Assigning…" : "Save assignments"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {wallet && (
        <Modal
          title={`Wallet · ${wallet.customer.name}`}
          onClose={() => setWallet(null)}
        >
          <form className="modal-form" onSubmit={postWallet}>
            <div className="notice">
              <strong>Current balance</strong>
              <span>
                {formatMoney(wallet.customer.balance, wallet.customer.currency)}{" "}
                · {wallet.customer.billingMode}
              </span>
            </div>
            <label>
              <span>Amount</span>
              <input
                required
                type="number"
                step="0.000001"
                min="-1000000"
                max="1000000"
                value={wallet.amount}
                onChange={(event) =>
                  setWallet({ ...wallet, amount: event.target.value })
                }
                placeholder="100.00"
              />
              <small>
                Use a positive amount to add funds or a negative amount for an
                audited adjustment.
              </small>
            </label>
            <label>
              <span>Transaction note</span>
              <input
                required
                minLength={2}
                maxLength={200}
                value={wallet.note}
                onChange={(event) =>
                  setWallet({ ...wallet, note: event.target.value })
                }
                placeholder="Manual EFT top-up"
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setWallet(null)}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy === "wallet"}>
                {busy === "wallet" ? "Posting…" : "Post transaction"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {password && (
        <Modal
          title={`Reset portal password · ${password.customer.name}`}
          onClose={() => setPassword(null)}
        >
          <form className="modal-form" onSubmit={resetCustomerPassword}>
            <div className="notice warning">
              <strong>Existing portal sessions will end.</strong>
              <span>
                Give the new password only to the authorised customer
                administrator.
              </span>
            </div>
            <label>
              <span>New password</span>
              <input
                required
                type="password"
                minLength={12}
                value={password.value}
                onChange={(event) =>
                  setPassword({ ...password, value: event.target.value })
                }
                placeholder="At least 12 characters"
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPassword(null)}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy === "password"}>
                {busy === "password" ? "Resetting…" : "Reset password"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function AiReceptionist() {
  const [data, setData] = useState<AiReceptionistData | null>(null);
  const [draft, setDraft] = useState<AiReceptionistDraft | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      setData(await api<AiReceptionistData>("/api/ai-receptionists"));
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load AI Receptionist",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function createDraft() {
    const used = new Set(
      data?.agents.map((agent) => agent.internalNumber) ?? [],
    );
    let suggested = 800;
    while (used.has(String(suggested))) suggested += 1;
    const provider =
      data?.providers.find(
        (item) =>
          item.key === "openai" && item.configured && item.voices.length > 0,
      ) ??
      data?.providers.find(
        (item) => item.configured && item.voices.length > 0,
      ) ??
      data?.providers[0];
    setDraft({
      name: "",
      internalNumber: String(suggested),
      greetingSoundId: data?.sounds[0]?.id ?? "",
      provider: provider?.key ?? "openai",
      voice:
        provider?.voices.find((voice) => voice.id === "Kore")?.id ??
        provider?.voices[0]?.id ??
        "",
      systemPrompt:
        "You are the company receptionist. Answer clearly using only the supplied business knowledge. Keep every response brief and offer a human transfer when needed.",
      knowledgeBase: "",
      handoffExtensionId: data?.extensions[0]?.id ?? "",
      handoffDestinationType: "extension",
      handoffCallGroupId: "",
      maxTurns: 4,
      listenTimeoutSeconds: 12,
      storeTranscripts: false,
      enabled: true,
    });
    setError("");
    setNotice("");
  }

  function editDraft(agent: AiReceptionistAgent) {
    setDraft({
      id: agent.id,
      name: agent.name,
      internalNumber: agent.internalNumber,
      greetingSoundId: agent.greetingSoundId,
      provider: agent.provider,
      voice: agent.voice,
      systemPrompt: agent.systemPrompt,
      knowledgeBase: agent.knowledgeBase,
      handoffExtensionId: agent.handoffExtensionId ?? "",
      handoffDestinationType: agent.handoffDestinationType,
      handoffCallGroupId: agent.handoffCallGroupId ?? "",
      maxTurns: agent.maxTurns,
      listenTimeoutSeconds: agent.listenTimeoutSeconds,
      storeTranscripts: agent.storeTranscripts,
      enabled: agent.enabled,
    });
    setError("");
    setNotice("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy("save");
    setError("");
    setNotice("");
    try {
      await api(
        draft.id
          ? `/api/ai-receptionists/${draft.id}`
          : "/api/ai-receptionists",
        {
          method: draft.id ? "PATCH" : "POST",
          body: JSON.stringify({
            name: draft.name,
            internalNumber: draft.internalNumber,
            greetingSoundId: draft.greetingSoundId,
            provider: draft.provider,
            voice: draft.voice,
            systemPrompt: draft.systemPrompt,
            knowledgeBase: draft.knowledgeBase,
            handoffDestinationType: draft.handoffDestinationType,
            handoffExtensionId:
              draft.handoffDestinationType === "extension"
                ? draft.handoffExtensionId || null
                : null,
            handoffCallGroupId:
              draft.handoffDestinationType === "call_group"
                ? draft.handoffCallGroupId || null
                : null,
            maxTurns: draft.maxTurns,
            listenTimeoutSeconds: draft.listenTimeoutSeconds,
            storeTranscripts: draft.storeTranscripts,
            enabled: draft.enabled,
          }),
        },
      );
      setDraft(null);
      setNotice(
        draft.id
          ? "AI receptionist updated and published to Asterisk."
          : "AI receptionist created and published to Asterisk.",
      );
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the AI receptionist",
      );
    } finally {
      setBusy("");
    }
  }

  async function toggle(agent: AiReceptionistAgent) {
    setBusy(agent.id);
    setError("");
    setNotice("");
    try {
      await api(`/api/ai-receptionists/${agent.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !agent.enabled }),
      });
      setNotice(`${agent.name} ${agent.enabled ? "disabled" : "enabled"}.`);
      await load();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Could not change agent state",
      );
    } finally {
      setBusy("");
    }
  }

  async function remove(agent: AiReceptionistAgent) {
    if (!window.confirm(`Permanently delete AI receptionist “${agent.name}”?`))
      return;
    setBusy(agent.id);
    setError("");
    setNotice("");
    try {
      await api(`/api/ai-receptionists/${agent.id}`, { method: "DELETE" });
      setNotice("AI receptionist deleted and removed from Asterisk.");
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete the AI receptionist",
      );
    } finally {
      setBusy("");
    }
  }

  const activeCount = data?.agents.filter((agent) => agent.enabled).length ?? 0;
  const transferredCount =
    data?.sessions.filter((session) => session.status === "transferred")
      .length ?? 0;
  const sounds = new Map(data?.sounds.map((sound) => [sound.id, sound]) ?? []);
  const extensions = new Map(
    data?.extensions.map((extension) => [extension.id, extension]) ?? [],
  );
  const callGroups = new Map(
    data?.callGroups.map((group) => [group.id, group]) ?? [],
  );
  const selectedSound = data?.sounds.find(
    (sound) => sound.id === draft?.greetingSoundId,
  );
  const selectedProvider = data?.providers.find(
    (provider) => provider.key === draft?.provider,
  );
  const readyProviders =
    data?.providers.filter(
      (provider) => provider.configured && provider.voices.length > 0,
    ).length ?? 0;
  const canCreate = Boolean(
    data && data.sounds.length > 0 && readyProviders > 0,
  );
  const engineName = (provider: AiReceptionistAgent["provider"]) =>
    provider === "openai"
      ? "OpenAI Realtime"
      : provider === "elevenlabs"
        ? "ElevenLabs Agents"
        : "Google Gemini";

  return (
    <>
      <section className="page-intro ai-intro">
        <div>
          <span className="eyebrow">LIVE VOICE AGENTS</span>
          <h2>Let an AI receptionist answer first.</h2>
          <p>
            Stream natural conversations with OpenAI Realtime, answer from
            approved business knowledge, and transfer callers to a real
            extension.
          </p>
        </div>
        <button
          className="primary-button compact"
          disabled={!canCreate}
          onClick={createDraft}
        >
          Add AI receptionist
        </button>
      </section>
      <section className="pbx-stat-grid ai-stat-grid">
        <article>
          <span>AI AGENTS</span>
          <strong>{data?.agents.length ?? "—"}</strong>
          <small>Configured receptionists</small>
        </article>
        <article>
          <span>ACTIVE</span>
          <strong>{data ? activeCount : "—"}</strong>
          <small>Published internal numbers</small>
        </article>
        <article>
          <span>RECENT CALLS</span>
          <strong>{data?.sessions.length ?? "—"}</strong>
          <small>{transferredCount} human transfers</small>
        </article>
        <article>
          <span>AI ENGINES</span>
          <strong>{data ? `${readyProviders}/3` : "—"}</strong>
          <small>OpenAI, ElevenLabs or Google</small>
        </article>
      </section>
      {error && (
        <div className="page-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="studio-notice" role="status">
          <span>{notice}</span>
        </div>
      )}
      {data && readyProviders === 0 && (
        <div className="notice warning ai-prerequisite">
          <strong>Configure an AI engine first</strong>
          <span>
            Open Sound Studio and save an authorized OpenAI, ElevenLabs or
            Google API key. OpenAI Realtime is recommended for live calls.
          </span>
        </div>
      )}
      {data && data.sounds.length === 0 && (
        <div className="notice warning ai-prerequisite">
          <strong>Create a greeting first</strong>
          <span>
            Generate an approved greeting in Sound Studio before creating an
            agent.
          </span>
        </div>
      )}
      <section className="panel ai-agent-panel">
        <div className="panel-head">
          <div>
            <span>INTERNAL AI ROUTES</span>
            <h3>Receptionist agents</h3>
          </div>
          <span className="secure-pill">AI DISCLOSURE ENFORCED</span>
        </div>
        {!data ? (
          <div className="empty-state history-empty">
            <div className="loader dark" />
            <p>Loading AI receptionists…</p>
          </div>
        ) : data.agents.length === 0 ? (
          <div className="empty-state ai-empty">
            <div className="empty-icon">AI</div>
            <h3>No AI receptionist yet</h3>
            <p>
              Create an agent, assign internal number 800, and call it from an
              extension before connecting any real inbound number.
            </p>
            <button
              className="secondary-button"
              disabled={!canCreate}
              onClick={createDraft}
            >
              Create test agent
            </button>
          </div>
        ) : (
          <div className="ai-agent-grid">
            {data.agents.map((agent) => {
              const sound = sounds.get(agent.greetingSoundId);
              const handoff = agent.handoffExtensionId
                ? extensions.get(agent.handoffExtensionId)
                : undefined;
              const handoffGroup = agent.handoffCallGroupId
                ? callGroups.get(agent.handoffCallGroupId)
                : undefined;
              return (
                <article
                  className={`ai-agent-card ${agent.enabled ? "" : "disabled"}`}
                  key={agent.id}
                >
                  <div className="ai-agent-head">
                    <div className="ai-number">
                      <span>DIAL</span>
                      <strong>{agent.internalNumber}</strong>
                    </div>
                    <div>
                      <h4>{agent.name}</h4>
                      <span
                        className={`ai-state ${agent.enabled ? "active" : ""}`}
                      >
                        <i />
                        {agent.enabled ? "ACTIVE" : "DISABLED"}
                      </span>
                    </div>
                    <em>
                      {agent.provider === "openai"
                        ? "REALTIME"
                        : agent.provider === "elevenlabs"
                          ? "ELEVENLABS"
                          : "GOOGLE"}
                    </em>
                  </div>
                  <dl>
                    <div>
                      <dt>Pre-recorded greeting</dt>
                      <dd>{sound?.name ?? "Unavailable"}</dd>
                    </div>
                    <div>
                      <dt>AI engine</dt>
                      <dd>{engineName(agent.provider)}</dd>
                    </div>
                    <div>
                      <dt>AI disclosure</dt>
                      <dd>
                        {agent.naturalDisclosure
                          ? "Natural provider voice"
                          : "Local fallback · Save to upgrade"}
                      </dd>
                    </div>
                    <div>
                      <dt>Human handoff</dt>
                      <dd>
                        {handoffGroup
                          ? `${handoffGroup.internalNumber} · ${handoffGroup.name}`
                          : handoff
                            ? `${handoff.extensionNumber} · ${handoff.displayName}`
                            : "Not configured"}
                      </dd>
                    </div>
                    <div>
                      <dt>Conversation limit</dt>
                      <dd>
                        {agent.maxTurns} turn{agent.maxTurns === 1 ? "" : "s"} ·{" "}
                        {agent.listenTimeoutSeconds}s idle
                      </dd>
                    </div>
                    <div>
                      <dt>Transcript storage</dt>
                      <dd>{agent.storeTranscripts ? "Enabled" : "Off"}</dd>
                    </div>
                  </dl>
                  <p>{agent.systemPrompt}</p>
                  <div className="ai-agent-actions">
                    <button
                      disabled={busy === agent.id}
                      onClick={() => void toggle(agent)}
                    >
                      {agent.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      disabled={busy === agent.id}
                      onClick={() => editDraft(agent)}
                    >
                      Edit
                    </button>
                    <button
                      className="danger"
                      disabled={busy === agent.id}
                      onClick={() => void remove(agent)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <section className="panel ai-sessions-panel">
        <div className="panel-head">
          <div>
            <span>PRIVATE CALL METADATA</span>
            <h3>Recent AI sessions</h3>
          </div>
          <span className="secure-pill">RAW AUDIO NOT STORED</span>
        </div>
        {!data || data.sessions.length === 0 ? (
          <div className="empty-state ai-session-empty">
            <div className="empty-icon">LOG</div>
            <h3>No AI test calls yet</h3>
            <p>
              Dial an enabled agent’s internal number from extension 100 or 102.
              Completed call metadata will appear here.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="ai-session-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Agent</th>
                  <th>Caller</th>
                  <th>Status</th>
                  <th>Turns</th>
                  <th>Privacy</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((session) => {
                  const agent = data.agents.find(
                    (item) => item.id === session.agentId,
                  );
                  return (
                    <tr key={session.id}>
                      <td>
                        <time dateTime={session.startedAt}>
                          {formatCallTime(session.startedAt)}
                        </time>
                      </td>
                      <td>
                        <strong>{session.agentName}</strong>
                      </td>
                      <td>{session.callerNumber || "Private"}</td>
                      <td>
                        <span className={`ai-session-state ${session.status}`}>
                          <i />
                          {session.status.replace("_", " ")}
                        </span>
                        {session.errorCode && (
                          <small className="ai-session-error">
                            {session.errorCode}
                          </small>
                        )}
                      </td>
                      <td>{session.turnCount}</td>
                      <td>
                        {agent?.storeTranscripts
                          ? "Transcript stored"
                          : "Metadata only"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="pbx-help ai-help">
        <div>
          <span>01</span>
          <p>
            <strong>Mandatory disclosure</strong> plays before the greeting and
            before caller audio is processed.
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>Realtime streaming</strong> supports natural turn-taking and
            caller interruption without storing raw audio.
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>Human handoff</strong> transfers only to a validated
            extension, ring group or queue.
          </p>
        </div>
      </section>

      {draft && data && (
        <Modal
          title={draft.id ? "Edit AI receptionist" : "Create AI receptionist"}
          onClose={() => setDraft(null)}
        >
          <form className="modal-form ai-agent-form" onSubmit={save}>
            <div className="ai-policy-note">
              <strong>Natural disclosure cannot be disabled</strong>
              <span>
                Saving prepares the fixed disclosure with the selected provider
                and voice. It is stored locally, adds no call delay, and its
                required wording cannot be edited.
              </span>
            </div>
            <div className="form-grid">
              <label>
                <span>Agent name</span>
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  placeholder="Main Reception"
                />
              </label>
              <label>
                <span>Internal test number</span>
                <input
                  required
                  pattern="[0-9]{2,8}"
                  value={draft.internalNumber}
                  onChange={(event) =>
                    setDraft({ ...draft, internalNumber: event.target.value })
                  }
                  placeholder="800"
                />
                <small>Dial this from a registered extension.</small>
              </label>
            </div>
            <label>
              <span>AI engine</span>
              <select
                required
                value={draft.provider}
                onChange={(event) => {
                  const provider = data.providers.find(
                    (item) => item.key === event.target.value,
                  );
                  if (provider)
                    setDraft({
                      ...draft,
                      provider: provider.key,
                      voice: provider.voices[0]?.id ?? "",
                    });
                }}
              >
                {data.providers.map((provider) => (
                  <option
                    key={provider.key}
                    value={provider.key}
                    disabled={
                      !provider.configured || provider.voices.length === 0
                    }
                  >
                    {provider.name}
                    {provider.key === "openai" ? " · Recommended" : ""}
                    {provider.configured ? "" : " · Not configured"}
                  </option>
                ))}
              </select>
              <small>
                The selected provider handles caller understanding, reasoning
                and spoken replies.
              </small>
            </label>
            <div className="form-grid">
              <label>
                <span>Pre-recorded greeting</span>
                <select
                  required
                  value={draft.greetingSoundId}
                  onChange={(event) =>
                    setDraft({ ...draft, greetingSoundId: event.target.value })
                  }
                >
                  {data.sounds.map((sound) => (
                    <option key={sound.id} value={sound.id}>
                      {sound.name} · {sound.provider}
                    </option>
                  ))}
                </select>
                <small>
                  This local Sound Studio recording plays before the live
                  conversation begins.
                </small>
              </label>
              <label>
                <span>Conversation reply voice</span>
                <select
                  required
                  value={draft.voice}
                  onChange={(event) =>
                    setDraft({ ...draft, voice: event.target.value })
                  }
                >
                  {(selectedProvider?.voices ?? []).map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name}
                      {voice.description ? ` · ${voice.description}` : ""}
                    </option>
                  ))}
                </select>
                {selectedProvider?.voiceLoadError && (
                  <small className="field-warning">
                    {selectedProvider.voiceLoadError}
                  </small>
                )}
                <small>
                  {selectedProvider?.name ?? "The selected AI engine"} uses this
                  voice for live answers.
                </small>
              </label>
            </div>
            {selectedSound && (
              <audio
                className="ai-greeting-preview"
                controls
                preload="none"
                src={`/api/sound-studio/${selectedSound.id}/audio`}
              />
            )}
            <div className="form-section">
              <span>BUSINESS BEHAVIOR</span>
              <p>
                Tell the receptionist how to behave. The runtime also applies
                fixed privacy, accuracy and transfer safeguards.
              </p>
            </div>
            <label>
              <span>
                Agent instructions <em>{draft.systemPrompt.length}/4000</em>
              </span>
              <textarea
                required
                minLength={20}
                maxLength={4000}
                rows={5}
                value={draft.systemPrompt}
                onChange={(event) =>
                  setDraft({ ...draft, systemPrompt: event.target.value })
                }
                placeholder="Answer politely, keep replies under two sentences, and offer Sales or Support when appropriate."
              />
            </label>
            <label>
              <span>
                Business knowledge <em>{draft.knowledgeBase.length}/12000</em>
              </span>
              <textarea
                maxLength={12000}
                rows={8}
                value={draft.knowledgeBase}
                onChange={(event) =>
                  setDraft({ ...draft, knowledgeBase: event.target.value })
                }
                placeholder={
                  "Company name: Example Company\nOpening hours: Monday to Friday, 09:00–17:00\nServices: ...\nCommon questions: ..."
                }
              />
              <small>
                Use clear facts only. Do not paste passwords, payment details or
                private customer data.
              </small>
            </label>
            <div className="form-section">
              <span>CALL LIMITS AND HANDOFF</span>
              <p>
                Tutorial-style calls can run for up to 100 turns. Set a sensible
                limit for the expected call length and API usage.
              </p>
            </div>
            <label>
              <span>Human handoff destination</span>
              <select
                value={
                  draft.handoffDestinationType === "call_group" &&
                  draft.handoffCallGroupId
                    ? `call_group:${draft.handoffCallGroupId}`
                    : draft.handoffExtensionId
                      ? `extension:${draft.handoffExtensionId}`
                      : ""
                }
                onChange={(event) => {
                  const [type, id] = event.target.value.split(":");
                  setDraft({
                    ...draft,
                    handoffDestinationType:
                      type === "call_group" ? "call_group" : "extension",
                    handoffExtensionId: type === "extension" ? (id ?? "") : "",
                    handoffCallGroupId: type === "call_group" ? (id ?? "") : "",
                  });
                }}
              >
                <option value="">No transfer available</option>
                <optgroup label="Individual extensions">
                  {data.extensions.map((extension) => (
                    <option
                      key={extension.id}
                      value={`extension:${extension.id}`}
                    >
                      {extension.extensionNumber} · {extension.displayName}
                    </option>
                  ))}
                </optgroup>
                {data.callGroups.length > 0 && (
                  <optgroup label="Call groups and queues">
                    {data.callGroups.map((group) => (
                      <option key={group.id} value={`call_group:${group.id}`}>
                        {group.internalNumber} · {group.name} (
                        {group.groupType === "queue" ? "queue" : "ring group"})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <small>
                Queues are recommended when more than one human agent can
                answer.
              </small>
            </label>
            <div className="form-grid">
              <label>
                <span>Maximum turns</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={draft.maxTurns}
                  onChange={(event) =>
                    setDraft({ ...draft, maxTurns: Number(event.target.value) })
                  }
                />
                <small>
                  Choose 1 to 100 turns. At the limit, the AI announces and
                  transfers to the selected human destination. Without one, it
                  closes politely.
                </small>
              </label>
              <label>
                <span>Idle prompt timeout</span>
                <select
                  value={draft.listenTimeoutSeconds}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      listenTimeoutSeconds: Number(event.target.value),
                    })
                  }
                >
                  {[5, 8, 10, 12, 15, 20, 30].map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} seconds
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={draft.storeTranscripts}
                onChange={(event) =>
                  setDraft({ ...draft, storeTranscripts: event.target.checked })
                }
              />
              <span>
                <strong>Store call transcripts</strong>
                <small>
                  Off by default. Streamed caller audio is never written to
                  disk. Obtain appropriate consent before enabling transcript
                  storage.
                </small>
              </span>
            </label>
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) =>
                  setDraft({ ...draft, enabled: event.target.checked })
                }
              />
              <span>
                <strong>Publish this agent</strong>
                <small>
                  Enabled agents are immediately reachable at the internal test
                  number.
                </small>
              </span>
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy === "save"}>
                {busy === "save"
                  ? "Preparing voice and publishing…"
                  : draft.id
                    ? "Save and publish"
                    : "Create and publish"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

type DidInventoryDraft = {
  id: string | null;
  didNumber: string;
  trunkId: string;
  countryCode: string;
  region: string;
  locality: string;
  currency: string;
  setupPrice: number;
  monthlyPrice: number;
  enabled: boolean;
};

function DidMarketplaceAdmin() {
  const [data, setData] = useState<AdminDidMarketplaceData | null>(null);
  const [draft, setDraft] = useState<DidInventoryDraft | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    try {
      setData(await api<AdminDidMarketplaceData>("/api/did-marketplace/admin"));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load DID inventory");
    }
  }

  useEffect(() => { void load(); }, []);

  function newNumber() {
    const trunk = data?.trunks.find((item) => item.enabled) ?? data?.trunks[0];
    setDraft({
      id: null,
      didNumber: "",
      trunkId: trunk?.id ?? "",
      countryCode: "ZA",
      region: "",
      locality: "",
      currency: "ZAR",
      setupPrice: 0,
      monthlyPrice: 0,
      enabled: true,
    });
  }

  function editNumber(number: DidInventoryNumber) {
    setDraft({
      id: number.id,
      didNumber: number.didNumber,
      trunkId: number.trunkId,
      countryCode: number.countryCode,
      region: number.region,
      locality: number.locality,
      currency: number.currency,
      setupPrice: number.setupPrice,
      monthlyPrice: number.monthlyPrice,
      enabled: number.status === "available",
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy("save"); setError(""); setNotice("");
    try {
      await api(draft.id
        ? `/api/did-marketplace/admin/${draft.id}`
        : "/api/did-marketplace/admin", {
        method: draft.id ? "PATCH" : "POST",
        body: JSON.stringify(draft),
      });
      setNotice(draft.id ? "Inventory number updated." : "Number added to customer inventory.");
      setDraft(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the inventory number");
    } finally { setBusy(""); }
  }

  async function remove(number: DidInventoryNumber) {
    if (!window.confirm(`Remove ${number.didNumber} from inventory?`)) return;
    setBusy(`delete-${number.id}`); setError(""); setNotice("");
    try {
      await api(`/api/did-marketplace/admin/${number.id}`, { method: "DELETE" });
      setNotice(`${number.didNumber} removed from inventory.`);
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove the number");
    } finally { setBusy(""); }
  }

  const query = search.trim().toLowerCase();
  const numbers = data?.numbers.filter((number) =>
    !query || number.didNumber.includes(query)
      || number.countryCode.toLowerCase().includes(query)
      || number.region.toLowerCase().includes(query)
      || number.locality.toLowerCase().includes(query)
      || number.customerName?.toLowerCase().includes(query)
  ) ?? [];

  return (
    <>
      <section className="hero-strip did-marketplace-hero">
        <div><span className="eyebrow">DID INVENTORY</span><h2>Stock numbers once. Sell them safely.</h2><p>Publish provider numbers with setup and monthly prices. Customer purchases are charged and routed automatically.</p></div>
        <button className="primary-button" disabled={!data?.trunks.length} onClick={newNumber}>Add number to stock</button>
      </section>
      {error && <div className="page-error" role="alert"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
      {notice && <div className="studio-notice" role="status"><span>{notice}</span></div>}
      <section className="stat-grid did-marketplace-stats">
        <article><span>AVAILABLE</span><strong>{data?.summary.available ?? "—"}</strong><small>Visible to matching currencies</small></article>
        <article><span>ASSIGNED</span><strong>{data?.summary.assigned ?? "—"}</strong><small>Purchased customer numbers</small></article>
        <article><span>DISABLED</span><strong>{data?.summary.disabled ?? "—"}</strong><small>Hidden from the marketplace</small></article>
        <article><span>PROVIDER TRUNKS</span><strong>{data?.trunks.filter((trunk) => trunk.enabled).length ?? "—"}</strong><small>Enabled inventory sources</small></article>
      </section>
      <section className="panel did-inventory-panel">
        <div className="panel-head"><div><span>NUMBER CATALOGUE</span><h3>DID stock and ownership</h3></div><input className="table-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search number, region or customer…" /></div>
        {!data ? <div className="empty-state"><div className="loader dark" /><p>Loading DID inventory…</p></div> : numbers.length === 0 ? (
          <div className="empty-state"><div className="empty-icon">DID</div><h3>No inventory numbers yet</h3><p>Add numbers supplied by one of your SIP providers.</p></div>
        ) : (
          <div className="table-scroll"><table><thead><tr><th>Number</th><th>Location</th><th>Provider</th><th>Customer price</th><th>Status</th><th /></tr></thead><tbody>
            {numbers.map((number) => <tr key={number.id}><td><strong>{number.didNumber}</strong><small>{number.countryCode}</small></td><td>{[number.locality, number.region].filter(Boolean).join(", ") || "National / unspecified"}</td><td>{number.trunkName}</td><td><strong>{formatMoney(number.setupPrice, number.currency)} setup</strong><small>{formatMoney(number.monthlyPrice, number.currency)} monthly</small></td><td><span className={`inventory-status ${number.status}`}>{number.status}</span>{number.customerName && <small>{number.customerName}</small>}</td><td><div className="table-actions"><button disabled={number.status === "assigned"} onClick={() => editNumber(number)}>Edit</button><button className="danger-link" disabled={number.status === "assigned" || busy === `delete-${number.id}`} onClick={() => void remove(number)}>Delete</button></div></td></tr>)}
          </tbody></table></div>
        )}
      </section>
      {draft && <Modal title={draft.id ? "Edit inventory number" : "Add number to stock"} onClose={() => setDraft(null)}><form onSubmit={save} className="modal-form">
        <div className="form-grid"><label><span>Inbound number (DID)</span><input required value={draft.didNumber} onChange={(event) => setDraft({ ...draft, didNumber: event.target.value })} placeholder="+27101234567" /></label><label><span>Provider trunk</span><select required value={draft.trunkId} onChange={(event) => setDraft({ ...draft, trunkId: event.target.value })}><option value="">Choose a trunk</option>{data?.trunks.map((trunk) => <option key={trunk.id} value={trunk.id}>{trunk.name}{trunk.enabled ? "" : " · disabled"}</option>)}</select></label></div>
        <div className="form-grid"><label><span>Country code</span><input required maxLength={2} value={draft.countryCode} onChange={(event) => setDraft({ ...draft, countryCode: event.target.value.toUpperCase() })} placeholder="ZA" /></label><label><span>Currency</span><input required maxLength={3} value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase() })} placeholder="ZAR" /></label></div>
        <div className="form-grid"><label><span>Region</span><input value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })} placeholder="Gauteng" /></label><label><span>City / locality</span><input value={draft.locality} onChange={(event) => setDraft({ ...draft, locality: event.target.value })} placeholder="Johannesburg" /></label></div>
        <div className="form-grid"><label><span>Setup price</span><input required type="number" min="0" max="1000000" step="0.000001" value={draft.setupPrice} onChange={(event) => setDraft({ ...draft, setupPrice: Number(event.target.value) })} /></label><label><span>Monthly price</span><input required type="number" min="0" max="1000000" step="0.000001" value={draft.monthlyPrice} onChange={(event) => setDraft({ ...draft, monthlyPrice: Number(event.target.value) })} /></label></div>
        <div className="purchase-total"><span>Customer pays today</span><strong>{formatMoney(draft.setupPrice + draft.monthlyPrice, draft.currency || "ZAR")}</strong><small>Setup plus the first month. Renewals use the monthly price.</small></div>
        <label className="toggle-field"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span><strong>Publish in marketplace</strong><small>Disabled stock remains hidden from customers.</small></span></label>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setDraft(null)}>Cancel</button><button className="primary-button" disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save inventory number"}</button></div>
      </form></Modal>}
    </>
  );
}

function ModuleGrid({ modules }: { modules: VoiceModule[] }) {
  return (
    <div className="module-grid">
      {modules.map((module) => (
        <article key={module.key}>
          <div className="module-top">
            <span>{module.name.slice(0, 2).toUpperCase()}</span>
            <em className={module.status}>{module.status}</em>
          </div>
          <h4>{module.name}</h4>
          <p>{module.description}</p>
          <small>Version {module.version}</small>
        </article>
      ))}
    </div>
  );
}

function LaunchGuide({
  extensionCount,
  trunkCount,
  onNavigate,
}: {
  extensionCount: number;
  trunkCount: number;
  onNavigate: (page: PageKey) => void;
}) {
  const steps: Array<{
    index: string;
    title: string;
    description: string;
    detail: string;
    page: PageKey;
    action: string;
    ready: boolean;
  }> = [
    {
      index: "01",
      title: "PBX foundation",
      description: "Provision extensions and connect desk or soft phones.",
      detail:
        extensionCount > 0
          ? `${extensionCount} extension${extensionCount === 1 ? "" : "s"} configured`
          : "Create the first extension",
      page: "pbx",
      action: "Open PBX Core",
      ready: extensionCount > 0,
    },
    {
      index: "02",
      title: "AI voice",
      description: "Give inbound callers a natural AI receptionist with human handoff.",
      detail: "OpenAI Realtime, Google or ElevenLabs",
      page: "ai",
      action: "Configure AI",
      ready: true,
    },
    {
      index: "03",
      title: "Call flow",
      description: "Turn approved announcements into an IVR callers can navigate.",
      detail: "Sound Studio + IVR Builder",
      page: "ivr",
      action: "Build an IVR",
      ready: true,
    },
    {
      index: "04",
      title: "Customer portal",
      description: "Create isolated customer or reseller workspaces with billing controls.",
      detail: "Private access and white-label support",
      page: "customers",
      action: "Manage customers",
      ready: true,
    },
    {
      index: "05",
      title: "Numbers and routing",
      description: "Publish provider numbers and attach them to customer extensions.",
      detail:
        trunkCount > 0
          ? `${trunkCount} provider trunk${trunkCount === 1 ? "" : "s"} available`
          : "Add a provider trunk first",
      page: "didstore",
      action: "Open DID Store",
      ready: trunkCount > 0,
    },
  ];

  return (
    <section className="launch-guide" aria-labelledby="launch-guide-title">
      <div className="launch-guide-head">
        <div>
          <span>QUICK LAUNCH</span>
          <h3 id="launch-guide-title">The complete communications journey.</h3>
        </div>
        <p>
          Each workspace is connected to the same Asterisk core, so a live demo
          can move from call setup to AI handling, routing and customer billing.
        </p>
      </div>
      <div className="launch-guide-grid">
        {steps.map((step) => (
          <article className="launch-guide-card" key={step.index}>
            <div className="launch-guide-card-top">
              <span>{step.index}</span>
              <em className={step.ready ? "ready" : "next"}>
                {step.ready ? "READY" : "START HERE"}
              </em>
            </div>
            <h4>{step.title}</h4>
            <p>{step.description}</p>
            <small>{step.detail}</small>
            <button type="button" onClick={() => onNavigate(step.page)}>
              {step.action}
              <b aria-hidden="true">→</b>
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function Overview({
  data,
  onNavigate,
}: {
  data: DashboardData;
  onNavigate: (page: PageKey) => void;
}) {
  const [activeCount, setActiveCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const snapshot = await api<{ available: boolean; calls: ActiveCall[] }>(
          "/api/calls/active",
        );
        if (!cancelled)
          setActiveCount(snapshot.available ? snapshot.calls.length : null);
      } catch {
        if (!cancelled) setActiveCount(null);
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  const onlineServices = data.services.filter(
    (service) => service.state === "online",
  ).length;
  const memoryUsed = data.metrics.memory.total - data.metrics.memory.free;
  const diskUsed = data.metrics.disk.total - data.metrics.disk.free;
  const todayCost =
    data.billingToday.length === 1
      ? formatMoney(data.billingToday[0]!.cost, data.billingToday[0]!.currency)
      : data.billingToday.length > 1
        ? "Mixed"
        : formatMoney(0, "ZAR");
  return (
    <>
      <section className="hero-strip">
        <div>
          <span className="eyebrow">AI-NATIVE COMMUNICATIONS</span>
          <h2>One system. Every call.</h2>
          <p>
            Build a phone system, AI receptionist, customer portal and billing
            operation from one Asterisk-powered control centre.
          </p>
        </div>
        <div className="hero-stat">
          <strong>
            {onlineServices}/{data.services.length}
          </strong>
          <span>services online</span>
        </div>
      </section>
      <section className="stat-grid">
        <article>
          <span>ACTIVE CALLS</span>
          <strong>{activeCount ?? "—"}</strong>
          <small>Live Asterisk channels</small>
        </article>
        <article>
          <span>EXTENSIONS</span>
          <strong>{data.extensionCount}</strong>
          <small>Provisioned in PBX Core</small>
        </article>
        <article>
          <span>TRUNKS</span>
          <strong>{data.trunkCount}</strong>
          <small>{data.didCount} inbound DID routes</small>
        </article>
        <article>
          <span>TODAY'S COST</span>
          <strong>{todayCost}</strong>
          <small>Automatically rated CDRs</small>
        </article>
      </section>
      <LaunchGuide
        extensionCount={data.extensionCount}
        trunkCount={data.trunkCount}
        onNavigate={onNavigate}
      />
      <section className="dashboard-grid">
        <article className="panel services-panel">
          <div className="panel-head">
            <div>
              <span>INFRASTRUCTURE</span>
              <h3>Service health</h3>
            </div>
            <span className="live-pill">LIVE</span>
          </div>
          <div className="service-list">
            {data.services.map((service) => (
              <div className="service-row" key={service.key}>
                <div className={`status-icon ${service.state}`}>
                  <span />
                </div>
                <div>
                  <strong>{service.label}</strong>
                  <small>{service.detail ?? "Local service"}</small>
                </div>
                <span className={`state ${service.state}`}>
                  {service.state}
                </span>
              </div>
            ))}
          </div>
        </article>
        <article className="panel system-panel">
          <div className="panel-head">
            <div>
              <span>SERVER</span>
              <h3>{data.metrics.hostname}</h3>
            </div>
          </div>
          <dl>
            <div>
              <dt>Platform</dt>
              <dd>{data.metrics.platform}</dd>
            </div>
            <div>
              <dt>Processors</dt>
              <dd>{data.metrics.cpuCount} cores</dd>
            </div>
            <div>
              <dt>Load average</dt>
              <dd>{data.metrics.loadAverage.join(" · ")}</dd>
            </div>
            <div>
              <dt>Uptime</dt>
              <dd>{formatUptime(data.metrics.uptimeSeconds)}</dd>
            </div>
          </dl>
          <div className="meter-block">
            <div>
              <span>Memory</span>
              <strong>
                {formatBytes(memoryUsed)} /{" "}
                {formatBytes(data.metrics.memory.total)}
              </strong>
            </div>
            <progress value={memoryUsed} max={data.metrics.memory.total} />
          </div>
          <div className="meter-block">
            <div>
              <span>Disk</span>
              <strong>
                {formatBytes(diskUsed)} / {formatBytes(data.metrics.disk.total)}
              </strong>
            </div>
            <progress value={diskUsed} max={data.metrics.disk.total} />
          </div>
        </article>
      </section>
      <section className="panel modules-panel">
        <div className="panel-head">
          <div>
            <span>MODULAR PLATFORM</span>
            <h3>Product modules</h3>
          </div>
        </div>
        <ModuleGrid modules={data.modules} />
      </section>
    </>
  );
}

function PlannedPage({ active }: { active: PageKey }) {
  const descriptions: Partial<Record<PageKey, string>> = {
    ai: "Build conversational inbound agents with business tools, call summaries and safe human handoff.",
    campaigns:
      "Run compliant outbound campaigns with AI and human agents, pacing, retry policies and suppression lists.",
    billing:
      "Rate calls in real time with rate decks, customer wallets, reseller margins and invoices.",
  };
  return (
    <section className="planned-page">
      <div className="planned-mark">NEXT</div>
      <span className="eyebrow">PLANNED MODULE</span>
      <h2>{pageTitles[active]}</h2>
      <p>{descriptions[active]}</p>
      <div className="notice">
        <strong>The navigation is ready.</strong>
        <span>
          This module is intentionally inactive until its database, permissions
          and Asterisk integration are implemented.
        </span>
      </div>
    </section>
  );
}

function AgentWorkspace({
  initialData,
  onLogout,
}: {
  initialData: AgentWorkspaceData;
  onLogout: () => Promise<void>;
}) {
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function refresh(showError = false) {
    try {
      setData(await api<AgentWorkspaceData>("/api/agent/workspace"));
      if (showError) setError("");
    } catch (refreshError) {
      if (showError)
        setError(
          refreshError instanceof Error
            ? refreshError.message
            : "Could not refresh workspace",
        );
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(false), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  async function changeQueue(
    queue: AgentWorkspaceData["queues"][number],
    change: {
      signedIn?: boolean;
      paused?: boolean;
      pauseReason?: string | null;
    },
  ) {
    setBusy(queue.id);
    setError("");
    try {
      await api(`/api/agent/workspace/queues/${queue.id}`, {
        method: "PATCH",
        body: JSON.stringify(change),
      });
      await refresh(true);
    } catch (changeError) {
      setError(
        changeError instanceof Error
          ? changeError.message
          : "Could not update queue state",
      );
    } finally {
      setBusy("");
    }
  }

  const initials =
    data.user.displayName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "AG";
  const waiting = data.queues.reduce(
    (total, queue) => total + queue.liveStats.waitingCallers,
    0,
  );
  const readyQueues = data.queues.filter((queue) => queue.ready).length;
  const registrationLabel =
    data.extension.registrationState === "registered"
      ? "Phone online"
      : "Phone offline";

  return (
    <div className="agent-workspace-shell">
      <aside className="agent-workspace-rail">
        <Brand />
        <div>
          <span>AGENT</span>
          <strong>{data.extension.extensionNumber}</strong>
          <small>{data.extension.displayName}</small>
        </div>
        <footer>
          <i
            className={
              data.extension.registrationState === "registered" ? "online" : ""
            }
          />
          {registrationLabel}
          <small>Hackathon build · 0.32.3</small>
        </footer>
      </aside>
      <main className="agent-workspace-main">
        <header className="agent-workspace-header">
          <div>
            <span>NETBROWSE VOICE / AGENT WORKSPACE</span>
            <h1>Ready to handle calls.</h1>
            <p>Your queue state and current call update automatically.</p>
          </div>
          <div className="agent-workspace-user">
            <div>{initials}</div>
            <span>
              <strong>{data.user.displayName}</strong>
              <small>Extension {data.extension.extensionNumber}</small>
            </span>
            <button onClick={() => void onLogout()}>Sign out</button>
          </div>
        </header>
        {error && (
          <div className="page-error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        <section className="agent-workspace-stats">
          <article>
            <span>PHONE</span>
            <strong
              className={
                data.extension.registrationState === "registered"
                  ? "good"
                  : "warn"
              }
            >
              {registrationLabel}
            </strong>
            <small>{data.extension.registrationState}</small>
          </article>
          <article>
            <span>READY QUEUES</span>
            <strong>
              {readyQueues}/{data.queues.length}
            </strong>
            <small>Signed in and available</small>
          </article>
          <article>
            <span>WAITING NOW</span>
            <strong>{waiting}</strong>
            <small>Across your queues</small>
          </article>
          <article>
            <span>TALK TIME TODAY</span>
            <strong>{formatDuration(data.today.talkSeconds)}</strong>
            <small>{data.today.answeredCalls} answered calls</small>
          </article>
        </section>
        <section className="agent-workspace-grid">
          <article className="panel agent-queue-panel">
            <div className="panel-head">
              <div>
                <span>MY AVAILABILITY</span>
                <h3>Queue assignments</h3>
              </div>
              <span className="secure-pill">LIVE</span>
            </div>
            {data.queues.length === 0 ? (
              <div className="empty-state agent-workspace-empty">
                <div className="empty-icon">Q</div>
                <h3>No queue assigned</h3>
                <p>
                  Ask an administrator to add extension{" "}
                  {data.extension.extensionNumber} to a call queue.
                </p>
              </div>
            ) : (
              <div className="agent-workspace-queues">
                {data.queues.map((queue) => (
                  <div
                    className={`agent-workspace-queue ${queue.ready ? "ready" : queue.paused ? "paused" : "offline"}`}
                    key={queue.id}
                  >
                    <div className="agent-queue-title">
                      <i />
                      <span>
                        <strong>{queue.name}</strong>
                        <small>
                          Queue {queue.internalNumber} ·{" "}
                          {queue.strategy === "rrmemory"
                            ? "Round robin"
                            : queue.strategy === "leastrecent"
                              ? "Least recent"
                              : "Ring all"}
                        </small>
                      </span>
                      <em>
                        {!queue.enabled
                          ? "DISABLED"
                          : !queue.signedIn
                            ? "SIGNED OUT"
                            : queue.paused
                              ? `PAUSED · ${queue.pauseReason ?? "break"}`
                              : queue.ready
                                ? "READY"
                                : "PHONE OFFLINE"}
                      </em>
                    </div>
                    <div className="agent-queue-live">
                      <div>
                        <span>WAITING</span>
                        <strong>
                          {queue.liveStats.available
                            ? queue.liveStats.waitingCallers
                            : "—"}
                        </strong>
                      </div>
                      <div>
                        <span>LONGEST</span>
                        <strong>
                          {queue.liveStats.available
                            ? formatDuration(queue.liveStats.longestWaitSeconds)
                            : "—"}
                        </strong>
                      </div>
                      <div>
                        <span>ANSWERED</span>
                        <strong>
                          {queue.liveStats.available
                            ? queue.liveStats.completedCalls
                            : "—"}
                        </strong>
                      </div>
                      <div>
                        <span>ABANDONED</span>
                        <strong>
                          {queue.liveStats.available
                            ? queue.liveStats.abandonedCalls
                            : "—"}
                        </strong>
                      </div>
                    </div>
                    <div className="agent-queue-actions">
                      {queue.signedIn && queue.paused && (
                        <select
                          aria-label={`Pause reason for ${queue.name}`}
                          value={queue.pauseReason ?? "break"}
                          disabled={busy === queue.id || !queue.enabled}
                          onChange={(event) =>
                            void changeQueue(queue, {
                              paused: true,
                              pauseReason: event.target.value,
                            })
                          }
                        >
                          <option value="break">Break</option>
                          <option value="lunch">Lunch</option>
                          <option value="training">Training</option>
                          <option value="admin">Admin</option>
                        </select>
                      )}
                      {queue.signedIn && (
                        <button
                          disabled={busy === queue.id || !queue.enabled}
                          onClick={() =>
                            void changeQueue(
                              queue,
                              queue.paused
                                ? { paused: false, pauseReason: null }
                                : { paused: true, pauseReason: "break" },
                            )
                          }
                        >
                          {queue.paused ? "Resume calls" : "Pause calls"}
                        </button>
                      )}
                      <button
                        className="primary"
                        disabled={busy === queue.id || !queue.enabled}
                        onClick={() =>
                          void changeQueue(queue, {
                            signedIn: !queue.signedIn,
                            paused: false,
                            pauseReason: null,
                          })
                        }
                      >
                        {busy === queue.id
                          ? "Updating…"
                          : queue.signedIn
                            ? "Sign out of queue"
                            : "Sign in to queue"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
          <div className="agent-workspace-side">
            <article className="panel agent-current-call">
              <div className="panel-head">
                <div>
                  <span>LIVE PHONE</span>
                  <h3>Current call</h3>
                </div>
              </div>
              {data.activeCalls.length === 0 ? (
                <div className="agent-no-call">
                  <span>Ready</span>
                  <strong>Waiting for the next call</strong>
                  <small>Keep your SIP phone registered.</small>
                </div>
              ) : (
                data.activeCalls.map((call) => (
                  <div className="agent-live-call" key={call.id}>
                    <span className={call.state}>{call.state}</span>
                    <strong>
                      {call.source} → {call.destination}
                    </strong>
                    <time>{formatDuration(call.durationSeconds)}</time>
                  </div>
                ))
              )}
            </article>
            <article className="panel agent-daily-card">
              <div className="panel-head">
                <div>
                  <span>MY DAY</span>
                  <h3>Call totals</h3>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Total calls</dt>
                  <dd>{data.today.totalCalls}</dd>
                </div>
                <div>
                  <dt>Answered</dt>
                  <dd>{data.today.answeredCalls}</dd>
                </div>
                <div>
                  <dt>Unanswered</dt>
                  <dd>{data.today.missedCalls}</dd>
                </div>
                <div>
                  <dt>Talk time</dt>
                  <dd>{formatDuration(data.today.talkSeconds)}</dd>
                </div>
              </dl>
              <small>
                Only calls involving extension {data.extension.extensionNumber}{" "}
                are included.
              </small>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}

type CustomerSection =
  | "overview"
  | "services"
  | "clients"
  | "branding"
  | "numbers"
  | "calls"
  | "recordings"
  | "rates"
  | "ledger"
  | "invoices";

const customerSectionRoutes: Record<CustomerSection, string> = {
  overview: "/portal",
  services: "/portal/services",
  clients: "/portal/clients",
  branding: "/portal/branding",
  numbers: "/portal/numbers",
  calls: "/portal/calls",
  recordings: "/portal/recordings",
  rates: "/portal/rates",
  ledger: "/portal/wallet",
  invoices: "/portal/invoices",
};

function customerSectionFromPath(pathname: string): CustomerSection {
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const match = Object.entries(customerSectionRoutes).find(
    ([, route]) => route === normalized,
  );
  return (match?.[0] as CustomerSection | undefined) ?? "overview";
}

function CustomerRecordingsPanel() {
  const [data, setData] = useState<CustomerRecordingData | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const parameters = new URLSearchParams({ limit: "50" });
    if (search.trim()) parameters.set("search", search.trim());
    try {
      setData(await api<CustomerRecordingData>(`/api/customer/recordings?${parameters}`));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load recordings");
    }
  }

  useEffect(() => {
    const debounce = window.setTimeout(() => void load(), 250);
    const refresh = window.setInterval(() => void load(), 15_000);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(refresh);
    };
  }, [search]);

  async function remove(recording: Recording) {
    if (!window.confirm(`Permanently delete the recording of ${recording.source} to ${recording.destination}?`)) return;
    setBusy(recording.id);
    setError("");
    try {
      await api(`/api/customer/recordings/${recording.id}`, { method: "DELETE" });
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete recording");
    } finally {
      setBusy("");
    }
  }

  const retentionLabel = data?.retentionDays === 0
    ? "Forever"
    : `${data?.retentionDays ?? "—"} days`;
  return (
    <section className="panel customer-recordings-panel" id="customer-portal-recordings">
      <div className="panel-head">
        <div><span>PRIVATE RECORDING ARCHIVE</span><h3>Recorded calls</h3></div>
        <span className="secure-pill">TENANT FILTERED</span>
      </div>
      {error && <div className="page-error" role="alert"><span>{error}</span><button onClick={() => void load()}>Try again</button></div>}
      <div className="customer-recording-summary">
        <article><span>RECORDINGS</span><strong>{data?.total ?? "—"}</strong><small>Your account only</small></article>
        <article><span>STORAGE</span><strong>{data ? `${formatFileSize(data.storageBytes)} / ${formatFileSize(data.storageLimitBytes)}` : "—"}</strong><small>{data ? `${data.storagePercent}% used` : "Loading allowance…"}</small>{data && <div className="customer-recording-meter"><i style={{ width: `${data.storagePercent}%` }} /></div>}</article>
        <article><span>RETENTION</span><strong>{retentionLabel}</strong><small>Administrator policy</small></article>
        <article><span>NEW RECORDINGS</span><strong>{data?.recordingEnabled ? "Enabled" : "Unavailable"}</strong><small>{data?.recordingReason || "Included in your plan"}</small></article>
      </div>
      <div className="customer-recordings-toolbar"><div><strong>Recording library</strong><small>{data ? `${data.recordings.length} shown` : "Loading…"}</small></div><label><span className="sr-only">Search recordings</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search number or caller…" /></label></div>
      {!data ? <div className="empty-state"><div className="loader dark" /><p>Loading recording archive…</p></div>
        : data.recordings.length === 0 ? <div className="empty-state recording-empty"><div className="empty-icon">REC</div><h3>No recordings yet</h3><p>{data.recordingEnabled ? "Enable automatic recording on one of your extensions, then complete a call." : data.recordingReason}</p></div>
          : <div className="table-wrap"><table className="recording-table customer-recording-table"><thead><tr><th>Started</th><th>From</th><th>To</th><th>Talk</th><th>Size</th><th>Playback</th><th aria-label="Actions" /></tr></thead><tbody>{data.recordings.map((recording) => <tr key={recording.id}><td>{formatCallTime(recording.startedAt)}</td><td><strong>{recording.source}</strong><small>{recording.callerName}</small></td><td><strong>{recording.destination}</strong></td><td>{formatDuration(recording.billableSeconds)}</td><td>{formatFileSize(recording.sizeBytes)}</td><td><audio controls preload="none" src={`/api/customer/recordings/${recording.id}/audio`} /></td><td><div className="recording-actions"><a href={`/api/customer/recordings/${recording.id}/audio?download=1`}>Download</a><button disabled={busy === recording.id} onClick={() => void remove(recording)}>{busy === recording.id ? "Deleting…" : "Delete"}</button></div></td></tr>)}</tbody></table></div>}
      <div className="portal-boundary-note"><strong>Private by design</strong><span>Only calls involving extensions assigned to this customer account can appear here. Provider costs and other customers’ recordings remain inaccessible.</span></div>
    </section>
  );
}

function CustomerRatesPanels({
  accountType,
  rateCardData,
  ratedCallsData,
  billingError,
  rateSearch,
  visibleRates,
  onRateSearch,
  onDismissError,
}: {
  accountType: "retail" | "wholesale";
  rateCardData: CustomerRateCardData | null;
  ratedCallsData: CustomerRatedCallsData | null;
  billingError: string;
  rateSearch: string;
  visibleRates: CustomerRateCardData["rates"];
  onRateSearch: (value: string) => void;
  onDismissError: () => void;
}) {
  const rateCard = rateCardData?.rateCard;
  const wholesale = accountType === "wholesale";
  const ratesHeading = wholesale ? "YOUR BUYING RATES" : "YOUR RATES";
  const rateLabel = wholesale ? "BUYING RATE" : "YOUR RATE";
  const rateColumn = wholesale ? "Buying rate per minute" : "Rate per minute";
  return (
    <>
      <section
        className="panel customer-rate-card-panel"
        id="customer-portal-rates"
      >
        <div className="panel-head">
          <div>
            <span>{ratesHeading}</span>
            <h3>{wholesale ? "Wholesale buying rates" : "Call rates"}</h3>
          </div>
          <span className="secure-pill">{rateLabel}</span>
        </div>
        {billingError && (
          <div className="page-error" role="alert">
            <span>{billingError}</span>
            <button onClick={onDismissError}>Dismiss</button>
          </div>
        )}
        {!rateCardData ? (
          <div className="empty-state">
            <div className="loader dark" />
            <p>Loading your rates…</p>
          </div>
        ) : !rateCard ? (
          <div className="empty-state customer-rate-empty">
            <div className="empty-icon">RC</div>
            <h3>No rate card assigned</h3>
            <p>
              Outbound calls remain blocked until an administrator assigns a
              matching rate card.
            </p>
          </div>
        ) : (
          <>
            <div className="customer-rate-summary">
              <div>
                <span>RATE CARD</span>
                <strong>{rateCard.name}</strong>
                <small>Updated {formatCallTime(rateCard.updatedAt)}</small>
              </div>
              <div>
                <span>CURRENCY</span>
                <strong>{rateCard.currency}</strong>
                <small>
                  {rateCard.enabled
                    ? "Active customer pricing"
                    : "Currently disabled"}
                </small>
              </div>
              <div>
                <span>DESTINATIONS</span>
                <strong>{rateCardData.rates.length}</strong>
                <small>Longest matching prefix applies</small>
              </div>
              <label>
                <span>FIND A RATE</span>
                <input
                  type="search"
                  value={rateSearch}
                  onChange={(event) => onRateSearch(event.target.value)}
                  placeholder="Country, destination or prefix"
                />
              </label>
            </div>
            <div className="customer-rate-privacy">
              <strong>Your rates are transparent.</strong>
              <span>
                {wholesale
                  ? "These are the buying rates charged to your wholesale account."
                  : "These are the call rates charged to your account."}{" "}
                Internal provider costs and platform margins are not part of
                your account pricing.
              </span>
            </div>
            {visibleRates.length === 0 ? (
              <div className="empty-state compact">
                <p>No rates match that search.</p>
              </div>
            ) : (
              <div className="table-wrap customer-rate-table-wrap">
                <table className="customer-rate-table">
                  <thead>
                    <tr>
                      <th>Prefix</th>
                      <th>Destination</th>
                      <th>{rateColumn}</th>
                      <th>Billing increment</th>
                      <th>Minimum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRates.map((rate) => (
                      <tr key={rate.id}>
                        <td>
                          <strong>+{rate.prefix}</strong>
                        </td>
                        <td>{rate.destinationName || "Other"}</td>
                        <td>
                          <strong>
                            {formatMoney(rate.ratePerMinute, rateCard.currency)}
                          </strong>
                        </td>
                        <td>{rate.billingIncrementSeconds}s</td>
                        <td>{rate.minimumSeconds}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
      <section className="panel customer-rated-calls-panel">
        <div className="panel-head">
          <div>
            <span>ITEMISED BILLING</span>
            <h3>Recent rated outbound calls</h3>
          </div>
          <span className="secure-pill">{rateLabel}</span>
        </div>
        {!ratedCallsData ? (
          <div className="empty-state">
            <div className="loader dark" />
            <p>Loading billed calls…</p>
          </div>
        ) : ratedCallsData.calls.length === 0 ? (
          <div className="empty-state customer-rate-empty">
            <div className="empty-icon">CDR</div>
            <h3>No rated calls yet</h3>
            <p>Answered outbound calls appear here after rating.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="customer-rated-call-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>From</th>
                  <th>Destination</th>
                  <th>Actual</th>
                  <th>Billed</th>
                  <th>{rateColumn}</th>
                  <th>Charge</th>
                </tr>
              </thead>
              <tbody>
                {ratedCallsData.calls.map((call) => (
                  <tr key={call.id}>
                    <td>{formatCallTime(call.callStartedAt)}</td>
                    <td>
                      <strong>{call.source}</strong>
                    </td>
                    <td>
                      <strong>+{call.destination}</strong>
                      <small>
                        {call.destinationName} · prefix +{call.matchedPrefix}
                      </small>
                    </td>
                    <td>{formatDuration(call.originalBillsec)}</td>
                    <td>
                      <strong>{formatDuration(call.chargedSeconds)}</strong>
                      <small>
                        {call.billingIncrementSeconds}s increment ·{" "}
                        {call.minimumSeconds}s minimum
                      </small>
                    </td>
                    <td>{formatMoney(call.ratePerMinute, call.currency)}</td>
                    <td>
                      <strong>{formatMoney(call.amount, call.currency)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function ResellerClientsPanel() {
  const [data, setData] = useState<ResellerClientData | null>(null);
  const [draft, setDraft] = useState<ResellerClientDraft | null>(null);
  const [passwordClient, setPasswordClient] = useState<ResellerClientData["clients"][number] | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      setData(await api<ResellerClientData>("/api/customer/reseller/clients"));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load reseller clients");
    }
  }

  useEffect(() => { void load(); }, []);

  function openCreate() {
    if (!data) return;
    let start = data.reseller.extensionRangeStart;
    for (const client of [...data.clients].sort((a, b) => a.extensionRangeStart - b.extensionRangeStart)) {
      if (start < client.extensionRangeStart) break;
      if (start <= client.extensionRangeEnd) start = client.extensionRangeEnd + 1;
    }
    const allowance = Math.max(1, Math.min(5, data.capacity.remainingExtensions));
    setDraft({
      name: "", billingEmail: "", billingMode: "prepaid", creditLimit: 0,
      extensionRangeStart: start,
      extensionRangeEnd: Math.min(data.reseller.extensionRangeEnd, start + allowance - 1),
      maxExtensions: allowance,
      maxDids: Math.min(1, data.capacity.remainingDids),
      recordingStorageMb: 0,
      loginDisplayName: "", loginEmail: "", loginPassword: "",
    });
  }

  async function createClient(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy("create"); setError(""); setNotice("");
    try {
      await api("/api/customer/reseller/clients", {
        method: "POST", body: JSON.stringify(draft),
      });
      setDraft(null);
      setNotice("Client account and private portal login created.");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create client");
    } finally { setBusy(""); }
  }

  async function changeStatus(client: ResellerClientData["clients"][number]) {
    setBusy(client.id); setError(""); setNotice("");
    try {
      await api(`/api/customer/reseller/clients/${client.id}/status`, {
        method: "PATCH", body: JSON.stringify({ active: !client.active }),
      });
      setNotice(`${client.name} ${client.active ? "suspended" : "activated"}.`);
      await load();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Could not change client status");
    } finally { setBusy(""); }
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    if (!passwordClient) return;
    setBusy("password"); setError("");
    try {
      await api(`/api/customer/reseller/clients/${passwordClient.id}/reset-password`, {
        method: "POST", body: JSON.stringify({ password: newPassword }),
      });
      setNotice(`${passwordClient.name}'s portal password was reset and existing sessions ended.`);
      setPasswordClient(null); setNewPassword("");
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : "Could not reset password");
    } finally { setBusy(""); }
  }

  return (
    <section className="panel reseller-clients-panel" id="customer-portal-clients">
      <div className="panel-head">
        <div><span>RESELLER WORKSPACE</span><h3>My client accounts</h3></div>
        <button className="primary-button compact" disabled={!data || data.capacity.remainingExtensions < 1} onClick={openCreate}>Add client</button>
      </div>
      {error && <div className="page-error" role="alert"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
      {notice && <div className="studio-notice" role="status">{notice}</div>}
      {!data ? <div className="empty-state"><div className="loader dark" /><p>Loading reseller capacity…</p></div> : <>
        <div className="reseller-capacity-grid">
          <article><span>CLIENTS</span><strong>{data.clients.length}</strong><small>Private tenant accounts</small></article>
          <article><span>EXTENSIONS AVAILABLE</span><strong>{data.capacity.remainingExtensions}</strong><small>{data.capacity.allocatedExtensions} delegated · {data.capacity.ownExtensions} used directly</small></article>
          <article><span>DIDS AVAILABLE</span><strong>{data.capacity.remainingDids}</strong><small>{data.capacity.allocatedDids} delegated</small></article>
          <article><span>RECORDING AVAILABLE</span><strong>{data.capacity.remainingRecordingStorageMb} MB</strong><small>{data.capacity.allocatedRecordingStorageMb} MB delegated</small></article>
        </div>
        <div className="reseller-range-note"><strong>Master extension range</strong><span>{data.reseller.extensionRangeStart}–{data.reseller.extensionRangeEnd}</span><small>Every client sub-range must remain inside this range and cannot overlap another client.</small></div>
        {data.clients.length === 0 ? <div className="empty-state reseller-client-empty"><div className="empty-icon">CL</div><h3>No clients yet</h3><p>Create the first isolated client account and allocate part of your extension allowance.</p></div> :
          <div className="table-wrap">
            <table className="reseller-client-table">
              <thead>
                <tr>
                  <th>Client</th><th>Portal login</th><th>Extension range</th>
                  <th>Usage</th><th>Billing</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {data.clients.map((client) => (
                  <tr key={client.id}>
                    <td><strong>{client.name}</strong><small>{client.accountNumber}</small></td>
                    <td><strong>{client.loginEmail}</strong><small>{client.billingEmail}</small></td>
                    <td><strong>{client.extensionRangeStart}–{client.extensionRangeEnd}</strong><small>{client.maxExtensions} extension allowance</small></td>
                    <td><strong>{client.extensionCount} ext · {client.didCount} DID</strong><small>{client.recordingStorageMb} MB recording</small></td>
                    <td>
                      <strong>{client.billingMode}</strong>
                      <small>
                        {client.billingMode === "postpaid"
                          ? `${formatMoney(client.creditLimit, data.reseller.currency)} limit`
                          : `${formatMoney(client.balance, data.reseller.currency)} balance`}
                      </small>
                    </td>
                    <td><span className={`customer-status ${client.active ? "active" : "disabled"}`}>{client.active ? "ACTIVE" : "SUSPENDED"}</span></td>
                    <td><div className="reseller-client-actions"><button onClick={() => { setPasswordClient(client); setNewPassword(""); }}>Reset password</button><button disabled={busy === client.id} onClick={() => void changeStatus(client)}>{client.active ? "Suspend" : "Activate"}</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        <div className="portal-boundary-note"><strong>Strictly isolated</strong><span>Each client receives a separate login and can see only its extensions, calls, recordings, wallet and invoices. Provider costs and your other clients stay private.</span></div>
      </>}
      {draft && <Modal title="Add reseller client" onClose={() => setDraft(null)}><form className="modal-form reseller-client-form" onSubmit={createClient}>
        <div className="form-section"><span>CLIENT IDENTITY</span><p>Create the organisation and its private portal administrator.</p></div>
        <div className="form-grid"><label><span>Client name</span><input required minLength={2} maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label><span>Billing email</span><input required type="email" value={draft.billingEmail} onChange={(event) => setDraft({ ...draft, billingEmail: event.target.value })} /></label></div>
        <div className="form-grid"><label><span>Portal administrator</span><input required minLength={2} value={draft.loginDisplayName} onChange={(event) => setDraft({ ...draft, loginDisplayName: event.target.value })} /></label><label><span>Portal login email</span><input required type="email" value={draft.loginEmail} onChange={(event) => setDraft({ ...draft, loginEmail: event.target.value })} /></label></div>
        <label><span>Temporary portal password</span><input required type="password" minLength={12} value={draft.loginPassword} onChange={(event) => setDraft({ ...draft, loginPassword: event.target.value })} /><small>At least 12 characters. Send it to the client through a secure channel.</small></label>
        <div className="form-section"><span>DELEGATED SERVICES</span><p>Allowances are deducted from your reseller plan.</p></div>
        <div className="form-grid"><label><span>Range start</span><input required type="number" value={draft.extensionRangeStart} onChange={(event) => setDraft({ ...draft, extensionRangeStart: Number(event.target.value) })} /></label><label><span>Range end</span><input required type="number" value={draft.extensionRangeEnd} onChange={(event) => setDraft({ ...draft, extensionRangeEnd: Number(event.target.value) })} /></label></div>
        <div className="form-grid"><label><span>Extension allowance</span><input required type="number" min="1" max={data?.capacity.remainingExtensions ?? 1} value={draft.maxExtensions} onChange={(event) => setDraft({ ...draft, maxExtensions: Number(event.target.value) })} /></label><label><span>DID allowance</span><input required type="number" min="0" max={data?.capacity.remainingDids ?? 0} value={draft.maxDids} onChange={(event) => setDraft({ ...draft, maxDids: Number(event.target.value) })} /></label></div>
        <label><span>Recording storage (MB)</span><input required type="number" min="0" max={data?.capacity.remainingRecordingStorageMb ?? 0} value={draft.recordingStorageMb} onChange={(event) => setDraft({ ...draft, recordingStorageMb: Number(event.target.value) })} /></label>
        <div className="form-section"><span>BILLING PROFILE</span></div>
        <div className="form-grid"><label><span>Billing mode</span><select value={draft.billingMode} onChange={(event) => setDraft({ ...draft, billingMode: event.target.value as "prepaid" | "postpaid", creditLimit: event.target.value === "prepaid" ? 0 : draft.creditLimit })}><option value="prepaid">Prepaid</option><option value="postpaid">Postpaid</option></select></label><label><span>Credit limit</span><input required type="number" min="0" disabled={draft.billingMode === "prepaid"} value={draft.creditLimit} onChange={(event) => setDraft({ ...draft, creditLimit: Number(event.target.value) })} /></label></div>
        <div className="notice warning"><strong>Outbound rates are assigned separately</strong><span>The client can use PBX services immediately. Outbound calling remains blocked until client selling rates are configured in the reseller billing milestone.</span></div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setDraft(null)}>Cancel</button><button className="primary-button" disabled={busy === "create"}>{busy === "create" ? "Creating…" : "Create client"}</button></div>
      </form></Modal>}
      {passwordClient && <Modal title={`Reset password · ${passwordClient.name}`} onClose={() => setPasswordClient(null)}><form className="modal-form" onSubmit={resetPassword}><div className="notice warning"><strong>Existing sessions will end</strong><span>The client must use the new password on the next sign-in.</span></div><label><span>New portal password</span><input required type="password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>{error && <div className="form-error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPasswordClient(null)}>Cancel</button><button className="primary-button" disabled={busy === "password"}>{busy === "password" ? "Resetting…" : "Reset password"}</button></div></form></Modal>}
    </section>
  );
}

function brandingDraftFrom(data: BrandingSettingsData): BrandingDraft {
  return {
    slug: data.branding.slug,
    brandName: data.branding.brandName,
    portalTitle: data.branding.portalTitle,
    primaryColor: data.branding.primaryColor,
    accentColor: data.branding.accentColor,
    supportEmail: data.branding.supportEmail,
    supportPhone: data.branding.supportPhone,
    websiteUrl: data.branding.websiteUrl,
    enabled: data.enabled,
  };
}

function ResellerBrandingPanel({
  onSaved,
}: {
  onSaved: (branding: PortalBranding | null) => void;
}) {
  const [settings, setSettings] = useState<BrandingSettingsData | null>(null);
  const [draft, setDraft] = useState<BrandingDraft | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      const result = await api<BrandingSettingsData>("/api/customer/branding");
      setSettings(result);
      setDraft(brandingDraftFrom(result));
      setError("");
      return result;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load branding settings");
      return null;
    }
  }

  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy("save"); setError(""); setNotice("");
    try {
      await api("/api/customer/branding", {
        method: "PATCH", body: JSON.stringify(draft),
      });
      if (logoDataUrl) {
        await api("/api/customer/branding/logo", {
          method: "PUT", body: JSON.stringify({ dataUrl: logoDataUrl }),
        });
      }
      setLogoDataUrl("");
      const refreshed = await load();
      if (refreshed) onSaved(refreshed.enabled ? refreshed.branding : null);
      setNotice("Branding saved. The reseller and all client portals now use this identity.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save branding");
    } finally { setBusy(""); }
  }

  async function removeLogo() {
    setBusy("logo"); setError(""); setNotice("");
    try {
      await api("/api/customer/branding/logo", { method: "DELETE" });
      setLogoDataUrl("");
      const refreshed = await load();
      if (refreshed) onSaved(refreshed.enabled ? refreshed.branding : null);
      setNotice("Logo removed.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove logo");
    } finally { setBusy(""); }
  }

  function chooseLogo(file: File | undefined) {
    setError("");
    if (!file) { setLogoDataUrl(""); return; }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPEG or WebP logo"); return;
    }
    if (file.size > 384 * 1024) {
      setError("Logo must be smaller than 384 KB"); return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setLogoDataUrl(reader.result);
    };
    reader.onerror = () => setError("The logo could not be read");
    reader.readAsDataURL(file);
  }

  async function copyLoginLink() {
    if (!draft) return;
    const link = `${window.location.origin}/login/${draft.slug}`;
    try {
      await navigator.clipboard.writeText(link);
      setNotice("Branded login link copied.");
    } catch {
      setNotice(link);
    }
  }

  if (!draft || !settings) {
    return (
      <section className="panel reseller-branding-panel" id="customer-portal-branding">
        {error ? (
          <div className="empty-state">
            <div className="empty-icon">BR</div>
            <h3>Branding could not be loaded</h3>
            <p>{error}</p>
            <button type="button" className="secondary-button" onClick={() => { setError(""); void load(); }}>
              Try again
            </button>
          </div>
        ) : (
          <div className="empty-state"><div className="loader dark" /><p>Loading white-label workspace…</p></div>
        )}
      </section>
    );
  }
  const previewBrand: PortalBranding = {
    ...draft,
    logoUrl: logoDataUrl || settings.branding.logoUrl,
    loginPath: `/login/${draft.slug}`,
  };

  return (
    <section className="panel reseller-branding-panel" id="customer-portal-branding">
      <div className="panel-head"><div><span>WHITE-LABEL PORTAL</span><h3>Branding and client login</h3></div><span className={`secure-pill ${draft.enabled ? "" : "disabled"}`}>{draft.enabled ? "PUBLISHED" : "HIDDEN"}</span></div>
      {error && <div className="page-error" role="alert"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
      {notice && <div className="studio-notice" role="status"><span>{notice}</span></div>}
      <div className="branding-workspace">
        <form className="branding-form" onSubmit={save}>
          <div className="form-section"><span>BRAND IDENTITY</span><p>This identity is inherited by every client account that you create.</p></div>
          <div className="form-grid"><label><span>Business or brand name</span><input required minLength={2} maxLength={120} value={draft.brandName} onChange={(event) => setDraft({ ...draft, brandName: event.target.value })} /></label><label><span>Portal title</span><input required minLength={2} maxLength={160} value={draft.portalTitle} onChange={(event) => setDraft({ ...draft, portalTitle: event.target.value })} /></label></div>
          <label><span>Branded login address</span><div className="branding-slug-input"><span>{window.location.origin}/login/</span><input required minLength={3} maxLength={63} pattern="[a-z0-9][a-z0-9-]{1,61}[a-z0-9]" value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} /></div><small>Give this link to your clients. Their login is restricted to your brand.</small></label>
          <div className="form-grid branding-colours"><label><span>Primary colour</span><input type="color" value={draft.primaryColor} onChange={(event) => setDraft({ ...draft, primaryColor: event.target.value.toUpperCase() })} /></label><label><span>Accent colour</span><input type="color" value={draft.accentColor} onChange={(event) => setDraft({ ...draft, accentColor: event.target.value.toUpperCase() })} /></label></div>
          <label><span>Logo</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => chooseLogo(event.target.files?.[0])} /><small>PNG, JPEG or WebP, maximum 384 KB. SVG files are not accepted.</small></label>
          {(settings.branding.logoUrl || logoDataUrl) && <button type="button" className="branding-remove-logo" disabled={busy === "logo"} onClick={() => void removeLogo()}>Remove current logo</button>}
          <div className="form-section"><span>CLIENT SUPPORT</span><p>These details are safe to show on client login and portal pages.</p></div>
          <div className="form-grid"><label><span>Support email</span><input type="email" maxLength={254} value={draft.supportEmail} onChange={(event) => setDraft({ ...draft, supportEmail: event.target.value })} /></label><label><span>Support telephone</span><input maxLength={40} value={draft.supportPhone} onChange={(event) => setDraft({ ...draft, supportPhone: event.target.value })} /></label></div>
          <label><span>Website</span><input type="url" maxLength={500} placeholder="https://example.com" value={draft.websiteUrl} onChange={(event) => setDraft({ ...draft, websiteUrl: event.target.value })} /></label>
          <label className="toggle-field branding-publish"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span><strong>Publish white-label portal</strong><small>When disabled, clients fall back to Netbrowse Voice branding.</small></span></label>
          <div className="branding-actions"><button type="button" className="secondary-button" onClick={() => void copyLoginLink()}>Copy login link</button><button className="primary-button compact" disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save branding"}</button></div>
        </form>
        <aside className="branding-preview" style={brandingStyle(previewBrand)}>
          <span>LIVE PREVIEW</span>
          <div className="branding-preview-card">
            <Brand branding={previewBrand} />
            <div><small>PRIVATE CUSTOMER ACCESS</small><h4>{draft.portalTitle}</h4><p>Secure communications services provided by {draft.brandName}.</p></div>
            <button type="button">Sign in</button>
          </div>
          <dl><div><dt>Client inheritance</dt><dd>Automatic</dd></div><div><dt>Invoices</dt><dd>Branded</dd></div><div><dt>Custom domain</dt><dd>Next stage</dd></div></dl>
        </aside>
      </div>
    </section>
  );
}

function CustomerDidMarketplacePanel({
  onPurchased,
}: {
  onPurchased: () => Promise<void>;
}) {
  const [data, setData] = useState<CustomerDidMarketplaceData | null>(null);
  const [selected, setSelected] = useState<CustomerMarketplaceNumber | null>(null);
  const [destinationExtensionId, setDestinationExtensionId] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      const result = await api<CustomerDidMarketplaceData>("/api/customer/did-marketplace");
      setData(result);
      setError("");
      return result;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load available numbers");
      return null;
    }
  }

  useEffect(() => { void load(); }, []);

  function choose(number: CustomerMarketplaceNumber) {
    setSelected(number);
    setDestinationExtensionId(data?.extensions[0]?.id ?? "");
    setError(""); setNotice("");
  }

  async function purchase(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy("purchase"); setError(""); setNotice("");
    try {
      const result = await api<{
        purchase: { didNumber: string; destinationExtension: string; chargedAmount: number; currency: string };
      }>(`/api/customer/did-marketplace/${selected.id}/purchase`, {
        method: "POST",
        body: JSON.stringify({ destinationExtensionId }),
      });
      setSelected(null);
      setNotice(`${result.purchase.didNumber} is active and routes to extension ${result.purchase.destinationExtension}.`);
      const [, portalRefresh] = await Promise.allSettled([load(), onPurchased()]);
      if (portalRefresh.status === "rejected") {
        setError("The number is active, but the account summary could not refresh. Reload the page to update it.");
      }
    } catch (purchaseError) {
      setError(purchaseError instanceof Error ? purchaseError.message : "The number could not be purchased");
    } finally { setBusy(""); }
  }

  const query = search.trim().toLowerCase();
  const numbers = data?.numbers.filter((number) =>
    !query || number.didNumber.includes(query)
      || number.countryCode.toLowerCase().includes(query)
      || number.region.toLowerCase().includes(query)
      || number.locality.toLowerCase().includes(query)
  ) ?? [];

  return (
    <section className="panel customer-did-marketplace" id="customer-portal-numbers">
      <div className="panel-head"><div><span>NUMBER MARKETPLACE</span><h3>Choose an inbound business number</h3></div>{data && <span className="secure-pill">{data.allowance.remaining} AVAILABLE ON PLAN</span>}</div>
      {error && <div className="page-error" role="alert"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
      {notice && <div className="studio-notice" role="status"><span>{notice}</span></div>}
      {!data ? <div className="empty-state"><div className="loader dark" /><p>Loading available numbers…</p></div> : <>
        <div className="did-marketplace-account"><div><span>AVAILABLE CREDIT</span><strong>{formatMoney(data.account.availableCredit, data.account.currency)}</strong><small>{data.account.billingMode === "prepaid" ? "Charged immediately from your wallet" : "Charged against your postpaid limit"}</small></div><div><span>DID ALLOWANCE</span><strong>{data.allowance.used} / {data.allowance.maximum}</strong><small>{data.allowance.remaining} remaining{data.allowance.delegated > 0 ? ` · ${data.allowance.delegated} delegated` : ""}</small></div><label><span>Find a number</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search number, city or region…" /></label></div>
        {!data.purchase.allowed && <div className="portal-boundary-note"><strong>Purchasing unavailable</strong><span>{data.purchase.reason}</span></div>}
        {data.ownedNumbers.length > 0 && <div className="owned-did-list"><h4>Your purchased numbers</h4>{data.ownedNumbers.map((number) => <article key={number.purchaseId}><div><strong>{number.didNumber}</strong><small>{[number.locality, number.region].filter(Boolean).join(", ") || number.countryCode} · Routes to {number.destinationNumber ?? "assigned destination"}</small></div><div><span className={`inventory-status ${number.status === "active" ? "assigned" : "disabled"}`}>{number.status.replace("_", " ")}</span><small>{formatMoney(number.monthlyPrice, number.currency)} monthly · renews {new Date(number.nextRenewalAt).toLocaleDateString()}</small></div></article>)}</div>}
        <div className="customer-number-grid">{numbers.length === 0 ? <div className="empty-state compact"><div className="empty-icon">DID</div><h3>No matching numbers</h3><p>Ask your provider to add stock in your account currency.</p></div> : numbers.map((number) => <article className="customer-number-card" key={number.id}><header><span>{number.countryCode}</span><small>{[number.locality, number.region].filter(Boolean).join(", ") || "National number"}</small></header><strong>{number.didNumber}</strong><dl><div><dt>Setup</dt><dd>{formatMoney(number.setupPrice, number.currency)}</dd></div><div><dt>Monthly</dt><dd>{formatMoney(number.monthlyPrice, number.currency)}</dd></div><div><dt>Due today</dt><dd>{formatMoney(number.dueToday, number.currency)}</dd></div></dl><button disabled={!data.purchase.allowed} onClick={() => choose(number)}>Choose number</button></article>)}</div>
      </>}
      {selected && data && <Modal title={`Purchase ${selected.didNumber}`} onClose={() => setSelected(null)}><form className="modal-form" onSubmit={purchase}>
        <p className="modal-intro">This number will be activated immediately and billed to your {data.account.billingMode} account.</p>
        <label><span>Route incoming calls to</span><select required value={destinationExtensionId} onChange={(event) => setDestinationExtensionId(event.target.value)}><option value="">Choose an extension</option>{data.extensions.map((extension) => <option key={extension.id} value={extension.id}>{extension.extensionNumber} · {extension.displayName}</option>)}</select></label>
        <div className="purchase-breakdown"><div><span>One-time setup</span><strong>{formatMoney(selected.setupPrice, selected.currency)}</strong></div><div><span>First month</span><strong>{formatMoney(selected.monthlyPrice, selected.currency)}</strong></div><div className="total"><span>Due now</span><strong>{formatMoney(selected.dueToday, selected.currency)}</strong></div><small>Future renewals are {formatMoney(selected.monthlyPrice, selected.currency)} per month. Insufficient credit suspends inbound routing until payment is available.</small></div>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setSelected(null)}>Cancel</button><button className="primary-button" disabled={busy === "purchase"}>{busy === "purchase" ? "Activating number…" : `Confirm ${formatMoney(selected.dueToday, selected.currency)}`}</button></div>
      </form></Modal>}
    </section>
  );
}

let paypalSdkPromise: Promise<PayPalSdk> | null = null;
let paypalSdkKey = "";

function loadPayPalSdk(clientId: string, currency: string): Promise<PayPalSdk> {
  const key = `${clientId}:${currency}`;
  if (window.paypal && (!paypalSdkKey || paypalSdkKey === key)) {
    paypalSdkKey = key;
    return Promise.resolve(window.paypal);
  }
  if (window.paypal && paypalSdkKey !== key) {
    return Promise.reject(new Error("Reload the page before switching the PayPal account or currency"));
  }
  if (paypalSdkPromise && paypalSdkKey === key) return paypalSdkPromise;
  if (paypalSdkPromise && paypalSdkKey !== key) {
    return Promise.reject(new Error("Reload the page before switching the PayPal account or currency"));
  }
  paypalSdkKey = key;
  paypalSdkPromise = new Promise<PayPalSdk>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture&components=buttons`;
    script.async = true;
    script.dataset.netbrowsePaypal = "true";
    script.onload = () => window.paypal
      ? resolve(window.paypal)
      : reject(new Error("PayPal did not load correctly"));
    script.onerror = () => reject(new Error("PayPal could not be loaded"));
    document.head.append(script);
  });
  return paypalSdkPromise;
}

/**
 * The merchant secret is deliberately write-only.  The API never returns it
 * and the browser clears the input after every successful save.
 */
function PayPalSandboxSettingsPanel() {
  const [settings, setSettings] = useState<PayPalGatewaySettings | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [minimumTopup, setMinimumTopup] = useState("10.00");
  const [maximumTopup, setMaximumTopup] = useState("500.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      const current = await api<PayPalGatewaySettings>(
        "/api/billing/payments/paypal/settings",
      );
      setSettings(current);
      setClientId(current.clientId);
      setMinimumTopup(current.minimumTopup.toFixed(2));
      setMaximumTopup(current.maximumTopup.toFixed(2));
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load PayPal Sandbox settings",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await api<PayPalGatewaySettings>(
        "/api/billing/payments/paypal/settings",
        {
          method: "PATCH",
          body: JSON.stringify({
            clientId,
            clientSecret,
            minimumTopup: Number(minimumTopup),
            maximumTopup: Number(maximumTopup),
          }),
        },
      );
      setSettings(saved);
      setClientId(saved.clientId);
      setClientSecret("");
      setMinimumTopup(saved.minimumTopup.toFixed(2));
      setMaximumTopup(saved.maximumTopup.toFixed(2));
      setNotice(
        "PayPal Sandbox details were saved. New wallet top-ups will use them immediately.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "PayPal Sandbox settings could not be saved",
      );
    } finally {
      setBusy(false);
    }
  }

  const sourceLabel = settings?.source === "gui"
    ? "GUI SETTINGS"
    : settings?.source === "environment"
      ? "SERVER FALLBACK"
      : "NOT CONFIGURED";
  const needsSecret = settings?.source !== "gui" || !settings?.secretConfigured;

  return (
    <section className="panel paypal-gateway-settings">
      <div className="panel-head">
        <div>
          <span>PAYMENT GATEWAY</span>
          <h3>PayPal Sandbox</h3>
        </div>
        <span className={`paypal-mode ${settings?.configured ? "sandbox" : "disabled"}`}>
          {sourceLabel}
        </span>
      </div>
      {error && <div className="paypal-message error" role="alert">{error}</div>}
      {notice && <div className="paypal-message notice" role="status">{notice}</div>}
      {!settings ? (
        <div className="paypal-loading"><div className="loader dark" /><span>Loading secure payment settings…</span></div>
      ) : (
        <form className="paypal-gateway-form" onSubmit={save}>
          <div className="paypal-gateway-intro">
            <strong>Sandbox only</strong>
            <span>
              This owner-only panel controls customer wallet top-ups. Live payments stay disabled in this hackathon build.
            </span>
          </div>
          <div className="paypal-gateway-grid">
            <label>
              <span>Sandbox client ID</span>
              <input
                required
                minLength={16}
                maxLength={256}
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="Paste the PayPal Sandbox client ID"
                autoComplete="off"
              />
            </label>
            <label>
              <span>Sandbox client secret</span>
              <input
                required={needsSecret}
                type="password"
                minLength={16}
                maxLength={256}
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder={
                  settings.secretConfigured
                    ? "Saved securely — leave blank to keep it"
                    : "Paste the PayPal Sandbox client secret"
                }
                autoComplete="new-password"
              />
              <small>
                {settings.secretConfigured
                  ? "The saved secret is never shown again. Leave this blank to retain it."
                  : "Required on the first GUI save."}
              </small>
            </label>
            <label>
              <span>Minimum wallet top-up</span>
              <input
                required
                inputMode="decimal"
                value={minimumTopup}
                onChange={(event) => setMinimumTopup(event.target.value)}
              />
            </label>
            <label>
              <span>Maximum wallet top-up</span>
              <input
                required
                inputMode="decimal"
                value={maximumTopup}
                onChange={(event) => setMaximumTopup(event.target.value)}
              />
            </label>
          </div>
          <div className="paypal-gateway-actions">
            <button className="primary-button compact" disabled={busy}>
              {busy ? "Saving details…" : "Save Sandbox details"}
            </button>
            <small>
              The secret is encrypted before storage and cannot be read back from this panel. Use credentials supplied by the authorised business owner.
            </small>
          </div>
        </form>
      )}
    </section>
  );
}

function PayPalWalletTopupPanel({
  currency,
  billingMode,
  onCredited,
}: {
  currency: string;
  billingMode: "prepaid" | "postpaid";
  onCredited: () => Promise<void>;
}) {
  const [gateway, setGateway] = useState<PayPalCheckoutConfig | null>(null);
  const [amount, setAmount] = useState("25.00");
  const [sdkReady, setSdkReady] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [pendingCheckoutId, setPendingCheckoutId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const buttonContainer = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const configuration = await api<PayPalCheckoutConfig>(
          "/api/customer/payments/paypal/config",
        );
        if (cancelled) return;
        setGateway(configuration);
        setAmount(
          configuration.minimumTopup.toFixed(
            ["HUF", "JPY", "TWD"].includes(configuration.currency) ? 0 : 2,
          ),
        );
        setError("");
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Could not load PayPal checkout",
          );
        }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [currency, billingMode]);

  useEffect(() => {
    if (!gateway?.available || !gateway.clientId) return;
    let cancelled = false;
    void loadPayPalSdk(gateway.clientId, gateway.currency)
      .then(() => { if (!cancelled) setSdkReady(true); })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load PayPal checkout");
        }
      });
    return () => { cancelled = true; };
  }, [gateway?.available, gateway?.clientId, gateway?.currency]);

  async function captureCheckout(checkoutId: string) {
    setBusy(true);
    setError("");
    try {
      const receipt = await api<{
        amount: number;
        currency: string;
        alreadyCaptured?: boolean;
      }>(`/api/customer/payments/paypal/orders/${checkoutId}/capture`, {
        method: "POST",
        body: "{}",
      });
      setPendingCheckoutId(null);
      setCheckoutOpen(false);
      setNotice(
        receipt.alreadyCaptured
          ? "This PayPal payment was already credited to your wallet."
          : `${formatMoney(receipt.amount, receipt.currency)} was added to your wallet.`,
      );
      await onCredited();
    } catch (captureError) {
      setError(
        captureError instanceof Error
          ? captureError.message
          : "PayPal could not confirm this payment",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!checkoutOpen || !gateway?.available || !gateway.clientId || !sdkReady) return;
    const container = buttonContainer.current;
    const sdk = window.paypal;
    if (!container || !sdk) return;
    let cancelled = false;
    let order: PayPalCheckoutOrder | null = null;
    let buttons: PayPalButtons | null = null;
    container.replaceChildren();
    try {
      buttons = sdk.Buttons({
        style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal" },
        createOrder: async () => {
          if (order) return order.orderId;
          const created = await api<PayPalCheckoutOrder>(
            "/api/customer/payments/paypal/orders",
            { method: "POST", body: JSON.stringify({ amount }) },
          );
          if (cancelled) throw new Error("PayPal checkout was closed");
          order = created;
          setPendingCheckoutId(created.checkoutId);
          return created.orderId;
        },
        onApprove: async (approval) => {
          if (!order || !order.checkoutId || approval.orderID !== order.orderId) {
            setError("PayPal approval did not match this wallet top-up");
            return;
          }
          await captureCheckout(order.checkoutId);
        },
        onCancel: () => setNotice("PayPal checkout was cancelled. No wallet credit was added."),
        onError: () => setError("PayPal checkout could not be completed. Try again or retry confirmation."),
      });
      void Promise.resolve(buttons.render(container)).catch(() => {
        if (!cancelled) setError("PayPal checkout could not be displayed");
      });
    } catch {
      setError("PayPal checkout could not be displayed");
    }
    return () => {
      cancelled = true;
      void buttons?.close?.();
      container.replaceChildren();
    };
  }, [amount, checkoutOpen, gateway?.available, gateway?.clientId, gateway?.currency, sdkReady]);

  const paymentReady = gateway?.available === true && sdkReady;

  return (
    <div className="paypal-wallet-topup">
      <div className="paypal-wallet-topup-head">
        <div>
          <span>ADD WALLET CREDIT</span>
          <h4>Pay with PayPal</h4>
        </div>
        {gateway && <span className={`paypal-mode ${gateway.available ? gateway.mode : "disabled"}`}>
          {gateway.available ? gateway.mode : "unavailable"}
        </span>}
      </div>
      {error && <div className="paypal-message error" role="alert">{error}</div>}
      {notice && <div className="paypal-message notice" role="status">{notice}</div>}
      {!gateway ? (
        <div className="paypal-loading"><div className="loader dark" /><span>Checking PayPal checkout…</span></div>
      ) : !gateway.available ? (
        <div className="portal-boundary-note">
          <strong>PayPal unavailable</strong><span>{gateway.reason}</span>
        </div>
      ) : (
        <>
          <div className="paypal-topup-form">
            <label>
              <span>Amount ({gateway.currency})</span>
              <input
                inputMode="decimal"
                value={amount}
                disabled={checkoutOpen || busy}
                onChange={(event) => setAmount(event.target.value)}
                aria-label="Wallet top-up amount"
              />
              <small>
                From {formatMoney(gateway.minimumTopup, gateway.currency)} to {formatMoney(gateway.maximumTopup, gateway.currency)}
              </small>
            </label>
            {!checkoutOpen && <button
              type="button"
              className="primary-button compact"
              disabled={!paymentReady}
              onClick={() => { setError(""); setNotice(""); setCheckoutOpen(true); }}
            >
              {sdkReady ? "Continue to PayPal" : "Loading PayPal…"}
            </button>}
          </div>
          {checkoutOpen && <div className="paypal-button-stage">
            <div ref={buttonContainer} />
            {busy && <p>Confirming your payment and crediting the wallet…</p>}
            {pendingCheckoutId && error && <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void captureCheckout(pendingCheckoutId)}
            >
              Retry confirmation
            </button>}
            <button
              type="button"
              className="paypal-cancel"
              disabled={busy}
              onClick={() => { setCheckoutOpen(false); setPendingCheckoutId(null); }}
            >
              Cancel checkout
            </button>
          </div>}
          <small className="paypal-security-note">
            PayPal processes the payment. Netbrowse Voice credits your wallet only after a completed payment is verified.
          </small>
        </>
      )}
      {billingMode === "postpaid" && <small className="paypal-security-note">Postpaid accounts use invoices rather than wallet top-ups.</small>}
    </div>
  );
}

function CustomerPortal({
  initialData,
  onLogout,
}: {
  initialData: CustomerPortalData;
  onLogout: () => Promise<void>;
}) {
  type PortalExtension = CustomerPortalData["extensions"][number];
  const [data, setData] = useState(initialData);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [portalBusy, setPortalBusy] = useState("");
  const [newExtension, setNewExtension] = useState<{
    displayName: string;
    maxContacts: number;
  } | null>(null);
  const [editingExtension, setEditingExtension] =
    useState<PortalExtension | null>(null);
  const [voicemailPin, setVoicemailPin] = useState("");
  const [extensionCredentials, setExtensionCredentials] =
    useState<SipCredentials | null>(null);
  const [billingError, setBillingError] = useState("");
  const [rateCardData, setRateCardData] = useState<CustomerRateCardData | null>(
    null,
  );
  const [ratedCallsData, setRatedCallsData] =
    useState<CustomerRatedCallsData | null>(null);
  const [rateSearch, setRateSearch] = useState("");
  const [activeSection, setActiveSection] = useState<CustomerSection>(() =>
    customerSectionFromPath(window.location.pathname),
  );

  async function refreshPortal() {
    setData(await api<CustomerPortalData>("/api/customer/portal"));
    setError("");
  }

  async function createPortalExtension(event: FormEvent) {
    event.preventDefault();
    if (!newExtension) return;
    setPortalBusy("create-extension");
    setError("");
    try {
      const result = await api<{ credentials: SipCredentials }>(
        "/api/customer/extensions",
        { method: "POST", body: JSON.stringify(newExtension) },
      );
      setExtensionCredentials(result.credentials);
      setNewExtension(null);
      setNotice("Extension created. Copy the SIP password now; it is shown only once.");
      await refreshPortal();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the extension");
    } finally {
      setPortalBusy("");
    }
  }

  async function savePortalExtension(event: FormEvent) {
    event.preventDefault();
    if (!editingExtension) return;
    setPortalBusy("save-extension");
    setError("");
    try {
      await api(`/api/customer/extensions/${editingExtension.id}/services`, {
        method: "PATCH",
        body: JSON.stringify({
          ringTimeoutSeconds: editingExtension.ringTimeoutSeconds,
          voicemailEnabled: editingExtension.voicemailEnabled,
          voicemailPin: voicemailPin || undefined,
          dndEnabled: editingExtension.dndEnabled,
          callWaiting: editingExtension.callWaiting,
          recordCalls: editingExtension.recordCalls,
          forwardMode: editingExtension.forwardMode,
          forwardExtensionId: editingExtension.forwardExtensionId,
        }),
      });
      setEditingExtension(null);
      setVoicemailPin("");
      setNotice("Extension services updated.");
      await refreshPortal();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update extension services");
    } finally {
      setPortalBusy("");
    }
  }

  async function resetPortalExtension(extension: PortalExtension) {
    if (!window.confirm(`Reset the SIP password for extension ${extension.extensionNumber}?`)) return;
    setPortalBusy(`reset-${extension.id}`);
    setError("");
    try {
      const result = await api<{ credentials: SipCredentials }>(
        `/api/customer/extensions/${extension.id}/reset-secret`,
        { method: "POST", body: "{}" },
      );
      setExtensionCredentials(result.credentials);
      setNotice("SIP password reset. Copy the new password now; it is shown only once.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Could not reset the SIP password");
    } finally {
      setPortalBusy("");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const snapshot = await api<CustomerPortalData>("/api/customer/portal");
        if (!cancelled) {
          setData(snapshot);
          setError("");
        }
      } catch (refreshError) {
        if (!cancelled)
          setError(
            refreshError instanceof Error
              ? refreshError.message
              : "Could not refresh portal",
          );
      }
    }
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadBillingDetails() {
      try {
        const [rateCard, ratedCalls] = await Promise.all([
          api<CustomerRateCardData>("/api/customer/rate-card"),
          api<CustomerRatedCallsData>("/api/customer/rated-calls"),
        ]);
        if (!cancelled) {
          setRateCardData(rateCard);
          setRatedCallsData(ratedCalls);
          setBillingError("");
        }
      } catch (loadError) {
        if (!cancelled)
          setBillingError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load customer rates",
          );
      }
    }
    async function refreshRatedCalls() {
      try {
        const ratedCalls = await api<CustomerRatedCallsData>(
          "/api/customer/rated-calls",
        );
        if (!cancelled) setRatedCallsData(ratedCalls);
      } catch {
        // The main error state remains stable during background refreshes.
      }
    }
    void loadBillingDetails();
    const timer = window.setInterval(() => void refreshRatedCalls(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    function restoreSection() {
      const section = customerSectionFromPath(window.location.pathname);
      setActiveSection(section);
      window.requestAnimationFrame(() => {
        document
          .getElementById(`customer-portal-${section}`)
          ?.scrollIntoView({ behavior: "auto", block: "start" });
      });
    }
    window.addEventListener("popstate", restoreSection);
    window.requestAnimationFrame(restoreSection);
    return () => window.removeEventListener("popstate", restoreSection);
  }, []);

  const initials =
    data.user.displayName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "CU";
  const availableCredit =
    data.customer.billingMode === "postpaid"
      ? data.customer.balance + data.customer.creditLimit
      : data.customer.balance;
  const normalizedRateSearch = rateSearch.trim().toLowerCase();
  const visibleRates =
    rateCardData?.rates.filter(
      (rate) =>
        !normalizedRateSearch ||
        rate.prefix.includes(normalizedRateSearch) ||
        rate.destinationName.toLowerCase().includes(normalizedRateSearch),
    ) ?? [];

  function openSection(section: CustomerSection) {
    if (
      section !== activeSection ||
      window.location.pathname !== customerSectionRoutes[section]
    ) {
      window.history.pushState(
        { customerSection: section },
        "",
        customerSectionRoutes[section],
      );
    }
    setActiveSection(section);
    window.requestAnimationFrame(() => {
      document.getElementById(`customer-portal-${section}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  return (
    <div className="customer-portal-shell" style={brandingStyle(data.branding)}>
      <aside className="customer-portal-rail">
        <Brand branding={data.branding} />
        <div className="customer-portal-account">
          <span>CUSTOMER PORTAL</span>
          <strong>{data.customer.name}</strong>
          <small>{data.customer.accountNumber}</small>
        </div>
        <nav aria-label="Customer portal">
          <button
            type="button"
            className={activeSection === "overview" ? "active" : ""}
            onClick={() => openSection("overview")}
          >
            <i>01</i>Account overview
          </button>
          <button
            type="button"
            className={activeSection === "services" ? "active" : ""}
            onClick={() => openSection("services")}
          >
            <i>02</i>Services
          </button>
          {data.customer.accountType === "wholesale" && <button
            type="button"
            className={activeSection === "clients" ? "active" : ""}
            onClick={() => openSection("clients")}
          >
            <i>03</i>Clients
          </button>}
          {data.customer.accountType === "wholesale" && <button
            type="button"
            className={activeSection === "branding" ? "active" : ""}
            onClick={() => openSection("branding")}
          >
            <i>04</i>Branding
          </button>}
          <button
            type="button"
            className={activeSection === "numbers" ? "active" : ""}
            onClick={() => openSection("numbers")}
          >
            <i>{data.customer.accountType === "wholesale" ? "05" : "03"}</i>Buy numbers
          </button>
          <button
            type="button"
            className={activeSection === "calls" ? "active" : ""}
            onClick={() => openSection("calls")}
          >
            <i>{data.customer.accountType === "wholesale" ? "06" : "04"}</i>Call activity
          </button>
          <button
            type="button"
            className={activeSection === "recordings" ? "active" : ""}
            onClick={() => openSection("recordings")}
          >
            <i>{data.customer.accountType === "wholesale" ? "07" : "05"}</i>Recordings
          </button>
          <button
            type="button"
            className={activeSection === "rates" ? "active" : ""}
            onClick={() => openSection("rates")}
          >
            <i>{data.customer.accountType === "wholesale" ? "08" : "06"}</i>My rates
          </button>
          <button
            type="button"
            className={activeSection === "ledger" ? "active" : ""}
            onClick={() => openSection("ledger")}
          >
            <i>{data.customer.accountType === "wholesale" ? "09" : "07"}</i>Wallet ledger
          </button>
          <button
            type="button"
            className={activeSection === "invoices" ? "active" : ""}
            onClick={() => openSection("invoices")}
          >
            <i>{data.customer.accountType === "wholesale" ? "10" : "08"}</i>Invoices
          </button>
        </nav>
        <footer>
          <i className="online" />
          Account active<small>{data.branding?.supportEmail || `${data.branding?.brandName ?? "Netbrowse Voice"} · 0.32.3`}</small>
        </footer>
      </aside>
      <main className="customer-portal-main">
        <header className="customer-portal-header">
          <div>
            <span>{(data.branding?.brandName ?? "NETBROWSE VOICE").toUpperCase()} / CUSTOMER PORTAL</span>
            <h1>Welcome, {data.customer.name}.</h1>
            <p>
              Your communications services, usage and wallet in one private
              view.
            </p>
          </div>
          <div className="customer-portal-user">
            <div>{initials}</div>
            <span>
              <strong>{data.user.displayName}</strong>
              <small>{data.user.email}</small>
            </span>
            <button onClick={() => void onLogout()}>Sign out</button>
          </div>
        </header>
        {error && (
          <div className="page-error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {notice && <div className="studio-notice" role="status"><span>{notice}</span></div>}
        <section
          className="customer-portal-stats"
          id="customer-portal-overview"
        >
          <article className="balance">
            <span>CURRENT BALANCE</span>
            <strong>
              {formatMoney(data.customer.balance, data.customer.currency)}
            </strong>
            <small>
              {data.customer.billingMode === "prepaid"
                ? "Prepaid wallet"
                : `${formatMoney(data.customer.creditLimit, data.customer.currency)} credit limit`}
            </small>
          </article>
          <article>
            <span>AVAILABLE TO SPEND</span>
            <strong>
              {formatMoney(availableCredit, data.customer.currency)}
            </strong>
            <small>Outbound credit control active</small>
          </article>
          <article>
            <span>THIS MONTH</span>
            <strong>
              {formatMoney(data.usage.month, data.customer.currency)}
            </strong>
            <small>{data.usage.ratedCalls} rated calls</small>
          </article>
          <article>
            <span>ASSIGNED SERVICES</span>
            <strong>
              {data.extensions.length} ext · {data.dids.length} DID
            </strong>
            <small>Visible only to this account</small>
          </article>
        </section>
        <section className="panel customer-portal-plan">
          <div className="panel-head"><div><span>MY SERVICE PLAN</span><h3>{data.entitlements.servicePlanName ?? "Plan not assigned"}</h3></div><span className={`secure-pill ${data.entitlements.planEnabled ? "" : "disabled"}`}>{data.entitlements.planEnabled ? "ACTIVE" : "UNAVAILABLE"}</span></div>
          <p>{data.entitlements.servicePlanDescription || "Your administrator has not supplied a plan description."}</p>
          <div className="customer-portal-stats"><article><span>EXTENSIONS</span><strong>{data.extensions.length} / {data.entitlements.maxExtensions}</strong><small>{data.entitlements.extensionRangeStart === null ? "No self-service range assigned" : `Range ${data.entitlements.extensionRangeStart}–${data.entitlements.extensionRangeEnd}`}</small></article><article><span>INBOUND NUMBERS</span><strong>{data.dids.length} / {data.entitlements.maxDids}</strong><small>Assigned or purchased numbers</small></article><article><span>RECORDING</span><strong>{data.entitlements.recordingEnabled ? `${data.entitlements.recordingStorageMb} MB` : "Not included"}</strong><small>{data.entitlements.availability.recording.reason || "Available on this plan"}</small></article><article><span>AI / CAMPAIGNS</span><strong>{data.entitlements.maxAiReceptionists} / {data.entitlements.maxCampaigns}</strong><small>{data.entitlements.aiReceptionistEnabled || data.entitlements.campaignsEnabled ? "Plan allowances" : "Not included"}</small></article></div>
        </section>
        {data.customer.accountType === "wholesale" && <ResellerClientsPanel />}
        {data.customer.accountType === "wholesale" && <ResellerBrandingPanel onSaved={(branding) => { setData((current) => ({ ...current, branding })); applyBrowserBrand(branding); }} />}
        <CustomerDidMarketplacePanel onPurchased={refreshPortal} />
        <section className="customer-portal-grid">
          <article
            className="panel customer-portal-services"
            id="customer-portal-services"
          >
            <div className="panel-head">
              <div>
                <span>MY SERVICES</span>
                <h3>Extensions and inbound numbers</h3>
              </div>
              <div className="customer-actions"><button type="button" disabled={!data.entitlements.createExtension.allowed} title={data.entitlements.createExtension.reason} onClick={() => setNewExtension({ displayName: "", maxContacts: 1 })}>Add extension</button><span className="secure-pill">PRIVATE</span></div>
            </div>
            {!data.entitlements.createExtension.allowed && <div className="portal-boundary-note"><strong>Extension creation unavailable</strong><span>{data.entitlements.createExtension.reason}</span></div>}
            <div className="portal-service-columns">
              <section>
                <h4>Extensions</h4>
                {data.extensions.length === 0 ? (
                  <p>No extensions assigned.</p>
                ) : (
                  data.extensions.map((extension) => (
                    <div className="portal-service-row" key={extension.id}>
                      <span
                        className={`portal-service-icon ${extension.registrationState}`}
                      >
                        <i />
                      </span>
                      <div>
                        <strong>
                          {extension.extensionNumber} · {extension.displayName}
                        </strong>
                        <small>
                          {extension.enabled
                            ? extension.registrationState
                            : "disabled"}
                        </small>
                        <div className="customer-actions"><button type="button" onClick={() => setEditingExtension(extension)}>Manage</button><button type="button" disabled={portalBusy === `reset-${extension.id}`} onClick={() => void resetPortalExtension(extension)}>Reset password</button></div>
                      </div>
                    </div>
                  ))
                )}
              </section>
              <section>
                <h4>Inbound DIDs</h4>
                {data.dids.length === 0 ? (
                  <p>No inbound numbers assigned.</p>
                ) : (
                  data.dids.map((did) => (
                    <div className="portal-service-row" key={did.id}>
                      <span
                        className={`portal-service-icon ${did.enabled ? "registered" : "disabled"}`}
                      >
                        <i />
                      </span>
                      <div>
                        <strong>{did.didNumber}</strong>
                        <small>
                          {did.destinationNumber
                            ? `Routes to ${did.destinationNumber}`
                            : "Assigned inbound route"}
                        </small>
                      </div>
                    </div>
                  ))
                )}
              </section>
            </div>
          </article>
          <article className="panel customer-portal-billing">
            <div className="panel-head">
              <div>
                <span>BILLING PROFILE</span>
                <h3>
                  {data.customer.billingMode === "prepaid"
                    ? "Prepaid wallet"
                    : "Postpaid account"}
                </h3>
              </div>
            </div>
            <dl>
              <div>
                <dt>Customer type</dt>
                <dd>
                  {data.customer.accountType === "wholesale"
                    ? "Wholesale / reseller"
                    : "Standard business"}
                </dd>
              </div>
              <div>
                <dt>Account</dt>
                <dd>{data.customer.accountNumber}</dd>
              </div>
              <div>
                <dt>Currency</dt>
                <dd>{data.customer.currency}</dd>
              </div>
              <div>
                <dt>Billing email</dt>
                <dd>{data.customer.billingEmail}</dd>
              </div>
              <div>
                <dt>Usage today</dt>
                <dd>{formatMoney(data.usage.today, data.customer.currency)}</dd>
              </div>
              <div>
                <dt>Usage this month</dt>
                <dd>{formatMoney(data.usage.month, data.customer.currency)}</dd>
              </div>
            </dl>
            <div className="portal-boundary-note">
              <strong>Tenant protected</strong>
              <span>
                This portal cannot access provider costs, global trunks, rate
                decks, API keys or other customers.
              </span>
            </div>
          </article>
        </section>
        <section
          className="panel customer-portal-calls"
          id="customer-portal-calls"
        >
          <div className="panel-head">
            <div>
              <span>CALL ACTIVITY</span>
              <h3>Recent calls on assigned extensions</h3>
            </div>
            <span className="secure-pill">TENANT FILTERED</span>
          </div>
          {data.calls.length === 0 ? (
            <div className="empty-state">
              <p>No calls are available for the assigned extensions.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Direction</th>
                    <th>Status</th>
                    <th>Talk</th>
                  </tr>
                </thead>
                <tbody>
                  {data.calls.map((call) => (
                    <tr key={call.id}>
                      <td>{formatCallTime(call.startedAt)}</td>
                      <td>
                        <strong>{call.source}</strong>
                      </td>
                      <td>
                        <strong>{call.destination}</strong>
                      </td>
                      <td>
                        <span className="portal-direction">
                          {call.direction}
                        </span>
                      </td>
                      <td>
                        <span className={`billing-call-status ${call.status}`}>
                          {call.status}
                        </span>
                      </td>
                      <td>{formatDuration(call.billableSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <CustomerRecordingsPanel />
        <section
          className="panel customer-portal-ledger"
          id="customer-portal-ledger"
        >
          <div className="panel-head">
            <div>
              <span>WALLET LEDGER</span>
              <h3>Transactions</h3>
            </div>
            <span className="secure-pill">IMMUTABLE</span>
          </div>
          <PayPalWalletTopupPanel
            currency={data.customer.currency}
            billingMode={data.customer.billingMode}
            onCredited={refreshPortal}
          />
          {data.transactions.length === 0 ? (
            <div className="empty-state">
              <p>No wallet transactions yet.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Type</th>
                    <th>Note</th>
                    <th>Amount</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>{formatCallTime(transaction.createdAt)}</td>
                      <td>
                        <span className="ledger-type">{transaction.type}</span>
                      </td>
                      <td>{transaction.note}</td>
                      <td
                        className={
                          transaction.amount >= 0 ? "positive" : "negative"
                        }
                      >
                        {transaction.amount >= 0 ? "+" : ""}
                        {formatMoney(transaction.amount, transaction.currency)}
                      </td>
                      <td>
                        {formatMoney(
                          transaction.balanceAfter,
                          transaction.currency,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section
          className="panel customer-portal-invoices"
          id="customer-portal-invoices"
        >
          <div className="panel-head">
            <div>
              <span>INVOICES</span>
              <h3>Usage statements</h3>
            </div>
            <span className="secure-pill">PRIVATE</span>
          </div>
          {data.invoices.length === 0 ? (
            <div className="empty-state">
              <p>No invoices have been issued to this account.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Period</th>
                    <th>Status</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Balance due</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>
                        <strong>{invoice.invoiceNumber}</strong>
                        <small>
                          {invoice.itemCount} rated call
                          {invoice.itemCount === 1 ? "" : "s"}
                        </small>
                      </td>
                      <td>
                        {invoice.periodStart} – {invoice.periodEnd}
                      </td>
                      <td>
                        <span className={`invoice-status ${invoice.status}`}>
                          {invoice.status}
                        </span>
                      </td>
                      <td>{formatMoney(invoice.total, invoice.currency)}</td>
                      <td>
                        {formatMoney(invoice.paidAmount, invoice.currency)}
                      </td>
                      <td>
                        {formatMoney(invoice.balanceDue, invoice.currency)}
                      </td>
                      <td>
                        <div className="invoice-actions">
                          <a
                            className="primary-download"
                            href={`/api/customer/invoices/${invoice.id}/invoice.pdf`}
                          >
                            Download PDF
                          </a>
                          <a
                            href={`/api/customer/invoices/${invoice.id}/statement.csv`}
                          >
                            CSV
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <CustomerRatesPanels
          accountType={data.customer.accountType}
          rateCardData={rateCardData}
          ratedCallsData={ratedCallsData}
          billingError={billingError}
          rateSearch={rateSearch}
          visibleRates={visibleRates}
          onRateSearch={setRateSearch}
          onDismissError={() => setBillingError("")}
        />
      </main>
      {newExtension && (
        <Modal title="Add extension" onClose={() => setNewExtension(null)}>
          <form className="modal-form" onSubmit={createPortalExtension}>
            <div className="notice-card"><strong>Automatic number assignment</strong><p>Netbrowse Voice will use the first free number in your assigned range. {data.entitlements.createExtension.remaining} plan slot{data.entitlements.createExtension.remaining === 1 ? "" : "s"} remain.</p></div>
            <label><span>Display name</span><input required minLength={2} maxLength={80} value={newExtension.displayName} onChange={(event) => setNewExtension({ ...newExtension, displayName: event.target.value })} placeholder="Reception desk" /></label>
            <label><span>Maximum registered devices</span><input required type="number" min="1" max="10" value={newExtension.maxContacts} onChange={(event) => setNewExtension({ ...newExtension, maxContacts: Number(event.target.value) })} /></label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setNewExtension(null)}>Cancel</button><button className="primary-button" disabled={portalBusy === "create-extension"}>{portalBusy === "create-extension" ? "Provisioning…" : "Create extension"}</button></div>
          </form>
        </Modal>
      )}
      {editingExtension && (
        <Modal title={`Manage extension ${editingExtension.extensionNumber}`} onClose={() => { setEditingExtension(null); setVoicemailPin(""); }}>
          <form className="modal-form" onSubmit={savePortalExtension}>
            <label><span>Ring timeout</span><input required type="number" min="5" max="120" value={editingExtension.ringTimeoutSeconds} onChange={(event) => setEditingExtension({ ...editingExtension, ringTimeoutSeconds: Number(event.target.value) })} /><small>Seconds before unavailable forwarding or voicemail.</small></label>
            <label className="toggle-field"><input type="checkbox" checked={editingExtension.voicemailEnabled} onChange={(event) => setEditingExtension({ ...editingExtension, voicemailEnabled: event.target.checked })} /><span><strong>Voicemail</strong><small>{editingExtension.voicemailConfigured ? "Mailbox PIN already configured" : "Enter a PIN below before enabling"}</small></span></label>
            {editingExtension.voicemailEnabled && <label><span>{editingExtension.voicemailConfigured ? "New voicemail PIN (optional)" : "Voicemail PIN"}</span><input required={!editingExtension.voicemailConfigured} type="password" inputMode="numeric" pattern="[0-9]{4,10}" value={voicemailPin} onChange={(event) => setVoicemailPin(event.target.value)} placeholder="4 to 10 digits" /></label>}
            <label className="toggle-field"><input type="checkbox" checked={editingExtension.dndEnabled} onChange={(event) => setEditingExtension({ ...editingExtension, dndEnabled: event.target.checked })} /><span><strong>Do not disturb</strong><small>Send new calls directly to unavailable handling.</small></span></label>
            <label className="toggle-field"><input type="checkbox" checked={editingExtension.callWaiting} onChange={(event) => setEditingExtension({ ...editingExtension, callWaiting: event.target.checked })} /><span><strong>Call waiting</strong><small>Allow another call while this extension is busy.</small></span></label>
            <label className="toggle-field"><input type="checkbox" disabled={!data.entitlements.recordingEnabled} checked={editingExtension.recordCalls} onChange={(event) => setEditingExtension({ ...editingExtension, recordCalls: event.target.checked })} /><span><strong>Automatic call recording</strong><small>{data.entitlements.availability.recording.reason || "Included in your plan"}</small></span></label>
            <label><span>Call forwarding</span><select value={editingExtension.forwardMode} onChange={(event) => setEditingExtension({ ...editingExtension, forwardMode: event.target.value as PortalExtension["forwardMode"], forwardExtensionId: event.target.value === "off" ? null : editingExtension.forwardExtensionId })}><option value="off">Off</option><option value="always">Always</option><option value="busy">When busy</option><option value="unavailable">When unavailable</option></select></label>
            {editingExtension.forwardMode !== "off" && <label><span>Forward to</span><select required value={editingExtension.forwardExtensionId ?? ""} onChange={(event) => setEditingExtension({ ...editingExtension, forwardExtensionId: event.target.value })}><option value="">Choose extension</option>{data.extensions.filter((item) => item.id !== editingExtension.id && item.enabled).map((item) => <option key={item.id} value={item.id}>{item.extensionNumber} · {item.displayName}</option>)}</select></label>}
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setEditingExtension(null); setVoicemailPin(""); }}>Cancel</button><button className="primary-button" disabled={portalBusy === "save-extension"}>{portalBusy === "save-extension" ? "Applying…" : "Save services"}</button></div>
          </form>
        </Modal>
      )}
      {extensionCredentials && <CredentialModal credentials={extensionCredentials} onClose={() => setExtensionCredentials(null)} />}
    </div>
  );
}

function Dashboard({
  data,
  onLogout,
}: {
  data: DashboardData;
  onLogout: () => Promise<void>;
}) {
  const [active, setActive] = useState<PageKey>(() =>
    pageFromPath(window.location.pathname),
  );
  const [extensionCount, setExtensionCount] = useState(data.extensionCount);
  const [trunkCount, setTrunkCount] = useState(data.trunkCount);
  const [didCount, setDidCount] = useState(data.didCount);
  const initials = data.user.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  useEffect(() => {
    function restoreRoute() {
      setActive(pageFromPath(window.location.pathname));
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    window.addEventListener("popstate", restoreRoute);
    return () => window.removeEventListener("popstate", restoreRoute);
  }, []);

  useEffect(() => {
    document.title = `${pageTitles[active]} · Netbrowse Voice`;
  }, [active]);

  function openPage(page: PageKey) {
    if (page !== active || window.location.pathname !== pageRoutes[page]) {
      window.history.pushState({ page }, "", pageRoutes[page]);
      setActive(page);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav>
          <span className="nav-heading">CONTROL CENTRE</span>
          {navigation.map(({ key, label, planned }, index) => (
            <button
              key={key}
              className={active === key ? "active" : ""}
              onClick={() => openPage(key)}
            >
              <i aria-hidden="true">{String(index + 1).padStart(2, "0")}</i>
              {label}
              {planned && <em>NEXT</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="core-status">
            <span /> Core online
          </div>
          <small>Hackathon build · 0.32.3</small>
        </div>
      </aside>

      <main className="dashboard">
        <header className="topbar">
          <div>
            <span className="crumb">
              NETBROWSE VOICE /{" "}
              {navigation
                .find((item) => item.key === active)
                ?.label.toUpperCase()}
            </span>
            <h1>{pageTitles[active]}</h1>
          </div>
          <div className="user-menu">
            <div className="avatar">{initials || "NV"}</div>
            <div>
              <strong>{data.user.displayName}</strong>
              <small>{data.user.role}</small>
            </div>
            <button onClick={() => void onLogout()}>Sign out</button>
          </div>
        </header>

        {active === "overview" && (
          <Overview
            data={{ ...data, extensionCount, trunkCount, didCount }}
            onNavigate={openPage}
          />
        )}
        {active === "pbx" && (
          <PbxCore
            initialCount={extensionCount}
            initialTrunkCount={trunkCount}
            initialDidCount={didCount}
            onCountsChange={(extensions, trunks, dids) => {
              setExtensionCount(extensions);
              setTrunkCount(trunks);
              setDidCount(dids);
            }}
          />
        )}
        {active === "live" && <LiveCalls />}
        {active === "recordings" && <Recordings />}
        {active === "studio" && <SoundStudio />}
        {active === "ivr" && <IvrBuilder />}
        {active === "ai" && <AiReceptionist />}
        {active === "callcentre" && <CallCentre />}
        {active === "campaigns" && <Campaigns />}
        {active === "customers" && <Customers />}
        {active === "didstore" && <DidMarketplaceAdmin />}
        {active === "billing" && <Billing isOwner={data.user.role === "owner"} />}
        {active === "modules" && (
          <section className="panel modules-page">
            <div className="panel-head">
              <div>
                <span>MODULAR PLATFORM</span>
                <h3>Installed and planned modules</h3>
              </div>
            </div>
            <ModuleGrid modules={data.modules} />
          </section>
        )}
        {active !== "overview" &&
          active !== "pbx" &&
          active !== "live" &&
          active !== "recordings" &&
          active !== "studio" &&
          active !== "ivr" &&
          active !== "ai" &&
          active !== "callcentre" &&
          active !== "campaigns" &&
          active !== "customers" &&
          active !== "didstore" &&
          active !== "billing" &&
          active !== "modules" && <PlannedPage active={active} />}
      </main>
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [agentWorkspace, setAgentWorkspace] =
    useState<AgentWorkspaceData | null>(null);
  const [customerPortal, setCustomerPortal] =
    useState<CustomerPortalData | null>(null);
  const [loginBrand, setLoginBrand] = useState<PortalBranding | null>(null);
  const [fatalError, setFatalError] = useState("");

  const loadAuthenticated = useMemo(
    () => async () => {
      const { user } = await api<{ user: User }>("/api/me");
      if (user.role === "agent") {
        applyBrowserBrand(null);
        if (window.location.pathname !== "/agent")
          window.history.replaceState({}, "", "/agent");
        const data = await api<AgentWorkspaceData>("/api/agent/workspace");
        setAgentWorkspace(data);
        setDashboard(null);
        setCustomerPortal(null);
        setScreen("agent");
      } else if (user.role === "customer_admin") {
        if (
          !Object.values(customerSectionRoutes).includes(
            window.location.pathname,
          )
        ) {
          window.history.replaceState({}, "", customerSectionRoutes.overview);
        }
        const data = await api<CustomerPortalData>("/api/customer/portal");
        setCustomerPortal(data);
        setLoginBrand(data.branding);
        applyBrowserBrand(data.branding);
        setDashboard(null);
        setAgentWorkspace(null);
        setScreen("customer");
      } else {
        applyBrowserBrand(null);
        if (!Object.values(pageRoutes).includes(window.location.pathname)) {
          window.history.replaceState({}, "", pageRoutes.overview);
        }
        const data = await api<DashboardData>("/api/dashboard");
        setDashboard(data);
        setAgentWorkspace(null);
        setCustomerPortal(null);
        setScreen("dashboard");
      }
    },
    [],
  );

  useEffect(() => {
    async function boot() {
      try {
        const setup = await api<{ setupRequired: boolean }>(
          "/api/setup/status",
        );
        if (setup.setupRequired) {
          setScreen("setup");
          return;
        }
        const brandMatch = /^\/login\/([a-z0-9][a-z0-9-]{1,61}[a-z0-9])\/?$/.exec(
          window.location.pathname,
        );
        if (brandMatch?.[1]) {
          try {
            const branding = await api<PortalBranding>(
              `/api/public/branding/${encodeURIComponent(brandMatch[1])}`,
            );
            setLoginBrand(branding);
            applyBrowserBrand(branding);
          } catch {
            setLoginBrand(null);
            applyBrowserBrand(null);
            window.history.replaceState({}, "", "/");
          }
        }
        try {
          await loadAuthenticated();
        } catch {
          setScreen("login");
        }
      } catch (error) {
        setFatalError(
          error instanceof Error ? error.message : "Unable to reach Voice Core",
        );
      }
    }
    void boot();
  }, [loadAuthenticated]);

  async function logout() {
    const loginPath = customerPortal?.branding?.loginPath ?? "/";
    const branding = customerPortal?.branding ?? null;
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    window.history.replaceState({}, "", loginPath);
    setDashboard(null);
    setAgentWorkspace(null);
    setCustomerPortal(null);
    setLoginBrand(branding);
    applyBrowserBrand(branding);
    setScreen("login");
  }

  if (fatalError) {
    return (
      <main className="loading-page">
        <Brand />
        <h1>Voice Core is unavailable</h1>
        <p>{fatalError}</p>
        <button onClick={() => location.reload()}>Try again</button>
      </main>
    );
  }
  if (screen === "loading") {
    return (
      <main className="loading-page">
        <Brand />
        <div className="loader" />
        <p>Starting communications control centre…</p>
      </main>
    );
  }
  if (screen === "setup")
    return <AuthShell mode="setup" onSuccess={loadAuthenticated} />;
  if (screen === "login")
    return <AuthShell mode="login" onSuccess={loadAuthenticated} branding={loginBrand} brandSlug={loginBrand?.slug} />;
  if (screen === "agent")
    return agentWorkspace ? (
      <AgentWorkspace initialData={agentWorkspace} onLogout={logout} />
    ) : null;
  if (screen === "customer")
    return customerPortal ? (
      <CustomerPortal initialData={customerPortal} onLogout={logout} />
    ) : null;
  return dashboard ? <Dashboard data={dashboard} onLogout={logout} /> : null;
}

createRoot(document.getElementById("root")!).render(<App />);
