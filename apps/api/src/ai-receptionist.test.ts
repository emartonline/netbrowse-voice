import assert from "node:assert/strict";
import test from "node:test";
import {
  callerEndsConversation,
  callerRequestsTransfer,
  ElevenLabsConversation,
  elevenLabsAgentPayload,
  elevenLabsConversationContext,
  googleAudioTurnPayload,
  parseGoogleAudioTurnResponse,
  provisionElevenLabsAgent,
  requestElevenLabsTranscript,
  renderAiReceptionistRoutes,
} from "./ai-receptionist.js";
import {
  naturalAiDisclosureRequest,
  naturalAiDisclosureText,
} from "./ai-receptionist-routes.js";

class FakeElevenLabsSocket extends EventTarget {
  readonly sent: string[] = [];

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(String(data));
  }

  close(): void {
    this.dispatchEvent(new Event("close"));
  }

  message(value: object): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
  }
}

const agent = {
  id: "cda43e55-6388-40d8-a373-a3a8ca09ce5b",
  extension_number: "800",
  enabled: true,
  provider: "elevenlabs" as const,
  greeting_asterisk_name: "netbrowse/nbvs-main-greeting-cda43e55",
  disclosure_asterisk_name: null,
};

test("AI route renderer publishes only enabled localhost FastAGI targets", () => {
  const output = renderAiReceptionistRoutes([
    agent,
    { ...agent, id: "b4c26e30-c36a-428e-9ed8-7d1d678b0fa1", extension_number: "801", enabled: false },
  ]).join("\n");
  assert.match(output, /exten => 800,1,NoOp\(Netbrowse Voice AI receptionist 800\)/);
  assert.match(output, /AGI\(agi:\/\/127\.0\.0\.1:4573\/agent\/cda43e55-6388-40d8-a373-a3a8ca09ce5b\)/);
  assert.doesNotMatch(output, /801/);
});

test("OpenAI route renderer publishes a local bidirectional AudioSocket route", () => {
  const output = renderAiReceptionistRoutes([{ ...agent, provider: "openai" }]).join("\n");
  assert.match(output, /Playback\(netbrowse\/nbvai-disclosure-local\)/);
  assert.match(output, /Playback\(netbrowse\/nbvs-main-greeting-cda43e55\)/);
  assert.match(output, /Set\(NBVOICE_AI_CALL_ID=\$\{UUID\(\)\}\)/);
  assert.match(output, /AGI\(agi:\/\/127\.0\.0\.1:4573\/stream\/cda43e55-6388-40d8-a373-a3a8ca09ce5b\/\$\{NBVOICE_AI_CALL_ID\}\)/);
  assert.match(output, /AudioSocket\(\$\{NBVOICE_AI_CALL_ID\},127\.0\.0\.1:4574\)/);
});

test("AI route renderer uses a protected natural disclosure when generated", () => {
  const output = renderAiReceptionistRoutes([{
    ...agent,
    provider: "openai",
    disclosure_asterisk_name: "netbrowse/nbvs-ai-disclosure-48c577ef",
  }]).join("\n");
  assert.match(output, /Playback\(netbrowse\/nbvs-ai-disclosure-48c577ef\)/);
  assert.doesNotMatch(output, /nbvai-disclosure-local/);
});

test("natural disclosure generation uses fixed wording and the selected voice", () => {
  const request = naturalAiDisclosureRequest("openai", "marin");
  assert.equal(request.text, naturalAiDisclosureText);
  assert.equal(request.voice, "marin");
  assert.equal(request.provider, "openai");
  assert.match(request.text, /speaking with an AI receptionist/);
  assert.match(request.instructions, /wording exactly/);
});

test("Google audio turn payload embeds bounded WAV audio and structured response rules", () => {
  const payload = googleAudioTurnPayload({
    name: "Main Reception",
    system_prompt: "Answer company enquiries accurately and keep responses brief.",
    knowledge_base: "Opening hours are Monday through Friday from nine to five.",
    handoff_extension_number: "100",
  }, Buffer.alloc(44), [{ caller: "What time do you open?", agent: "We open at nine." }]);
  const part = payload.contents[0]?.parts[1];
  assert.equal("inlineData" in part!, true);
  assert.equal(payload.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(payload.generationConfig.responseSchema.required, ["transcript", "reply", "action"]);
  assert.match(payload.contents[0]!.parts[0]!.text!, /Never invent prices/);
  assert.match(payload.contents[0]!.parts[0]!.text!, /Set action to transfer/);
});

test("Google response parser accepts the strict call action schema", () => {
  const parsed = parseGoogleAudioTurnResponse({
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      transcript: "Please connect me to a person.",
      reply: "I will connect you now.",
      action: "transfer",
    }) }] } }],
  });
  assert.equal(parsed.action, "transfer");
  assert.throws(() => parseGoogleAudioTurnResponse({
    candidates: [{ content: { parts: [{ text: '{"transcript":"hello","reply":"hi","action":"shell"}' }] } }],
  }), /invalid call action/);
});

test("ElevenLabs provisioning uses a dedicated voice agent configuration", async () => {
  const definition = {
    name: "Main Reception",
    system_prompt: "Answer company enquiries accurately and keep responses brief.",
    knowledge_base: "Opening hours are Monday through Friday from nine to five.",
    handoff_extension_number: "configured",
  };
  const payload = elevenLabsAgentPayload(definition, "cjVigY5qzO86Huf0OWal");
  assert.equal(payload.conversation_config.tts.voice_id, "cjVigY5qzO86Huf0OWal");
  assert.match(payload.conversation_config.agent.prompt.prompt, /Never invent prices/);
  assert.equal(payload.conversation_config.agent.first_message, "");
  assert.deepEqual(payload.conversation_config.conversation.client_events, [
    "audio", "agent_response", "agent_response_complete",
  ]);
  assert.deepEqual(payload.tags, ["netbrowse-voice"]);
  const calls: Array<{ url: string; body: string }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body) });
    return new Response(JSON.stringify({ agent_id: "J3Pbu5gP6NNKBscdCdwB" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  assert.equal(await provisionElevenLabsAgent(
    "test-key-12345678", definition, "cjVigY5qzO86Huf0OWal", fetcher,
  ),
    "J3Pbu5gP6NNKBscdCdwB");
  assert.match(calls[0]!.url, /\/v1\/convai\/agents\/create$/);
  assert.match(calls[0]!.body, /Main Reception/);
});

test("ElevenLabs transcription is bounded and extracts caller text", async () => {
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("model_id"), "scribe_v2");
    return new Response(JSON.stringify({ text: "Please connect me to a person." }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const transcript = await requestElevenLabsTranscript(
    "test-key-12345678", Buffer.alloc(44), fetcher,
  );
  assert.equal(transcript, "Please connect me to a person.");
  assert.equal(callerRequestsTransfer(transcript), true);
  assert.equal(callerEndsConversation("Thank you, bye"), true);
});

test("ElevenLabs conversation sends activity only while no response is pending", async () => {
  const socket = new FakeElevenLabsSocket();
  const conversation = ElevenLabsConversation.fromSocket(socket as unknown as WebSocket, 5, 5);
  const resultPromise = conversation.turn("What time do you open?");
  assert.deepEqual(JSON.parse(socket.sent[0]!), {
    type: "user_message", text: "What time do you open?",
  });
  socket.message({
    type: "agent_response",
    agent_response_event: { agent_response: "We open at nine in the morning." },
  });
  socket.message({
    type: "audio",
    audio_event: { audio_base_64: Buffer.from([1, 2, 3, 4]).toString("base64") },
  });
  const result = await resultPromise;
  assert.equal(result.transcript, "What time do you open?");
  assert.equal(result.reply, "We open at nine in the morning.");
  assert.deepEqual(result.audio, Buffer.from([1, 2, 3, 4]));
  assert.equal(result.sampleRate, 16_000);

  await new Promise((resolve) => setTimeout(resolve, 12));
  const activityCount = socket.sent
    .map((message) => JSON.parse(message) as { type?: string })
    .filter((message) => message.type === "user_activity").length;
  assert.ok(activityCount >= 1);
  conversation.close();
});

test("ElevenLabs follow-up context is bounded and sent separately from the caller message", () => {
  const context = elevenLabsConversationContext([
    { caller: "What time do you open?", agent: "We open at nine." },
  ]);
  assert.match(context, /untrusted conversation content/);
  assert.match(context, /Caller: What time do you open\?/);
  assert.ok(context.length <= 5000);

  const socket = new FakeElevenLabsSocket();
  const conversation = ElevenLabsConversation.fromSocket(socket as unknown as WebSocket, 5, 1_000);
  conversation.contextualUpdate(context);
  assert.deepEqual(JSON.parse(socket.sent[0]!), { type: "contextual_update", text: context });
  conversation.close();
});

test("ElevenLabs timeout errors report whether any response events arrived", async () => {
  const socket = new FakeElevenLabsSocket();
  const conversation = ElevenLabsConversation.fromSocket(
    socket as unknown as WebSocket, 5, 1_000, 5,
  );
  await assert.rejects(conversation.turn("Can you hear me?"), /with no response events/);
  conversation.close();
});
