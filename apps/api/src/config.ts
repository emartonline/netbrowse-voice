function integer(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV ?? "development";

export const config = {
  version: "0.30.1",
  nodeEnv,
  host: process.env.HOST ?? "127.0.0.1",
  port: integer(process.env.PORT, 3100),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://nbvoice:nbvoice@127.0.0.1:5432/netbrowse_voice",
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  secureCookie: process.env.COOKIE_SECURE === "true",
  sessionHours: Math.max(1, integer(process.env.SESSION_HOURS, 12)),
  dataKey:
    process.env.NBVOICE_DATA_KEY ??
    (nodeEnv === "production"
      ? ""
      : "7d8d0f0a7691e99585bf0d60ed65088c60a7f0630c8d46ce1b28e98bd5fa256e"),
  asteriskStagingDir:
    process.env.NBVOICE_ASTERISK_STAGING_DIR ??
    "/var/lib/netbrowse-voice/asterisk-staging",
  asteriskApplyCommand:
    process.env.NBVOICE_ASTERISK_APPLY_COMMAND ??
    "/usr/bin/sudo",
  asteriskApplyHelper:
    process.env.NBVOICE_ASTERISK_APPLY_HELPER ??
    "/usr/local/libexec/nbvoice-asterisk-apply",
  asteriskStatusCommand:
    process.env.NBVOICE_ASTERISK_STATUS_COMMAND ?? "/usr/bin/sudo",
  asteriskStatusHelper:
    process.env.NBVOICE_ASTERISK_STATUS_HELPER ??
    "/usr/local/libexec/nbvoice-asterisk-status",
  asteriskQueuesCommand:
    process.env.NBVOICE_ASTERISK_QUEUES_COMMAND ?? "/usr/bin/sudo",
  asteriskQueuesHelper:
    process.env.NBVOICE_ASTERISK_QUEUES_HELPER ??
    "/usr/local/libexec/nbvoice-asterisk-queues",
  asteriskCallsCommand:
    process.env.NBVOICE_ASTERISK_CALLS_COMMAND ?? "/usr/bin/sudo",
  asteriskCallsHelper:
    process.env.NBVOICE_ASTERISK_CALLS_HELPER ??
    "/usr/local/libexec/nbvoice-asterisk-calls",
  recordingDir:
    process.env.NBVOICE_RECORDING_DIR ??
    "/var/lib/netbrowse-voice/recordings",
  soundDir:
    process.env.NBVOICE_SOUND_DIR ??
    "/var/lib/asterisk/sounds/netbrowse",
  aiRuntimeDir:
    process.env.NBVOICE_AI_RUNTIME_DIR ??
    "/var/lib/netbrowse-voice/ai-runtime",
  fastAgiHost: process.env.NBVOICE_FASTAGI_HOST ?? "127.0.0.1",
  fastAgiPort: integer(process.env.NBVOICE_FASTAGI_PORT, 4573),
  audioSocketHost: process.env.NBVOICE_AUDIOSOCKET_HOST ?? "127.0.0.1",
  audioSocketPort: integer(process.env.NBVOICE_AUDIOSOCKET_PORT, 4574),
  asteriskRedirectCommand:
    process.env.NBVOICE_ASTERISK_REDIRECT_COMMAND ?? "/usr/bin/sudo",
  asteriskRedirectHelper:
    process.env.NBVOICE_ASTERISK_REDIRECT_HELPER ??
    "/usr/local/libexec/nbvoice-asterisk-redirect",
  asteriskRedirectRequestDir:
    process.env.NBVOICE_ASTERISK_REDIRECT_REQUEST_DIR ??
    "/var/lib/netbrowse-voice/redirect-requests",
  campaignOutboxDir:
    process.env.NBVOICE_CAMPAIGN_OUTBOX_DIR ??
    "/var/lib/netbrowse-voice/campaign-outbox",
  asteriskCampaignSubmitCommand:
    process.env.NBVOICE_ASTERISK_CAMPAIGN_SUBMIT_COMMAND ?? "/usr/bin/sudo",
  asteriskCampaignSubmitHelper:
    process.env.NBVOICE_ASTERISK_CAMPAIGN_SUBMIT_HELPER ??
    "/usr/local/libexec/nbvoice-asterisk-campaign-submit",
  ffmpegCommand: process.env.NBVOICE_FFMPEG_COMMAND ?? "/usr/bin/ffmpeg",
};
