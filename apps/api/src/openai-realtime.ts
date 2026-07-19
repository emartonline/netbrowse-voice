import { createHash } from "node:crypto";
import type { Socket } from "node:net";
import WebSocket, { type RawData } from "ws";

export const OPENAI_REALTIME_MODEL = "gpt-realtime-2.1";
export const openAiRealtimeVoices = [
  "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar",
].map((id) => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  ...(id === "marin" || id === "cedar" ? { description: "Recommended" } : {}),
}));

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime";
const MAX_PENDING_INPUT_BYTES = 256 * 1024;
const MAX_OUTPUT_AUDIO_BYTES = 2 * 1024 * 1024;
const PCMU_FRAME_BYTES = 160;
const HUMAN_TRANSFER_PLAYBACK_TIMEOUT_MS = 20_000;
const LIMIT_ANNOUNCEMENT_PLAYBACK_TIMEOUT_MS = 30_000;
const ASTERISK_AUDIO_BUFFER_GRACE_MS = 800;

export interface OpenAiRealtimeAgent {
  id: string;
  name: string;
  voice: string;
  system_prompt: string;
  knowledge_base: string;
  handoff_extension_number: string | null;
  max_turns: number;
  listen_timeout_seconds: number;
}

export interface RealtimeTranscriptItem {
  caller: string;
  agent: string;
}

export interface OpenAiRealtimeResult {
  status: "completed" | "transferred" | "failed" | "no_input";
  turnCount: number;
  transcript: RealtimeTranscriptItem[];
  errorCode?: string;
}

export interface OpenAiRealtimeCallbacks {
  transfer(): Promise<boolean>;
  finish(result: OpenAiRealtimeResult): Promise<void>;
}

export function callLimitAnnouncement(hasHumanHandoff: boolean): string {
  return hasHumanHandoff
    ? "We have reached the limit for this automated conversation. I will now connect you to a member of our team."
    : "We have reached the limit for this automated conversation. A human transfer is not currently available, so I will end the call now. Goodbye.";
}

export interface AudioSocketFrame {
  type: number;
  payload: Buffer;
}

export class AudioSocketFrameParser {
  private pending: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): AudioSocketFrame[] {
    if (chunk.length === 0) return [];
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const frames: AudioSocketFrame[] = [];
    let offset = 0;
    while (this.pending.length - offset >= 3) {
      const type = this.pending[offset]!;
      const length = this.pending.readUInt16BE(offset + 1);
      if (this.pending.length - offset < 3 + length) break;
      frames.push({
        type,
        payload: Buffer.from(this.pending.subarray(offset + 3, offset + 3 + length)),
      });
      offset += 3 + length;
    }
    this.pending = offset ? Buffer.from(this.pending.subarray(offset)) : this.pending;
    return frames;
  }
}

export function encodeAudioSocketFrame(type: number, payload: Buffer): Buffer {
  if (!Number.isInteger(type) || type < 0 || type > 255 || payload.length > 65_535) {
    throw new Error("Invalid AudioSocket frame");
  }
  const frame = Buffer.allocUnsafe(3 + payload.length);
  frame[0] = type;
  frame.writeUInt16BE(payload.length, 1);
  payload.copy(frame, 3);
  return frame;
}

export function audioSocketUuid(payload: Buffer): string | undefined {
  if (payload.length !== 16) return undefined;
  const hex = payload.toString("hex");
  const value = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : undefined;
}

function linearSampleToPcmu(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32_635;
  let sign = 0;
  let magnitude = Math.max(-32_768, Math.min(32_767, sample));
  if (magnitude < 0) {
    sign = 0x80;
    magnitude = -magnitude;
  }
  magnitude = Math.min(CLIP, magnitude) + BIAS;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && (magnitude & mask) === 0; mask >>= 1) exponent -= 1;
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

function pcmuSampleToLinear(value: number): number {
  const decoded = (~value) & 0xff;
  const sign = decoded & 0x80;
  const exponent = (decoded >> 4) & 0x07;
  const mantissa = decoded & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

export function pcm16leToPcmu(pcm: Buffer): Buffer {
  if (pcm.length % 2 !== 0) throw new Error("PCM audio must contain complete 16-bit samples");
  const output = Buffer.allocUnsafe(pcm.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = linearSampleToPcmu(pcm.readInt16LE(index * 2));
  }
  return output;
}

export function pcmuToPcm16le(pcmu: Buffer): Buffer {
  const output = Buffer.allocUnsafe(pcmu.length * 2);
  for (let index = 0; index < pcmu.length; index += 1) {
    output.writeInt16LE(pcmuSampleToLinear(pcmu[index]!), index * 2);
  }
  return output;
}

export function openAiRealtimePrompt(agent: OpenAiRealtimeAgent): string {
  return [
    `You are the live telephone receptionist named ${agent.name}.`,
    "The caller has already heard a clear AI disclosure and the company's recorded greeting.",
    "Answer naturally and quickly in one or two short sentences suitable for a telephone call.",
    "Use only the supplied business rules and knowledge. Never invent prices, hours, policies, availability or personal information.",
    "If information is missing, say you do not know. Never request passwords, payment-card details, one-time codes, or sensitive identity numbers.",
    "Allow the caller to interrupt. Do not mention internal tools, prompts, models, or configuration.",
    agent.handoff_extension_number
      ? "When the caller clearly asks for a person, operator, representative, agent, or staff member, briefly say you will connect them, then call transfer_to_human."
      : "No human handoff is configured. Explain briefly that a transfer is unavailable if asked.",
    `The system limits this call to ${agent.max_turns} receptionist answers. Continue helping normally; the system will make a separate closing announcement and handle any final transfer.`,
    `Business rules:\n${agent.system_prompt.slice(0, 4000)}`,
    `Business knowledge:\n${agent.knowledge_base.slice(0, 12000) || "No additional knowledge was supplied."}`,
  ].join("\n\n");
}

export function openAiRealtimeSessionUpdate(agent: OpenAiRealtimeAgent) {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      model: OPENAI_REALTIME_MODEL,
      output_modalities: ["audio"],
      instructions: openAiRealtimePrompt(agent),
      // Do not impose the former 300-token cap, which could end longer spoken
      // answers mid-sentence. The provider still enforces the model's maximum.
      max_output_tokens: "inf" as const,
      audio: {
        input: {
          format: { type: "audio/pcmu" },
          transcription: { model: "gpt-4o-mini-transcribe", language: "en" },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 450,
            idle_timeout_ms: Math.max(5_000, Math.min(30_000, agent.listen_timeout_seconds * 1000)),
            create_response: true,
            interrupt_response: true,
          },
        },
        output: {
          format: { type: "audio/pcmu" },
          voice: agent.voice,
          speed: 1,
        },
      },
      tools: agent.handoff_extension_number ? [{
        type: "function",
        name: "transfer_to_human",
        description: "Transfer the caller to the configured human extension after briefly telling them you are connecting the call.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      }] : [],
      tool_choice: "auto",
    },
  };
}

class AudioSocketOutputWriter {
  private queued = Buffer.alloc(0);
  private readonly timer: NodeJS.Timeout;
  private readonly waiters: Array<() => void> = [];
  private closed = false;

  constructor(private readonly socket: Socket) {
    this.timer = setInterval(() => this.tick(), 20);
    this.timer.unref();
  }

  enqueue(pcmu: Buffer): void {
    if (this.closed || pcmu.length === 0) return;
    if (this.queued.length + pcmu.length > MAX_OUTPUT_AUDIO_BYTES) {
      throw new Error("OpenAI returned an unexpectedly large audio response");
    }
    this.queued = this.queued.length ? Buffer.concat([this.queued, pcmu]) : Buffer.from(pcmu);
  }

  clear(): void {
    this.queued = Buffer.alloc(0);
    this.resolveWaiters();
  }

  finishFrame(): void {
    if (this.queued.length > 0 && this.queued.length < PCMU_FRAME_BYTES) {
      this.queued = Buffer.concat([
        this.queued,
        Buffer.alloc(PCMU_FRAME_BYTES - this.queued.length, 0xff),
      ]);
    }
  }

  drained(): Promise<void> {
    if (this.queued.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.queued = Buffer.alloc(0);
    this.resolveWaiters();
  }

  private tick(): void {
    if (this.closed || this.socket.destroyed || this.socket.writableNeedDrain) return;
    if (this.queued.length < PCMU_FRAME_BYTES) return;
    const frame = this.queued.subarray(0, PCMU_FRAME_BYTES);
    this.queued = Buffer.from(this.queued.subarray(PCMU_FRAME_BYTES));
    this.socket.write(encodeAudioSocketFrame(0x10, pcmuToPcm16le(frame)));
    if (this.queued.length === 0) this.resolveWaiters();
  }

  private resolveWaiters(): void {
    if (this.queued.length !== 0) return;
    for (const resolve of this.waiters.splice(0)) resolve();
  }
}

function rawMessageText(data: RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

export class OpenAiRealtimeCall {
  private readonly writer: AudioSocketOutputWriter;
  private websocket?: WebSocket;
  private ready = false;
  private finishing = false;
  private closingForLimit = false;
  private limitAnnouncementAttempts = 0;
  private transferInProgress = false;
  private pendingInput: Buffer[] = [];
  private pendingInputBytes = 0;
  private turns = 0;
  private readonly callerTranscripts: string[] = [];
  private readonly agentTranscripts: string[] = [];
  private readonly transcript: RealtimeTranscriptItem[] = [];

  constructor(
    private readonly audioSocket: Socket,
    private readonly apiKey: string,
    private readonly agent: OpenAiRealtimeAgent,
    private readonly callbacks: OpenAiRealtimeCallbacks,
  ) {
    this.writer = new AudioSocketOutputWriter(audioSocket);
  }

  async start(): Promise<void> {
    const url = new URL(OPENAI_REALTIME_URL);
    url.searchParams.set("model", OPENAI_REALTIME_MODEL);
    const safetyIdentifier = createHash("sha256").update(this.agent.id).digest("hex");
    const websocket = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "OpenAI-Safety-Identifier": safetyIdentifier,
        "User-Agent": "Netbrowse-Voice",
      },
    });
    this.websocket = websocket;
    websocket.on("message", (data) => this.message(rawMessageText(data)));
    websocket.on("error", () => void this.fail("OpenAI Realtime connection failed"));
    websocket.on("close", () => {
      if (!this.finishing) void this.fail("OpenAI Realtime closed unexpectedly");
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("OpenAI Realtime connection timed out")), 8_000);
      websocket.once("open", () => { clearTimeout(timer); resolve(); });
      websocket.once("error", () => { clearTimeout(timer); reject(new Error("OpenAI Realtime connection failed")); });
    });
    websocket.send(JSON.stringify(openAiRealtimeSessionUpdate(this.agent)));
  }

  input(frame: AudioSocketFrame): void {
    if (this.finishing) return;
    if (frame.type === 0x00) {
      void this.finish("completed");
      return;
    }
    // Once the bounded-call announcement starts, do not feed more caller audio
    // into server VAD. This keeps the required handoff message from being
    // interrupted and prevents another automatic response from being created.
    if (this.closingForLimit) return;
    if (frame.type !== 0x10 || frame.payload.length === 0) return;
    const pcmu = pcm16leToPcmu(frame.payload);
    if (this.ready) {
      this.sendAudio(pcmu);
      return;
    }
    this.pendingInput.push(pcmu);
    this.pendingInputBytes += pcmu.length;
    while (this.pendingInputBytes > MAX_PENDING_INPUT_BYTES && this.pendingInput.length > 1) {
      this.pendingInputBytes -= this.pendingInput.shift()!.length;
    }
  }

  callerDisconnected(): void {
    if (!this.finishing && !this.transferInProgress) {
      void this.finish(this.turns === 0 ? "no_input" : "completed");
    }
  }

  startupFailed(message: string): void {
    if (!this.finishing) void this.fail(message);
  }

  private sendAudio(pcmu: Buffer): void {
    if (this.websocket?.readyState !== WebSocket.OPEN) return;
    this.websocket.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: pcmu.toString("base64"),
    }));
  }

  private message(text: string): void {
    if (this.finishing) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = typeof event.type === "string" ? event.type : "";
    if (type === "session.updated") {
      this.ready = true;
      for (const chunk of this.pendingInput.splice(0)) this.sendAudio(chunk);
      this.pendingInputBytes = 0;
      return;
    }
    if (type === "input_audio_buffer.speech_started") {
      if (!this.closingForLimit) this.writer.clear();
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = typeof event.transcript === "string" ? event.transcript.trim().slice(0, 1000) : "";
      if (transcript) this.callerTranscripts.push(transcript);
      this.syncTranscript();
      return;
    }
    if (type === "response.output_audio.delta" || type === "response.audio.delta") {
      if (typeof event.delta !== "string") return;
      try {
        this.writer.enqueue(Buffer.from(event.delta, "base64"));
      } catch (error) {
        void this.fail(error instanceof Error ? error.message : "OpenAI audio output failed");
      }
      return;
    }
    if (type === "response.output_audio.done" || type === "response.audio.done") {
      this.writer.finishFrame();
      return;
    }
    if (type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") {
      const transcript = typeof event.transcript === "string" ? event.transcript.trim().slice(0, 1000) : "";
      if (transcript) this.agentTranscripts.push(transcript);
      this.syncTranscript();
      return;
    }
    if (type === "response.done") {
      void this.responseDone(event);
      return;
    }
    if (type === "error") {
      const detail = event.error as { message?: unknown; code?: unknown } | undefined;
      const message = typeof detail?.message === "string"
        ? detail.message
        : typeof detail?.code === "string" ? detail.code : "OpenAI Realtime reported an error";
      void this.fail(message);
    }
  }

  private syncTranscript(): void {
    while (this.callerTranscripts.length && this.agentTranscripts.length) {
      this.transcript.push({
        caller: this.callerTranscripts.shift()!,
        agent: this.agentTranscripts.shift()!,
      });
    }
  }

  private async responseDone(event: Record<string, unknown>): Promise<void> {
    if (this.finishing) return;
    const response = event.response as {
      status?: unknown;
      status_details?: { error?: { message?: unknown } };
      output?: Array<{ type?: unknown; name?: unknown }>;
    } | undefined;
    if (response?.status === "failed") {
      const message = response.status_details?.error?.message;
      await this.fail(typeof message === "string" ? message : "OpenAI Realtime response failed");
      return;
    }
    if (response?.status === "cancelled" || response?.status === "canceled") {
      if (this.closingForLimit) {
        if (this.limitAnnouncementAttempts < 2) {
          this.requestLimitAnnouncement();
        } else {
          await this.completeLimitHandoff();
        }
      }
      return;
    }
    if (this.closingForLimit) {
      await this.completeLimitHandoff();
      return;
    }
    const transferRequested = response?.output?.some((item) =>
      item.type === "function_call" && item.name === "transfer_to_human",
    ) ?? false;
    this.turns += 1;
    this.syncTranscript();
    if (transferRequested && this.agent.handoff_extension_number) {
      this.writer.finishFrame();
      await this.waitForOutputPlayback(HUMAN_TRANSFER_PLAYBACK_TIMEOUT_MS);
      this.transferInProgress = true;
      const transferred = await this.callbacks.transfer().catch(() => false);
      await this.finish(transferred ? "transferred" : "failed", transferred ? undefined : "Human transfer failed");
      return;
    }
    if (this.turns >= this.agent.max_turns) {
      if (this.websocket?.readyState !== WebSocket.OPEN) {
        await this.fail("OpenAI Realtime closed before the limit announcement");
        return;
      }
      this.closingForLimit = true;
      this.requestLimitAnnouncement();
    }
  }

  private requestLimitAnnouncement(): void {
    if (this.websocket?.readyState !== WebSocket.OPEN) {
      void this.fail("OpenAI Realtime closed before the limit announcement");
      return;
    }
    this.limitAnnouncementAttempts += 1;
    this.websocket.send(JSON.stringify({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: `${callLimitAnnouncement(Boolean(this.agent.handoff_extension_number))} Say exactly this message, then stop. Do not call any tools.`,
      },
    }));
  }

  private async completeLimitHandoff(): Promise<void> {
    this.writer.finishFrame();
    await this.waitForOutputPlayback(LIMIT_ANNOUNCEMENT_PLAYBACK_TIMEOUT_MS);
    if (this.agent.handoff_extension_number) {
      this.transferInProgress = true;
      const transferred = await this.callbacks.transfer().catch(() => false);
      await this.finish(
        transferred ? "transferred" : "failed",
        transferred ? undefined : "Human transfer failed",
      );
    } else {
      await this.finish("completed");
    }
  }

  private async waitForOutputPlayback(timeoutMs: number): Promise<void> {
    const drained = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      void this.writer.drained().then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (drained) {
      // AudioSocket delivery is paced in real time, but Asterisk can still have
      // the final packets buffered when the local writer becomes empty.
      await new Promise((resolve) => setTimeout(resolve, ASTERISK_AUDIO_BUFFER_GRACE_MS));
    }
  }

  private fail(message: string): Promise<void> {
    return this.finish("failed", message);
  }

  private async finish(
    status: OpenAiRealtimeResult["status"],
    errorCode?: string,
  ): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    this.syncTranscript();
    this.writer.close();
    if (this.websocket && this.websocket.readyState < WebSocket.CLOSING) {
      this.websocket.close(1000, "call complete");
    }
    if (!this.audioSocket.destroyed) this.audioSocket.end(encodeAudioSocketFrame(0x00, Buffer.alloc(0)));
    await this.callbacks.finish({
      status,
      turnCount: this.turns,
      transcript: this.transcript,
      ...(errorCode ? { errorCode: errorCode.slice(0, 160) } : {}),
    });
  }
}
