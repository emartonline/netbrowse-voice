import assert from "node:assert/strict";
import test from "node:test";
import {
  AudioSocketFrameParser,
  OPENAI_REALTIME_MODEL,
  audioSocketUuid,
  callLimitAnnouncement,
  encodeAudioSocketFrame,
  openAiRealtimePrompt,
  openAiRealtimeSessionUpdate,
  pcm16leToPcmu,
  pcmuToPcm16le,
} from "./openai-realtime.js";

const agent = {
  id: "cda43e55-6388-40d8-a373-a3a8ca09ce5b",
  name: "Main Reception",
  voice: "marin",
  system_prompt: "Answer company enquiries accurately and keep every response brief.",
  knowledge_base: "Opening hours are Monday through Friday from nine to five.",
  handoff_extension_number: "100",
  max_turns: 4,
  listen_timeout_seconds: 12,
};

test("AudioSocket parser accepts fragmented frames and preserves frame boundaries", () => {
  const uuid = Buffer.from("cda43e55638840d8a373a3a8ca09ce5b", "hex");
  const identity = encodeAudioSocketFrame(0x01, uuid);
  const audio = encodeAudioSocketFrame(0x10, Buffer.from([1, 2, 3, 4]));
  const parser = new AudioSocketFrameParser();
  assert.deepEqual(parser.push(identity.subarray(0, 7)), []);
  const frames = parser.push(Buffer.concat([identity.subarray(7), audio]));
  assert.equal(frames.length, 2);
  assert.equal(audioSocketUuid(frames[0]!.payload), agent.id);
  assert.deepEqual(frames[1], { type: 0x10, payload: Buffer.from([1, 2, 3, 4]) });
});

test("Asterisk signed-linear audio converts to telephone PCMU and back", () => {
  const pcm = Buffer.alloc(10);
  [-20_000, -1_000, 0, 1_000, 20_000].forEach((sample, index) =>
    pcm.writeInt16LE(sample, index * 2));
  const pcmu = pcm16leToPcmu(pcm);
  const restored = pcmuToPcm16le(pcmu);
  assert.equal(pcmu.length, 5);
  assert.equal(restored.length, pcm.length);
  assert.ok(restored.readInt16LE(0) < -15_000);
  assert.ok(Math.abs(restored.readInt16LE(4)) < 10);
  assert.ok(restored.readInt16LE(8) > 15_000);
});

test("OpenAI Realtime session uses direct PCMU streaming, server VAD and handoff", () => {
  const event = openAiRealtimeSessionUpdate(agent);
  assert.equal(OPENAI_REALTIME_MODEL, "gpt-realtime-2.1");
  assert.equal(event.session.model, OPENAI_REALTIME_MODEL);
  assert.deepEqual(event.session.output_modalities, ["audio"]);
  assert.deepEqual(event.session.audio.input.format, { type: "audio/pcmu" });
  assert.deepEqual(event.session.audio.output.format, { type: "audio/pcmu" });
  assert.equal(event.session.audio.output.voice, "marin");
  assert.equal(event.session.audio.input.turn_detection.create_response, true);
  assert.equal(event.session.audio.input.turn_detection.interrupt_response, true);
  assert.equal(event.session.tools[0]?.name, "transfer_to_human");
});

test("OpenAI receptionist prompt is bounded and protects sensitive information", () => {
  const prompt = openAiRealtimePrompt({
    ...agent,
    system_prompt: "x".repeat(5_000),
    knowledge_base: "y".repeat(13_000),
  });
  assert.match(prompt, /Never request passwords/);
  assert.match(prompt, /call transfer_to_human/);
  assert.ok(prompt.length < 17_000);
});

test("call limit announcements promise a transfer only when one is configured", () => {
  assert.match(callLimitAnnouncement(true), /connect you to a member of our team/);
  assert.doesNotMatch(callLimitAnnouncement(true), /end the call/);
  assert.match(callLimitAnnouncement(false), /transfer is not currently available/);
  assert.match(callLimitAnnouncement(false), /Goodbye/);
});
