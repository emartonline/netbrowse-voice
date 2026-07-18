import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "./config.js";
import { pool } from "./database.js";
import { decryptSecret } from "./secrets.js";

const execFileAsync = promisify(execFile);
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const GOOGLE_SPEECH_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const ELEVENLABS_SPEECH_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const ELEVENLABS_VOICES_URL = "https://api.elevenlabs.io/v2/voices?page_size=100&sort=name&sort_direction=asc";

export type SoundProviderKey = "openai" | "google" | "elevenlabs";

export interface ProviderVoice {
  id: string;
  name: string;
  description?: string;
}

export interface ProviderAudio {
  data: Buffer;
  format: "wav" | "mp3" | "pcm_s16le";
  sampleRate?: number;
  channels?: number;
}

export const soundProviderModels: Record<SoundProviderKey, string> = {
  openai: "gpt-4o-mini-tts",
  google: "gemini-3.1-flash-tts-preview",
  elevenlabs: "eleven_multilingual_v2",
};

export const soundProviderNames: Record<SoundProviderKey, string> = {
  openai: "OpenAI",
  google: "Google Gemini",
  elevenlabs: "ElevenLabs",
};

export const soundProviderKeys = Object.keys(soundProviderModels) as SoundProviderKey[];

export const openAiVoices: ProviderVoice[] = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage",
  "shimmer", "verse", "marin", "cedar",
].map((id) => ({ id, name: id[0]!.toUpperCase() + id.slice(1) }));

const googleVoiceDescriptions: Array<[string, string]> = [
  ["Zephyr", "Bright"], ["Puck", "Upbeat"], ["Charon", "Informative"],
  ["Kore", "Firm"], ["Fenrir", "Excitable"], ["Leda", "Youthful"],
  ["Orus", "Firm"], ["Aoede", "Breezy"], ["Callirrhoe", "Easy-going"],
  ["Autonoe", "Bright"], ["Enceladus", "Breathy"], ["Iapetus", "Clear"],
  ["Umbriel", "Easy-going"], ["Algieba", "Smooth"], ["Despina", "Smooth"],
  ["Erinome", "Clear"], ["Algenib", "Gravelly"], ["Rasalgethi", "Informative"],
  ["Laomedeia", "Upbeat"], ["Achernar", "Soft"], ["Alnilam", "Firm"],
  ["Schedar", "Even"], ["Gacrux", "Mature"], ["Pulcherrima", "Forward"],
  ["Achird", "Friendly"], ["Zubenelgenubi", "Casual"], ["Vindemiatrix", "Gentle"],
  ["Sadachbia", "Lively"], ["Sadaltager", "Knowledgeable"], ["Sulafat", "Warm"],
];

export const googleVoices: ProviderVoice[] = googleVoiceDescriptions.map(([id, description]) => ({
  id,
  name: id,
  description,
}));

export class SoundStudioError extends Error {
  constructor(message: string, readonly statusCode = 500) {
    super(message);
    this.name = "SoundStudioError";
  }
}

export interface GenerateSpeechRequest {
  provider: SoundProviderKey;
  text: string;
  voice: string;
  instructions: string;
  speed: number;
}

export interface GeneratedSoundFile {
  id: string;
  filename: string;
  asteriskName: string;
  durationMs: number;
  sizeBytes: number;
  sampleRate: number;
  channels: number;
}

export function isSoundProviderKey(value: string): value is SoundProviderKey {
  return soundProviderKeys.includes(value as SoundProviderKey);
}

export function providerVoices(provider: SoundProviderKey): ProviderVoice[] {
  if (provider === "openai") return openAiVoices;
  if (provider === "google") return googleVoices;
  return [];
}

export function validSoundName(value: string): boolean {
  return value.length >= 2 && value.length <= 80 && !/[\u0000-\u001f<>]/.test(value);
}

export function soundSlug(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42)
    .replace(/-+$/g, "");
  return normalized || "sound";
}

export function soundAssetFilename(name: string, id: string): string {
  const suffix = id.replace(/-/g, "").slice(0, 8).toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(suffix)) throw new Error("Invalid sound asset id");
  return `nbvs-${soundSlug(name)}-${suffix}.wav`;
}

export function validSoundFilename(filename: string): boolean {
  return /^nbvs-[a-z0-9][a-z0-9-]{0,48}-[0-9a-f]{8}\.wav$/.test(filename) &&
    !filename.includes("..");
}

export function soundPath(filename: string): string {
  if (!validSoundFilename(filename)) throw new Error("Unsafe sound filename");
  return path.join(config.soundDir, filename);
}

export async function soundFileStat(filename: string) {
  try {
    const details = await stat(soundPath(filename));
    return details.isFile() && details.size > 44 ? details : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function deleteSoundFile(filename: string): Promise<void> {
  try {
    await unlink(soundPath(filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function openAiSpeechPayload(request: GenerateSpeechRequest) {
  return {
    model: soundProviderModels.openai,
    voice: request.voice,
    input: request.text,
    ...(request.instructions ? { instructions: request.instructions } : {}),
    response_format: "wav" as const,
    speed: request.speed,
  };
}

function googlePrompt(request: GenerateSpeechRequest): string {
  const speedDirection = request.speed < 0.9
    ? "Speak slowly."
    : request.speed > 1.1
      ? "Speak briskly."
      : "Speak at a natural pace.";
  const direction = [request.instructions, speedDirection].filter(Boolean).join(" ");
  return `${direction}\n\nRead the following announcement exactly as written:\n${request.text}`;
}

export function googleSpeechPayload(request: GenerateSpeechRequest) {
  return {
    model: soundProviderModels.google,
    input: googlePrompt(request),
    response_format: { type: "audio" },
    generation_config: {
      speech_config: [{ voice: request.voice }],
    },
  };
}

export function elevenLabsSpeechPayload(request: GenerateSpeechRequest) {
  return {
    text: request.text,
    model_id: soundProviderModels.elevenlabs,
    voice_settings: { speed: request.speed },
  };
}

async function limitedResponseBody(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_AUDIO_BYTES) {
    throw new SoundStudioError("The generated audio was unexpectedly large", 502);
  }
  if (!response.body) throw new SoundStudioError("The speech provider returned no audio", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > MAX_AUDIO_BYTES) {
      await reader.cancel();
      throw new SoundStudioError("The generated audio was unexpectedly large", 502);
    }
    chunks.push(item.value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
}

function providerFailure(provider: SoundProviderKey, status: number): SoundStudioError {
  const name = soundProviderNames[provider];
  if (status === 401 || status === 403) {
    return new SoundStudioError(`${name} rejected the configured API key`, 502);
  }
  if (status === 429) {
    return new SoundStudioError(`${name} rate limit or account quota reached`, 503);
  }
  if (status >= 500) {
    return new SoundStudioError(`${name} is temporarily unavailable`, 503);
  }
  return new SoundStudioError(`${name} could not generate this audio`, 502);
}

async function providerFetch(
  provider: SoundProviderKey,
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<Response> {
  try {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw providerFailure(provider, response.status);
    return response;
  } catch (error) {
    if (error instanceof SoundStudioError) throw error;
    throw new SoundStudioError(`${soundProviderNames[provider]} did not respond in time`, 503);
  }
}

export async function requestOpenAiSpeech(
  apiKey: string,
  request: GenerateSpeechRequest,
  fetcher: typeof fetch = fetch,
): Promise<ProviderAudio> {
  const response = await providerFetch("openai", OPENAI_SPEECH_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "user-agent": `Netbrowse-Voice/${config.version}`,
    },
    body: JSON.stringify(openAiSpeechPayload(request)),
  }, fetcher);
  const audio = await limitedResponseBody(response);
  if (audio.length <= 44) throw new SoundStudioError("OpenAI returned invalid audio", 502);
  return { data: audio, format: "wav" };
}

interface GoogleSpeechResponse {
  interaction?: { output_audio?: { data?: unknown } };
  output_audio?: { data?: unknown };
}

export async function requestGoogleSpeech(
  apiKey: string,
  request: GenerateSpeechRequest,
  fetcher: typeof fetch = fetch,
): Promise<ProviderAudio> {
  const response = await providerFetch("google", GOOGLE_SPEECH_URL, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
      "user-agent": `Netbrowse-Voice/${config.version}`,
    },
    body: JSON.stringify(googleSpeechPayload(request)),
  }, fetcher);
  let payload: GoogleSpeechResponse;
  try {
    payload = await response.json() as GoogleSpeechResponse;
  } catch {
    throw new SoundStudioError("Google Gemini returned an invalid response", 502);
  }
  const encoded = payload.interaction?.output_audio?.data ?? payload.output_audio?.data;
  if (typeof encoded !== "string" || encoded.length < 8) {
    throw new SoundStudioError("Google Gemini returned no audio", 502);
  }
  const data = Buffer.from(encoded, "base64");
  if (data.length < 2 || data.length > MAX_AUDIO_BYTES) {
    throw new SoundStudioError("Google Gemini returned invalid audio", 502);
  }
  return { data, format: "pcm_s16le", sampleRate: 24_000, channels: 1 };
}

export function validElevenLabsVoiceId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

export async function requestElevenLabsSpeech(
  apiKey: string,
  request: GenerateSpeechRequest,
  fetcher: typeof fetch = fetch,
): Promise<ProviderAudio> {
  if (!validElevenLabsVoiceId(request.voice)) {
    throw new SoundStudioError("Choose a valid ElevenLabs voice", 400);
  }
  const url = `${ELEVENLABS_SPEECH_URL}/${encodeURIComponent(request.voice)}?output_format=mp3_44100_128`;
  const response = await providerFetch("elevenlabs", url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      accept: "audio/mpeg",
      "content-type": "application/json",
      "user-agent": `Netbrowse-Voice/${config.version}`,
    },
    body: JSON.stringify(elevenLabsSpeechPayload(request)),
  }, fetcher);
  const audio = await limitedResponseBody(response);
  if (audio.length < 8) throw new SoundStudioError("ElevenLabs returned invalid audio", 502);
  return { data: audio, format: "mp3" };
}

interface ElevenLabsVoiceResponse {
  voices?: Array<{ voice_id?: unknown; name?: unknown; category?: unknown }>;
}

export async function listElevenLabsVoices(
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ProviderVoice[]> {
  const response = await providerFetch("elevenlabs", ELEVENLABS_VOICES_URL, {
    method: "GET",
    headers: {
      "xi-api-key": apiKey,
      accept: "application/json",
      "user-agent": `Netbrowse-Voice/${config.version}`,
    },
  }, fetcher);
  let payload: ElevenLabsVoiceResponse;
  try {
    payload = await response.json() as ElevenLabsVoiceResponse;
  } catch {
    throw new SoundStudioError("ElevenLabs returned an invalid voice list", 502);
  }
  if (!Array.isArray(payload.voices)) {
    throw new SoundStudioError("ElevenLabs returned an invalid voice list", 502);
  }
  return payload.voices.flatMap((voice) => {
    if (typeof voice.voice_id !== "string" || !validElevenLabsVoiceId(voice.voice_id)) return [];
    if (typeof voice.name !== "string" || !voice.name.trim()) return [];
    return [{
      id: voice.voice_id,
      name: voice.name.trim().slice(0, 120),
      ...(typeof voice.category === "string" && voice.category
        ? { description: voice.category.slice(0, 80) }
        : {}),
    }];
  }).slice(0, 100);
}

export function asteriskWavMetadata(buffer: Buffer): {
  durationMs: number;
  sizeBytes: number;
  sampleRate: number;
  channels: number;
} {
  if (
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Converted audio is not a WAV file");
  }
  let offset = 12;
  let format: { encoding: number; channels: number; sampleRate: number; bits: number } | undefined;
  let dataBytes: number | undefined;
  while (offset + 8 <= buffer.length) {
    const chunkName = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + chunkSize > buffer.length) break;
    if (chunkName === "fmt " && chunkSize >= 16) {
      format = {
        encoding: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bits: buffer.readUInt16LE(start + 14),
      };
    }
    if (chunkName === "data") dataBytes = chunkSize;
    offset = start + chunkSize + (chunkSize % 2);
  }
  if (!format || dataBytes === undefined) throw new Error("Converted WAV is missing audio data");
  if (
    format.encoding !== 1 ||
    format.channels !== 1 ||
    format.sampleRate !== 8000 ||
    format.bits !== 16
  ) {
    throw new Error("Converted WAV is not mono 8 kHz 16-bit PCM");
  }
  const bytesPerSecond = format.sampleRate * format.channels * (format.bits / 8);
  const durationMs = Math.round((dataBytes / bytesPerSecond) * 1000);
  if (durationMs < 1) throw new Error("Converted WAV contains no playable audio");
  return {
    durationMs,
    sizeBytes: buffer.length,
    sampleRate: format.sampleRate,
    channels: format.channels,
  };
}

export async function convertToAsteriskWav(source: ProviderAudio | Buffer): Promise<Buffer> {
  const normalized: ProviderAudio = Buffer.isBuffer(source)
    ? { data: source, format: "wav" }
    : source;
  const workDir = await mkdtemp(path.join(tmpdir(), "nbvoice-tts-"));
  const extension = normalized.format === "pcm_s16le" ? "pcm" : normalized.format;
  const sourcePath = path.join(workDir, `provider.${extension}`);
  const outputPath = path.join(workDir, "asterisk.wav");
  try {
    await writeFile(sourcePath, normalized.data, { mode: 0o600 });
    const inputArguments = normalized.format === "pcm_s16le"
      ? [
        "-f", "s16le",
        "-ar", String(normalized.sampleRate ?? 24_000),
        "-ac", String(normalized.channels ?? 1),
        "-i", sourcePath,
      ]
      : ["-i", sourcePath];
    await execFileAsync(
      config.ffmpegCommand,
      [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        ...inputArguments,
        "-vn", "-ac", "1", "-ar", "8000", "-c:a", "pcm_s16le", outputPath,
      ],
      { timeout: 30_000, maxBuffer: 512 * 1024 },
    );
    const converted = await readFile(outputPath);
    asteriskWavMetadata(converted);
    return converted;
  } catch (error) {
    if (error instanceof SoundStudioError) throw error;
    throw new SoundStudioError("The generated audio could not be converted for Asterisk", 500);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function configuredProviderApiKey(
  provider: SoundProviderKey,
): Promise<string | undefined> {
  const result = await pool.query<{ setting_value: unknown }>(
    "SELECT setting_value FROM settings WHERE setting_key = $1",
    [`sound_studio_${provider}_api_key`],
  );
  const encrypted = result.rows[0]?.setting_value;
  return typeof encrypted === "string" && encrypted ? decryptSecret(encrypted) : undefined;
}

export function configuredOpenAiApiKey(): Promise<string | undefined> {
  return configuredProviderApiKey("openai");
}

let generationQueue = Promise.resolve();

export function serializedSoundGeneration<T>(work: () => Promise<T>): Promise<T> {
  const result = generationQueue.then(work, work);
  generationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function requestProviderSpeech(
  apiKey: string,
  request: GenerateSpeechRequest,
): Promise<ProviderAudio> {
  if (request.provider === "openai") return requestOpenAiSpeech(apiKey, request);
  if (request.provider === "google") return requestGoogleSpeech(apiKey, request);
  return requestElevenLabsSpeech(apiKey, request);
}

export async function createSoundFile(
  name: string,
  request: GenerateSpeechRequest,
  apiKey: string,
): Promise<GeneratedSoundFile> {
  const source = await requestProviderSpeech(apiKey, request);
  const converted = await convertToAsteriskWav(source);
  const metadata = asteriskWavMetadata(converted);
  const id = randomUUID();
  const filename = soundAssetFilename(name, id);
  const temporaryFilename = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(config.soundDir, { recursive: true, mode: 0o2770 });
  const temporaryPath = path.join(config.soundDir, temporaryFilename);
  try {
    await writeFile(temporaryPath, converted, { mode: 0o640, flag: "wx" });
    await rename(temporaryPath, soundPath(filename));
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return {
    id,
    filename,
    asteriskName: `netbrowse/${filename.slice(0, -4)}`,
    ...metadata,
  };
}
