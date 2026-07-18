import type { FastifyInstance } from "fastify";
import { requireAdministrator } from "./auth.js";
import { audit, pool } from "./database.js";
import { applyPbxConfiguration, serializedPbxMutation } from "./pbx.js";
import {
  deleteElevenLabsAgent,
  provisionElevenLabsAgent,
  updateElevenLabsAgent,
  type AiProvider,
} from "./ai-receptionist.js";
import {
  OPENAI_REALTIME_MODEL,
  openAiRealtimeVoices,
} from "./openai-realtime.js";
import {
  configuredProviderApiKey,
  createSoundFile,
  deleteSoundFile,
  googleVoices,
  listElevenLabsVoices,
  serializedSoundGeneration,
  soundFileStat,
  SoundStudioError,
  validElevenLabsVoiceId,
} from "./sound-studio.js";

interface AgentRow {
  id: string;
  name: string;
  extension_number: string;
  greeting_sound_asset_id: string;
  provider: AiProvider;
  model: "gpt-realtime-2.1" | "gemini-3.5-flash" | "eleven_agents";
  external_agent_id: string | null;
  disclosure_asterisk_name: string | null;
  voice: string;
  system_prompt: string;
  knowledge_base: string;
  handoff_extension_id: string | null;
  handoff_destination_type: "extension" | "call_group";
  handoff_call_group_id: string | null;
  max_turns: number;
  listen_timeout_seconds: number;
  store_transcripts: boolean;
  enabled: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface AgentBody {
  name?: string;
  internalNumber?: string;
  greetingSoundId?: string;
  provider?: string;
  voice?: string;
  systemPrompt?: string;
  knowledgeBase?: string;
  handoffExtensionId?: string | null;
  handoffDestinationType?: "extension" | "call_group";
  handoffCallGroupId?: string | null;
  maxTurns?: number;
  listenTimeoutSeconds?: number;
  storeTranscripts?: boolean;
  enabled?: boolean;
}

interface AgentParams { id: string }

interface ValidatedAgent {
  name: string;
  internalNumber: string;
  greetingSoundId: string;
  provider: AiProvider;
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
}

const agentColumns = `id, name, extension_number, greeting_sound_asset_id,
  provider, model, external_agent_id, disclosure_asterisk_name,
  voice, system_prompt, knowledge_base, handoff_extension_id,
  handoff_destination_type, handoff_call_group_id,
  max_turns, listen_timeout_seconds, store_transcripts, enabled, created_by,
  created_at, updated_at`;

export const naturalAiDisclosureText =
  "You are speaking with an AI receptionist. Your voice will be processed by AI to answer this call. You may ask to speak with a person at any time.";

export function naturalAiDisclosureRequest(provider: AiProvider, voice: string) {
  return {
    provider,
    text: naturalAiDisclosureText,
    voice,
    instructions: "Speak naturally, clearly and warmly in a calm professional telephone voice. Read the wording exactly and do not add anything.",
    speed: 1,
  };
}

function disclosureFilename(asteriskName: string | null): string | undefined {
  const match = asteriskName?.match(/^netbrowse\/(nbvs-ai-disclosure-[0-9a-f]{8})$/);
  return match ? `${match[1]}.wav` : undefined;
}

async function generateNaturalDisclosure(
  provider: AiProvider,
  voice: string,
  apiKey: string,
) {
  return serializedSoundGeneration(() => createSoundFile(
    "AI disclosure",
    naturalAiDisclosureRequest(provider, voice),
    apiKey,
  ));
}

async function deleteNaturalDisclosure(asteriskName: string | null): Promise<void> {
  const filename = disclosureFilename(asteriskName);
  if (filename) await deleteSoundFile(filename);
}

function providerDisplayName(provider: AiProvider): string {
  if (provider === "openai") return "OpenAI Realtime";
  if (provider === "google") return "Google Gemini";
  return "ElevenLabs";
}

function providerModel(provider: AiProvider): AgentRow["model"] {
  if (provider === "openai") return OPENAI_REALTIME_MODEL;
  if (provider === "google") return "gemini-3.5-flash";
  return "eleven_agents";
}

function elevenLabsDefinition(value: ValidatedAgent) {
  return {
    name: value.name,
    system_prompt: value.systemPrompt,
    knowledge_base: value.knowledgeBase,
    handoff_extension_number: value.handoffExtensionId || value.handoffCallGroupId ? "configured" : null,
  };
}

function existingElevenLabsDefinition(row: AgentRow) {
  return {
    name: row.name,
    system_prompt: row.system_prompt,
    knowledge_base: row.knowledge_base,
    handoff_extension_number: row.handoff_extension_id || row.handoff_call_group_id ? "configured" : null,
  };
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function publicAgent(row: AgentRow) {
  return {
    id: row.id,
    name: row.name,
    internalNumber: row.extension_number,
    greetingSoundId: row.greeting_sound_asset_id,
    provider: row.provider,
    model: row.model,
    naturalDisclosure: Boolean(row.disclosure_asterisk_name),
    voice: row.voice,
    systemPrompt: row.system_prompt,
    knowledgeBase: row.knowledge_base,
    handoffExtensionId: row.handoff_extension_id,
    handoffDestinationType: row.handoff_destination_type,
    handoffCallGroupId: row.handoff_call_group_id,
    maxTurns: row.max_turns,
    listenTimeoutSeconds: row.listen_timeout_seconds,
    storeTranscripts: row.store_transcripts,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function agentById(id: string): Promise<AgentRow | undefined> {
  if (!validUuid(id)) return undefined;
  const result = await pool.query<AgentRow>(
    `SELECT ${agentColumns} FROM ai_receptionists WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

async function validateAgent(
  body: AgentBody | undefined,
  existing?: AgentRow,
): Promise<{ value?: ValidatedAgent; error?: string }> {
  const name = body?.name?.trim().replace(/\s+/g, " ") ?? existing?.name ?? "";
  const internalNumber = body?.internalNumber?.trim() ?? existing?.extension_number ?? "";
  const greetingSoundId = body?.greetingSoundId ?? existing?.greeting_sound_asset_id ?? "";
  const providerValue = body?.provider ?? existing?.provider ?? "openai";
  if (providerValue !== "openai" && providerValue !== "google" && providerValue !== "elevenlabs") {
    return { error: "Choose OpenAI Realtime, Google Gemini or ElevenLabs Agents" };
  }
  const provider: AiProvider = providerValue;
  const voice = body?.voice ?? existing?.voice ?? (
    provider === "openai" ? "marin" : provider === "google" ? "Kore" : ""
  );
  const systemPrompt = body?.systemPrompt?.trim() ?? existing?.system_prompt ?? "";
  const knowledgeBase = body?.knowledgeBase?.trim() ?? existing?.knowledge_base ?? "";
  const handoffExtensionId = body?.handoffExtensionId === undefined
    ? (body?.handoffDestinationType === "call_group" ? null : existing?.handoff_extension_id ?? null)
    : (body.handoffExtensionId || null);
  const handoffDestinationType = body?.handoffDestinationType ??
    existing?.handoff_destination_type ?? "extension";
  const handoffCallGroupId = body?.handoffCallGroupId === undefined
    ? (handoffDestinationType === "call_group" ? existing?.handoff_call_group_id ?? null : null)
    : (body.handoffCallGroupId || null);
  const maxTurns = Number(body?.maxTurns ?? existing?.max_turns ?? 4);
  const listenTimeoutSeconds = Number(
    body?.listenTimeoutSeconds ?? existing?.listen_timeout_seconds ?? 12,
  );
  const storeTranscripts = body?.storeTranscripts ?? existing?.store_transcripts ?? false;
  const enabled = body?.enabled ?? existing?.enabled ?? true;

  if (name.length < 2 || name.length > 80 || /[\u0000-\u001f<>]/.test(name)) {
    return { error: "Agent name must contain between 2 and 80 characters" };
  }
  if (!/^[0-9]{2,8}$/.test(internalNumber)) {
    return { error: "Internal AI number must contain 2 to 8 digits" };
  }
  if (!validUuid(greetingSoundId)) return { error: "Choose a Sound Studio greeting" };
  if (provider === "google" && !googleVoices.some((item) => item.id === voice)) {
    return { error: "Choose a valid Google voice" };
  }
  if (provider === "openai" && !openAiRealtimeVoices.some((item) => item.id === voice)) {
    return { error: "Choose a valid OpenAI Realtime voice" };
  }
  if (provider === "elevenlabs" && !validElevenLabsVoiceId(voice)) {
    return { error: "Choose a valid ElevenLabs voice" };
  }
  if (systemPrompt.length < 20 || systemPrompt.length > 4000) {
    return { error: "Business behavior must contain between 20 and 4,000 characters" };
  }
  if (knowledgeBase.length > 12000) {
    return { error: "Business knowledge cannot exceed 12,000 characters" };
  }
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 6) {
    return { error: "Maximum turns must be between 1 and 6" };
  }
  if (!Number.isInteger(listenTimeoutSeconds) || listenTimeoutSeconds < 3 || listenTimeoutSeconds > 30) {
    return { error: "Listen timeout must be between 3 and 30 seconds" };
  }
  if (typeof storeTranscripts !== "boolean" || typeof enabled !== "boolean") {
    return { error: "Invalid agent privacy or state setting" };
  }
  if (handoffExtensionId !== null && !validUuid(handoffExtensionId)) {
    return { error: "Choose a valid human handoff extension" };
  }
  if (handoffDestinationType !== "extension" && handoffDestinationType !== "call_group") {
    return { error: "Choose an extension or call group for human handoff" };
  }
  if (handoffCallGroupId !== null && !validUuid(handoffCallGroupId)) {
    return { error: "Choose a valid human handoff call group" };
  }
  if (handoffDestinationType === "extension" && handoffCallGroupId) {
    return { error: "An extension handoff cannot also use a call group" };
  }
  if (handoffDestinationType === "call_group" && handoffExtensionId) {
    return { error: "A call-group handoff cannot also use an extension" };
  }

  const ignoreId = existing?.id ?? "00000000-0000-0000-0000-000000000000";
  const [extensionCollision, ivrCollision, groupCollision, agentCollision, soundResult, handoffResult] = await Promise.all([
    pool.query("SELECT 1 FROM extensions WHERE extension_number = $1 LIMIT 1", [internalNumber]),
    pool.query("SELECT 1 FROM ivr_menus WHERE extension_number = $1 LIMIT 1", [internalNumber]),
    pool.query("SELECT 1 FROM call_groups WHERE extension_number = $1 LIMIT 1", [internalNumber]),
    pool.query(
      "SELECT 1 FROM ai_receptionists WHERE extension_number = $1 AND id <> $2::uuid LIMIT 1",
      [internalNumber, ignoreId],
    ),
    pool.query<{ filename: string }>("SELECT filename FROM sound_assets WHERE id = $1", [greetingSoundId]),
    handoffDestinationType === "call_group" && handoffCallGroupId
      ? pool.query("SELECT 1 FROM call_groups WHERE id = $1 AND enabled = true LIMIT 1", [handoffCallGroupId])
      : handoffDestinationType === "extension" && handoffExtensionId
        ? pool.query("SELECT 1 FROM extensions WHERE id = $1 AND enabled = true LIMIT 1", [handoffExtensionId])
        : Promise.resolve({ rowCount: 1 }),
  ]);
  if (extensionCollision.rowCount) return { error: "That number is already used by an extension" };
  if (ivrCollision.rowCount) return { error: "That number is already used by an IVR" };
  if (groupCollision.rowCount) return { error: "That number is already used by a call group" };
  if (agentCollision.rowCount) return { error: "That number is already used by another AI agent" };
  const sound = soundResult.rows[0];
  if (!sound || !(await soundFileStat(sound.filename))) {
    return { error: "The selected greeting audio is unavailable" };
  }
  if (!handoffResult.rowCount) return { error: "The human handoff must be an active destination" };
  return {
    value: {
      name, internalNumber, greetingSoundId, provider, voice, systemPrompt, knowledgeBase,
      handoffExtensionId: handoffDestinationType === "extension" ? handoffExtensionId : null,
      handoffDestinationType,
      handoffCallGroupId: handoffDestinationType === "call_group" ? handoffCallGroupId : null,
      maxTurns, listenTimeoutSeconds, storeTranscripts, enabled,
    },
  };
}

async function restoreAgent(row: AgentRow): Promise<void> {
  await pool.query(
    `INSERT INTO ai_receptionists (${agentColumns})
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, extension_number=EXCLUDED.extension_number,
       greeting_sound_asset_id=EXCLUDED.greeting_sound_asset_id,
       provider=EXCLUDED.provider, model=EXCLUDED.model,
       external_agent_id=EXCLUDED.external_agent_id,
       disclosure_asterisk_name=EXCLUDED.disclosure_asterisk_name,
       voice=EXCLUDED.voice,
       system_prompt=EXCLUDED.system_prompt, knowledge_base=EXCLUDED.knowledge_base,
       handoff_extension_id=EXCLUDED.handoff_extension_id,
       handoff_destination_type=EXCLUDED.handoff_destination_type,
       handoff_call_group_id=EXCLUDED.handoff_call_group_id,
       max_turns=EXCLUDED.max_turns,
       listen_timeout_seconds=EXCLUDED.listen_timeout_seconds,
       store_transcripts=EXCLUDED.store_transcripts, enabled=EXCLUDED.enabled,
       created_by=EXCLUDED.created_by, created_at=EXCLUDED.created_at,
       updated_at=EXCLUDED.updated_at`,
    [
      row.id, row.name, row.extension_number, row.greeting_sound_asset_id,
      row.provider, row.model, row.external_agent_id, row.disclosure_asterisk_name, row.voice,
      row.system_prompt, row.knowledge_base,
      row.handoff_extension_id, row.handoff_destination_type, row.handoff_call_group_id,
      row.max_turns, row.listen_timeout_seconds,
      row.store_transcripts, row.enabled, row.created_by, row.created_at, row.updated_at,
    ],
  );
}

export function registerAiReceptionistRoutes(app: FastifyInstance): void {
  app.get("/api/ai-receptionists", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const [agents, sounds, extensions, callGroups, sessions, openAiApiKey, googleApiKey, elevenLabsApiKey] = await Promise.all([
      pool.query<AgentRow>(`SELECT ${agentColumns} FROM ai_receptionists ORDER BY created_at DESC`),
      pool.query<{ id: string; name: string; filename: string; provider: string; voice: string }>(
        "SELECT id, name, filename, provider, voice FROM sound_assets ORDER BY created_at DESC",
      ),
      pool.query<{ id: string; extension_number: string; display_name: string }>(
        `SELECT id, extension_number, display_name FROM extensions
          WHERE enabled = true ORDER BY length(extension_number), extension_number`,
      ),
      pool.query<{ id: string; extension_number: string; name: string; group_type: string }>(
        `SELECT id, extension_number, name, group_type FROM call_groups
          WHERE enabled = true ORDER BY length(extension_number), extension_number`,
      ),
      pool.query<{
        id: string; agent_id: string; agent_name: string; caller_number: string | null;
        status: string; turn_count: number; transcript: unknown; error_code: string | null;
        started_at: Date; ended_at: Date | null;
      }>(
        `SELECT sessions.id, sessions.agent_id, agents.name AS agent_name,
                sessions.caller_number, sessions.status, sessions.turn_count,
                sessions.transcript, sessions.error_code,
                sessions.started_at, sessions.ended_at
           FROM ai_call_sessions AS sessions
           JOIN ai_receptionists AS agents ON agents.id = sessions.agent_id
          ORDER BY sessions.started_at DESC LIMIT 50`,
      ),
      configuredProviderApiKey("openai"),
      configuredProviderApiKey("google"),
      configuredProviderApiKey("elevenlabs"),
    ]);
    let elevenLabsVoices: Awaited<ReturnType<typeof listElevenLabsVoices>> = [];
    let elevenLabsVoiceLoadError = "";
    if (elevenLabsApiKey) {
      try {
        elevenLabsVoices = await listElevenLabsVoices(elevenLabsApiKey);
      } catch (error) {
        elevenLabsVoiceLoadError = error instanceof Error
          ? error.message
          : "ElevenLabs voices could not be loaded";
      }
    }
    const availableSounds = [];
    for (const sound of sounds.rows) {
      if (await soundFileStat(sound.filename)) availableSounds.push(sound);
    }
    return {
      agents: agents.rows.map(publicAgent),
      sounds: availableSounds,
      extensions: extensions.rows.map((row) => ({
        id: row.id, extensionNumber: row.extension_number, displayName: row.display_name,
      })),
      callGroups: callGroups.rows.map((row) => ({
        id: row.id, internalNumber: row.extension_number, name: row.name, groupType: row.group_type,
      })),
      providers: [
        {
          key: "openai", name: "OpenAI Realtime", configured: Boolean(openAiApiKey),
          voices: openAiRealtimeVoices,
        },
        {
          key: "elevenlabs", name: "ElevenLabs Agents", configured: Boolean(elevenLabsApiKey),
          voices: elevenLabsVoices, voiceLoadError: elevenLabsVoiceLoadError,
        },
        { key: "google", name: "Google Gemini", configured: Boolean(googleApiKey), voices: googleVoices },
      ],
      openAiConfigured: Boolean(openAiApiKey),
      googleConfigured: Boolean(googleApiKey),
      elevenLabsConfigured: Boolean(elevenLabsApiKey),
      sessions: sessions.rows.map((row) => ({
        id: row.id, agentId: row.agent_id, agentName: row.agent_name,
        callerNumber: row.caller_number, status: row.status, turnCount: row.turn_count,
        transcript: row.transcript, errorCode: row.error_code,
        startedAt: row.started_at, endedAt: row.ended_at,
      })),
    };
  });

  app.post<{ Body: AgentBody }>("/api/ai-receptionists", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const validated = await validateAgent(request.body);
    if (!validated.value) return reply.code(400).send({ error: validated.error });
    const value = validated.value;
    const apiKey = await configuredProviderApiKey(value.provider);
    if (!apiKey) {
      return reply.code(400).send({
        error: `Configure and test ${providerDisplayName(value.provider)} in Sound Studio first`,
      });
    }
    let externalAgentId: string | null = null;
    let keepExternalAgent = false;
    let generatedDisclosureName: string | null = null;
    let keepDisclosure = false;
    try {
      if (value.provider === "elevenlabs") {
        externalAgentId = await provisionElevenLabsAgent(
          apiKey, elevenLabsDefinition(value), value.voice,
        );
      }
      generatedDisclosureName = (
        await generateNaturalDisclosure(value.provider, value.voice, apiKey)
      ).asteriskName;
      const row = await serializedPbxMutation(async () => {
        const inserted = await pool.query<AgentRow>(
          `INSERT INTO ai_receptionists
             (name, extension_number, greeting_sound_asset_id, provider, model,
              external_agent_id, disclosure_asterisk_name, voice, system_prompt,
              knowledge_base, handoff_extension_id, handoff_destination_type,
              handoff_call_group_id, max_turns, listen_timeout_seconds,
              store_transcripts, enabled, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           RETURNING ${agentColumns}`,
          [
            value.name, value.internalNumber, value.greetingSoundId, value.provider,
            providerModel(value.provider),
            externalAgentId, generatedDisclosureName, value.voice,
            value.systemPrompt, value.knowledgeBase,
            value.handoffExtensionId, value.handoffDestinationType,
            value.handoffCallGroupId, value.maxTurns, value.listenTimeoutSeconds,
            value.storeTranscripts, value.enabled, user.id,
          ],
        );
        const created = inserted.rows[0];
        if (!created) throw new Error("Agent insert returned no record");
        try {
          await applyPbxConfiguration();
        } catch (error) {
          await pool.query("DELETE FROM ai_receptionists WHERE id = $1", [created.id]);
          await applyPbxConfiguration().catch(() => undefined);
          throw error;
        }
        return created;
      });
      keepExternalAgent = true;
      keepDisclosure = true;
      await audit("ai_receptionist.created", user.id, { agentId: row.id }, request.ip);
      return reply.code(201).send({ agent: publicAgent(row) });
    } catch (error) {
      if (externalAgentId && !keepExternalAgent) {
        await deleteElevenLabsAgent(apiKey, externalAgentId).catch(() => undefined);
      }
      if (generatedDisclosureName && !keepDisclosure) {
        await deleteNaturalDisclosure(generatedDisclosureName).catch(() => undefined);
      }
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "That internal number is already in use" });
      }
      request.log.error({ error }, "AI receptionist creation failed");
      if (error instanceof SoundStudioError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      if (error instanceof Error && error.message.startsWith("ElevenLabs")) {
        return reply.code(502).send({ error: error.message });
      }
      return reply.code(500).send({ error: "The AI receptionist could not be created" });
    }
  });

  app.patch<{ Params: AgentParams; Body: AgentBody }>(
    "/api/ai-receptionists/:id",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const existing = await agentById(request.params.id);
      if (!existing) return reply.code(404).send({ error: "AI receptionist not found" });
      const validated = await validateAgent(request.body, existing);
      if (!validated.value) return reply.code(400).send({ error: validated.error });
      const value = validated.value;
      const providerApiKey = await configuredProviderApiKey(value.provider);
      const disclosureNeedsRefresh = !existing.disclosure_asterisk_name ||
        value.provider !== existing.provider || value.voice !== existing.voice;
      if ((value.enabled || value.provider !== existing.provider || disclosureNeedsRefresh) && !providerApiKey) {
        return reply.code(400).send({
          error: `Configure and test ${providerDisplayName(value.provider)} in Sound Studio first`,
        });
      }
      let externalAgentId = value.provider === "elevenlabs" ? existing.external_agent_id : null;
      let provisionedAgentId: string | null = null;
      let remoteAgentUpdated = false;
      let localCommitted = false;
      let generatedDisclosureName: string | null = null;
      try {
        if (value.provider === "elevenlabs" && !externalAgentId) {
          if (!providerApiKey) {
            return reply.code(400).send({ error: "Configure and test ElevenLabs in Sound Studio first" });
          }
          provisionedAgentId = await provisionElevenLabsAgent(
            providerApiKey, elevenLabsDefinition(value), value.voice,
          );
          externalAgentId = provisionedAgentId;
        } else if (value.provider === "elevenlabs" && externalAgentId && providerApiKey) {
          await updateElevenLabsAgent(
            providerApiKey, externalAgentId, elevenLabsDefinition(value), value.voice,
          );
          remoteAgentUpdated = true;
        }
        if (disclosureNeedsRefresh && providerApiKey) {
          generatedDisclosureName = (
            await generateNaturalDisclosure(value.provider, value.voice, providerApiKey)
          ).asteriskName;
        }
        const disclosureName = generatedDisclosureName ?? existing.disclosure_asterisk_name;
        const row = await serializedPbxMutation(async () => {
          const updated = await pool.query<AgentRow>(
            `UPDATE ai_receptionists SET
               name=$2, extension_number=$3, greeting_sound_asset_id=$4,
               provider=$5, model=$6, external_agent_id=$7,
               disclosure_asterisk_name=$8, voice=$9,
               system_prompt=$10, knowledge_base=$11, handoff_extension_id=$12,
               handoff_destination_type=$13, handoff_call_group_id=$14,
               max_turns=$15, listen_timeout_seconds=$16, store_transcripts=$17,
               enabled=$18, updated_at=now()
             WHERE id=$1 RETURNING ${agentColumns}`,
            [
              existing.id, value.name, value.internalNumber, value.greetingSoundId,
              value.provider, providerModel(value.provider),
              externalAgentId, disclosureName, value.voice,
              value.systemPrompt, value.knowledgeBase,
              value.handoffExtensionId, value.handoffDestinationType,
              value.handoffCallGroupId, value.maxTurns, value.listenTimeoutSeconds,
              value.storeTranscripts, value.enabled,
            ],
          );
          const changed = updated.rows[0];
          if (!changed) throw new Error("Agent update returned no record");
          try {
            await applyPbxConfiguration();
          } catch (error) {
            await restoreAgent(existing);
            await applyPbxConfiguration().catch(() => undefined);
            throw error;
          }
          return changed;
        });
        localCommitted = true;
        provisionedAgentId = null;
        if (generatedDisclosureName && existing.disclosure_asterisk_name &&
            existing.disclosure_asterisk_name !== generatedDisclosureName) {
          await deleteNaturalDisclosure(existing.disclosure_asterisk_name).catch((error) => {
            request.log.warn({ error }, "Old natural disclosure cleanup failed");
          });
        }
        if (existing.provider === "elevenlabs" && existing.external_agent_id &&
            existing.external_agent_id !== row.external_agent_id) {
          const oldKey = await configuredProviderApiKey("elevenlabs");
          if (oldKey) {
            await deleteElevenLabsAgent(oldKey, existing.external_agent_id).catch((error) => {
              request.log.warn({ error }, "Old ElevenLabs agent cleanup failed");
            });
          }
        }
        await audit("ai_receptionist.updated", user.id, { agentId: row.id }, request.ip);
        return { agent: publicAgent(row) };
      } catch (error) {
        if (!localCommitted && generatedDisclosureName) {
          await deleteNaturalDisclosure(generatedDisclosureName).catch(() => undefined);
        }
        if (!localCommitted && provisionedAgentId && providerApiKey) {
          await deleteElevenLabsAgent(providerApiKey, provisionedAgentId).catch(() => undefined);
        }
        if (!localCommitted && remoteAgentUpdated && existing.external_agent_id && providerApiKey) {
          await updateElevenLabsAgent(
            providerApiKey, existing.external_agent_id,
            existingElevenLabsDefinition(existing), existing.voice,
          ).catch(() => undefined);
        }
        request.log.error({ error }, "AI receptionist update failed");
        if (error instanceof SoundStudioError) {
          return reply.code(error.statusCode).send({ error: error.message });
        }
        if (error instanceof Error && error.message.startsWith("ElevenLabs")) {
          return reply.code(502).send({ error: error.message });
        }
        return reply.code(500).send({ error: "The AI receptionist could not be updated" });
      }
    },
  );

  app.delete<{ Params: AgentParams }>("/api/ai-receptionists/:id", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const existing = await agentById(request.params.id);
    if (!existing) return reply.code(404).send({ error: "AI receptionist not found" });
    const sessionCount = await pool.query<{ count: string }>(
      "SELECT count(*) FROM ai_call_sessions WHERE agent_id = $1",
      [existing.id],
    );
    if (Number(sessionCount.rows[0]?.count ?? 0) > 0) {
      return reply.code(409).send({
        error: "This agent has call history. Disable it to preserve the audit trail.",
      });
    }
    try {
      await serializedPbxMutation(async () => {
        await pool.query("DELETE FROM ai_receptionists WHERE id = $1", [existing.id]);
        try {
          await applyPbxConfiguration();
        } catch (error) {
          await restoreAgent(existing);
          await applyPbxConfiguration().catch(() => undefined);
          throw error;
        }
      });
      if (existing.provider === "elevenlabs" && existing.external_agent_id) {
        const apiKey = await configuredProviderApiKey("elevenlabs");
        if (apiKey) {
          await deleteElevenLabsAgent(apiKey, existing.external_agent_id).catch((error) => {
            request.log.warn({ error }, "ElevenLabs agent cleanup failed");
          });
        }
      }
      await deleteNaturalDisclosure(existing.disclosure_asterisk_name).catch((error) => {
        request.log.warn({ error }, "Natural disclosure cleanup failed");
      });
      await audit("ai_receptionist.deleted", user.id, { agentId: existing.id }, request.ip);
      return { ok: true };
    } catch (error) {
      request.log.error({ error }, "AI receptionist deletion failed");
      return reply.code(500).send({ error: "The AI receptionist could not be deleted" });
    }
  });
}
