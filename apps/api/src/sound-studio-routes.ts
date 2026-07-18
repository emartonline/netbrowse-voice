import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { requireAdministrator } from "./auth.js";
import { audit, pool } from "./database.js";
import { encryptSecret } from "./secrets.js";
import {
  configuredProviderApiKey,
  createSoundFile,
  deleteSoundFile,
  isSoundProviderKey,
  listElevenLabsVoices,
  providerVoices,
  serializedSoundGeneration,
  SoundStudioError,
  soundFileStat,
  soundPath,
  soundProviderKeys,
  soundProviderModels,
  soundProviderNames,
  validSoundName,
  type ProviderVoice,
  type SoundProviderKey,
} from "./sound-studio.js";

interface SoundAssetRow {
  id: string;
  name: string;
  filename: string;
  asterisk_name: string;
  provider: string;
  model: string;
  voice: string;
  source_text: string;
  instructions: string;
  speed: string | number;
  duration_ms: number;
  size_bytes: string | number;
  sample_rate: number;
  channels: number;
  created_at: Date;
}

interface SettingsBody {
  provider?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

interface GenerateBody {
  provider?: string;
  name?: string;
  text?: string;
  voice?: string;
  instructions?: string;
  speed?: number;
}

interface IdParams {
  id: string;
}

interface AudioQuery {
  download?: string;
}

interface PublicProvider {
  key: SoundProviderKey;
  name: string;
  configured: boolean;
  model: string;
  voices: ProviderVoice[];
  recommendedVoices: string[];
  controls: { instructions: boolean; speed: boolean };
  preview?: boolean;
  managedAccountRequired?: boolean;
  voiceLoadError?: string;
}

const soundColumns = `id, name, filename, asterisk_name, provider, model, voice,
  source_text, instructions, speed, duration_ms, size_bytes, sample_rate,
  channels, created_at`;

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validApiKey(value: string): boolean {
  return value.length >= 16 && value.length <= 512 && !/\s/.test(value);
}

function publicSound(row: SoundAssetRow, available: boolean) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    voice: row.voice,
    sourceText: row.source_text,
    instructions: row.instructions,
    speed: Number(row.speed),
    durationMs: row.duration_ms,
    sizeBytes: Number(row.size_bytes),
    sampleRate: row.sample_rate,
    channels: row.channels,
    asteriskName: row.asterisk_name,
    audioAvailable: available,
    createdAt: row.created_at,
  };
}

async function soundById(id: string): Promise<SoundAssetRow | undefined> {
  if (!validUuid(id)) return undefined;
  const result = await pool.query<SoundAssetRow>(
    `SELECT ${soundColumns} FROM sound_assets WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

function parseRange(value: string, size: number): { start: number; end: number } | undefined {
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return undefined;
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return undefined;
  }
  return { start, end: Math.min(end, size - 1) };
}

function recommendedVoices(provider: SoundProviderKey): string[] {
  if (provider === "openai") return ["marin", "cedar"];
  if (provider === "google") return ["Kore", "Achird", "Sulafat"];
  return [];
}

async function publicProvider(
  provider: SoundProviderKey,
  apiKey: string | undefined,
): Promise<PublicProvider> {
  let voices = providerVoices(provider);
  let voiceLoadError: string | undefined;
  if (provider === "elevenlabs" && apiKey) {
    try {
      voices = await listElevenLabsVoices(apiKey);
      if (voices.length === 0) voiceLoadError = "No ElevenLabs voices are available to this key.";
    } catch (error) {
      voiceLoadError = error instanceof SoundStudioError
        ? error.message
        : "ElevenLabs voices could not be loaded.";
    }
  }
  return {
    key: provider,
    name: soundProviderNames[provider],
    configured: Boolean(apiKey),
    model: soundProviderModels[provider],
    voices,
    recommendedVoices: recommendedVoices(provider),
    controls: {
      instructions: provider !== "elevenlabs",
      speed: true,
    },
    ...(provider === "google" ? { preview: true, managedAccountRequired: true } : {}),
    ...(provider === "elevenlabs" ? { managedAccountRequired: true } : {}),
    ...(voiceLoadError ? { voiceLoadError } : {}),
  };
}

export function registerSoundStudioRoutes(app: FastifyInstance): void {
  app.get("/api/sound-studio", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const [keys, result] = await Promise.all([
      Promise.all(soundProviderKeys.map((provider) => configuredProviderApiKey(provider))),
      pool.query<SoundAssetRow>(
        `SELECT ${soundColumns} FROM sound_assets ORDER BY created_at DESC LIMIT 100`,
      ),
    ]);
    const providers = await Promise.all(soundProviderKeys.map((provider, index) => (
      publicProvider(provider, keys[index])
    )));
    const sounds = [];
    let storageBytes = 0;
    for (const row of result.rows) {
      const details = await soundFileStat(row.filename);
      const available = Boolean(details);
      if (details) storageBytes += details.size;
      sounds.push(publicSound(row, available));
    }
    return {
      providers,
      provider: providers[0],
      sounds,
      total: sounds.length,
      storageBytes,
      aiDisclosureRequired: true,
    };
  });

  app.patch<{ Body: SettingsBody }>("/api/sound-studio/settings", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const providerValue = request.body?.provider ?? "openai";
    if (!isSoundProviderKey(providerValue)) {
      return reply.code(400).send({ error: "Choose a supported speech provider" });
    }
    const clear = request.body?.clearApiKey === true;
    const apiKey = request.body?.apiKey?.trim() ?? "";
    if (!clear && !validApiKey(apiKey)) {
      return reply.code(400).send({ error: `Enter a valid ${soundProviderNames[providerValue]} API key` });
    }
    const value = clear ? null : encryptSecret(apiKey);
    const settingKey = `sound_studio_${providerValue}_api_key`;
    await pool.query(
      `INSERT INTO settings (setting_key, setting_value, is_secret, updated_by, updated_at)
       VALUES ($1, $2::jsonb, true, $3, now())
       ON CONFLICT (setting_key) DO UPDATE SET
         setting_value = EXCLUDED.setting_value,
         is_secret = true,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()`,
      [settingKey, JSON.stringify(value), user.id],
    );
    await audit(clear ? "sound_studio.provider_removed" : "sound_studio.provider_configured", user.id, {
      provider: providerValue,
    }, request.ip);
    return { provider: providerValue, configured: !clear };
  });

  app.post<{ Body: GenerateBody }>("/api/sound-studio/generate", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const providerValue = request.body?.provider ?? "openai";
    if (!isSoundProviderKey(providerValue)) {
      return reply.code(400).send({ error: "Choose a supported speech provider" });
    }
    const name = request.body?.name?.trim().replace(/\s+/g, " ") ?? "";
    const text = request.body?.text?.trim() ?? "";
    const defaultVoice = providerValue === "google" ? "Kore" : "marin";
    const voice = request.body?.voice ?? defaultVoice;
    const instructions = request.body?.instructions?.trim() ?? "";
    const speed = Number(request.body?.speed ?? 1);
    if (!validSoundName(name)) {
      return reply.code(400).send({ error: "Enter a sound name between 2 and 80 characters" });
    }
    if (text.length < 1 || text.length > 4096) {
      return reply.code(400).send({ error: "Speech text must contain between 1 and 4096 characters" });
    }
    if (instructions.length > 1000) {
      return reply.code(400).send({ error: "Voice direction must not exceed 1000 characters" });
    }
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 1.5) {
      return reply.code(400).send({ error: "Speech speed must be between 0.5 and 1.5" });
    }
    const apiKey = await configuredProviderApiKey(providerValue);
    if (!apiKey) {
      return reply.code(409).send({
        error: `Configure the ${soundProviderNames[providerValue]} speech provider first`,
      });
    }
    let voices: ProviderVoice[];
    try {
      voices = providerValue === "elevenlabs"
        ? await listElevenLabsVoices(apiKey)
        : providerVoices(providerValue);
    } catch (error) {
      if (error instanceof SoundStudioError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
    if (!voices.some((item) => item.id === voice)) {
      return reply.code(400).send({ error: `Choose a supported ${soundProviderNames[providerValue]} voice` });
    }
    try {
      const generated = await serializedSoundGeneration(() => createSoundFile(
        name,
        { provider: providerValue, text, voice, instructions, speed },
        apiKey,
      ));
      let row: SoundAssetRow;
      try {
        const result = await pool.query<SoundAssetRow>(
          `INSERT INTO sound_assets
             (id, name, filename, asterisk_name, provider, model, voice,
              source_text, instructions, speed, duration_ms, size_bytes,
              sample_rate, channels, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING ${soundColumns}`,
          [
            generated.id,
            name,
            generated.filename,
            generated.asteriskName,
            providerValue,
            soundProviderModels[providerValue],
            voice,
            text,
            providerValue === "elevenlabs" ? "" : instructions,
            speed,
            generated.durationMs,
            generated.sizeBytes,
            generated.sampleRate,
            generated.channels,
            user.id,
          ],
        );
        const inserted = result.rows[0];
        if (!inserted) throw new Error("Sound asset insert did not return a row");
        row = inserted;
      } catch (error) {
        await deleteSoundFile(generated.filename);
        throw error;
      }
      await audit("sound_studio.generated", user.id, {
        soundId: row.id,
        name: row.name,
        provider: row.provider,
        model: row.model,
        voice: row.voice,
        characters: row.source_text.length,
      }, request.ip).catch((error) => request.log.warn({ error }, "Sound generation audit failed"));
      return reply.code(201).send({ sound: publicSound(row, true) });
    } catch (error) {
      request.log.warn({ error }, "Sound generation failed");
      if (error instanceof SoundStudioError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      return reply.code(500).send({ error: "Sound generation failed" });
    }
  });

  app.get<{ Params: IdParams; Querystring: AudioQuery }>(
    "/api/sound-studio/:id/audio",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      const sound = await soundById(request.params.id);
      if (!sound) return reply.code(404).send({ error: "Sound not found" });
      const details = await soundFileStat(sound.filename);
      if (!details) return reply.code(404).send({ error: "Sound file is unavailable" });
      const download = request.query.download === "1";
      reply.header("accept-ranges", "bytes");
      reply.header("cache-control", "private, no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header(
        "content-disposition",
        `${download ? "attachment" : "inline"}; filename="${sound.filename}"`,
      );
      reply.type("audio/wav");
      if (!download && request.headers.range) {
        const range = parseRange(request.headers.range, details.size);
        if (!range) {
          return reply.code(416).header("content-range", `bytes */${details.size}`).send();
        }
        reply.code(206);
        reply.header("content-range", `bytes ${range.start}-${range.end}/${details.size}`);
        reply.header("content-length", range.end - range.start + 1);
        return reply.send(createReadStream(soundPath(sound.filename), range));
      }
      reply.header("content-length", details.size);
      return reply.send(createReadStream(soundPath(sound.filename)));
    },
  );

  app.delete<{ Params: IdParams }>("/api/sound-studio/:id", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    const sound = await soundById(request.params.id);
    if (!sound) return reply.code(404).send({ error: "Sound not found" });
    const ivrReferences = await pool.query<{ count: string }>(
      "SELECT count(*) FROM ivr_menus WHERE greeting_sound_asset_id = $1",
      [sound.id],
    );
    if (Number(ivrReferences.rows[0]?.count ?? 0) > 0) {
      return reply.code(409).send({ error: "This sound is used by an IVR menu. Change or delete that IVR first." });
    }
    const aiReferences = await pool.query<{ count: string }>(
      "SELECT count(*) FROM ai_receptionists WHERE greeting_sound_asset_id = $1",
      [sound.id],
    );
    if (Number(aiReferences.rows[0]?.count ?? 0) > 0) {
      return reply.code(409).send({ error: "This sound is used by an AI receptionist. Change or delete that agent first." });
    }
    await deleteSoundFile(sound.filename);
    await pool.query("DELETE FROM sound_assets WHERE id = $1", [sound.id]);
    await audit("sound_studio.deleted", user.id, {
      soundId: sound.id,
      name: sound.name,
      asteriskName: sound.asterisk_name,
    }, request.ip);
    return reply.code(204).send();
  });
}
