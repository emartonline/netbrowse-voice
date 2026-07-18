import assert from "node:assert/strict";
import test from "node:test";
import {
  asteriskWavMetadata,
  convertToAsteriskWav,
  elevenLabsSpeechPayload,
  googleSpeechPayload,
  listElevenLabsVoices,
  openAiSpeechPayload,
  requestElevenLabsSpeech,
  requestGoogleSpeech,
  soundAssetFilename,
  soundSlug,
  validSoundFilename,
  validSoundName,
} from "./sound-studio.js";

function pcmWav(sampleRate: number, channels: number, durationMs: number): Buffer {
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const dataSize = samples * channels * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 5000);
    for (let channel = 0; channel < channels; channel += 1) {
      buffer.writeInt16LE(value, 44 + (index * channels + channel) * 2);
    }
  }
  return buffer;
}

test("sound asset names become safe Asterisk filenames", () => {
  assert.equal(soundSlug("Main Office — After Hours"), "main-office-after-hours");
  const filename = soundAssetFilename(
    "Main Office — After Hours",
    "b4c26e30-c36a-428e-9ed8-7d1d678b0fa1",
  );
  assert.equal(filename, "nbvs-main-office-after-hours-b4c26e30.wav");
  assert.equal(validSoundFilename(filename), true);
  assert.equal(validSoundFilename("../announcement.wav"), false);
});

test("sound display names reject control characters and unsafe markup", () => {
  assert.equal(validSoundName("Welcome greeting"), true);
  assert.equal(validSoundName("A"), false);
  assert.equal(validSoundName("Bad\nname"), false);
  assert.equal(validSoundName("<script>"), false);
});

test("OpenAI speech payload requests WAV with pronunciation controls", () => {
  assert.deepEqual(
    openAiSpeechPayload({
      provider: "openai",
      text: "Thank you for calling.",
      voice: "marin",
      instructions: "Speak warmly and clearly.",
      speed: 0.95,
    }),
    {
      model: "gpt-4o-mini-tts",
      voice: "marin",
      input: "Thank you for calling.",
      instructions: "Speak warmly and clearly.",
      response_format: "wav",
      speed: 0.95,
    },
  );
});

test("Google speech payload requests a configured voice and exact announcement", () => {
  const payload = googleSpeechPayload({
    provider: "google",
    text: "Thank you for calling.",
    voice: "Kore",
    instructions: "Use a calm professional tone.",
    speed: 0.85,
  });
  assert.equal(payload.model, "gemini-3.1-flash-tts-preview");
  assert.deepEqual(payload.response_format, { type: "audio" });
  assert.deepEqual(payload.generation_config.speech_config, [{ voice: "Kore" }]);
  assert.match(payload.input, /calm professional tone/);
  assert.match(payload.input, /Speak slowly/);
  assert.match(payload.input, /Thank you for calling/);
});

test("ElevenLabs speech payload uses multilingual v2 and speed controls", () => {
  assert.deepEqual(elevenLabsSpeechPayload({
    provider: "elevenlabs",
    text: "Our office is closed.",
    voice: "voice_id_1234",
    instructions: "",
    speed: 1.1,
  }), {
    text: "Our office is closed.",
    model_id: "eleven_multilingual_v2",
    voice_settings: { speed: 1.1 },
  });
});

test("Google audio responses decode to 24 kHz raw PCM", async () => {
  const pcm = pcmWav(24000, 1, 100).subarray(44);
  const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "google-test-key-123456");
    return new Response(JSON.stringify({ output_audio: { data: pcm.toString("base64") } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const audio = await requestGoogleSpeech("google-test-key-123456", {
    provider: "google",
    text: "Test message",
    voice: "Kore",
    instructions: "",
    speed: 1,
  }, fetcher);
  assert.equal(audio.format, "pcm_s16le");
  assert.equal(audio.sampleRate, 24000);
  assert.deepEqual(audio.data, pcm);
});

test("ElevenLabs generation and voice discovery use account voices", async () => {
  const requests: string[] = [];
  const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    assert.equal(new Headers(init?.headers).get("xi-api-key"), "eleven-test-key-123456");
    if (url.includes("/v2/voices")) {
      return new Response(JSON.stringify({
        voices: [
          { voice_id: "voice_id_1234", name: "Office Voice", category: "premade" },
          { voice_id: "bad", name: "Invalid" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(Buffer.from("ID3-test-audio"), {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });
  }) as typeof fetch;
  const voices = await listElevenLabsVoices("eleven-test-key-123456", fetcher);
  assert.deepEqual(voices, [{ id: "voice_id_1234", name: "Office Voice", description: "premade" }]);
  const audio = await requestElevenLabsSpeech("eleven-test-key-123456", {
    provider: "elevenlabs",
    text: "Test message",
    voice: "voice_id_1234",
    instructions: "",
    speed: 1,
  }, fetcher);
  assert.equal(audio.format, "mp3");
  assert.ok(requests.some((url) => url.includes("voice_id_1234?output_format=mp3_44100_128")));
});

test("WAV metadata accepts only Asterisk mono 8 kHz PCM", () => {
  const metadata = asteriskWavMetadata(pcmWav(8000, 1, 1000));
  assert.equal(metadata.sampleRate, 8000);
  assert.equal(metadata.channels, 1);
  assert.equal(metadata.durationMs, 1000);
  assert.throws(() => asteriskWavMetadata(pcmWav(16000, 1, 1000)), /mono 8 kHz/);
});

test("ffmpeg conversion produces Asterisk-ready WAV audio", async () => {
  const converted = await convertToAsteriskWav(pcmWav(24000, 2, 250));
  const metadata = asteriskWavMetadata(converted);
  assert.equal(metadata.sampleRate, 8000);
  assert.equal(metadata.channels, 1);
  assert.ok(metadata.durationMs >= 240 && metadata.durationMs <= 260);
});

test("ffmpeg conversion accepts Google raw PCM audio", async () => {
  const rawPcm = pcmWav(24000, 1, 250).subarray(44);
  const converted = await convertToAsteriskWav({
    data: rawPcm,
    format: "pcm_s16le",
    sampleRate: 24000,
    channels: 1,
  });
  const metadata = asteriskWavMetadata(converted);
  assert.equal(metadata.sampleRate, 8000);
  assert.equal(metadata.channels, 1);
  assert.ok(metadata.durationMs >= 240 && metadata.durationMs <= 260);
});
