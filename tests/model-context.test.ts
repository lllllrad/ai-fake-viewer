import { test } from "node:test";
import assert from "node:assert/strict";
import { modelContext } from "../packages/application/reactions/model-context.ts";
import { modelMessages } from "../packages/infrastructure/reactions/model-messages.ts";
import type { ModelInput } from "../packages/application/reactions/model-port.ts";
const fixture = (): ModelInput => ({
  description: "Synthetic broadcast",
  persona: { name: "Synthetic viewer", style: "Brief synthetic style" },
  messages: [{ id: "message", speaker: "viewer-1", text: "Synthetic message" }],
  transcripts: [{ id: "speech", capturedAt: 1, text: "Synthetic speech" }],
  frames: [],
});
test("outgoing context strips unexpected message, transcript and top-level metadata", () => {
  const input = {
    ...fixture(),
    privateAccount: "SECRET_ACCOUNT",
    messages: [
      {
        id: "message",
        speaker: "viewer-1",
        text: "Synthetic message",
        privateAccount: "SECRET_ACCOUNT",
      },
    ],
    newMessages: [
      {
        id: "new",
        speaker: "viewer-2",
        text: "Synthetic new text",
        requestId: "SECRET_REQUEST",
      },
    ],
    transcripts: [
      {
        id: "speech",
        capturedAt: 1,
        text: "Synthetic speech",
        rawAudio: "SECRET_AUDIO",
      },
    ],
    newTranscripts: [
      {
        id: "new-speech",
        capturedAt: 2,
        text: "Synthetic new speech",
        privateName: "SECRET_NAME",
      },
    ],
  };
  const context = modelContext(input);
  assert.equal(JSON.stringify(context).includes("SECRET"), false);
  assert.deepEqual(context.recentContext, [
    { id: "message", speaker: "viewer-1", text: "Synthetic message" },
  ]);
  assert.deepEqual(context.recentTranscripts, [
    { id: "speech", capturedAt: 1, text: "Synthetic speech" },
  ]);
});
test("anonymous context contains only approved labels and no added summary fields", () => {
  const input = fixture();
  input.chatSummary = Object.assign(
    {
      version: 1 as const,
      state: "available" as const,
      activity: "active" as const,
      topics: ["개발·기술", "SECRET_QUOTE"],
      atmosphere: ["응원 표현", "SECRET_NAME"],
    },
    { raw: "SECRET_RAW" },
  );
  const context = modelContext(input);
  assert.deepEqual(context.anonymousChatSummary, {
    version: 1,
    state: "available",
    activity: "active",
    topics: ["개발·기술"],
    atmosphere: ["응원 표현"],
  });
  assert.equal(JSON.stringify(context).includes("SECRET"), false);
});
test("projected text context owns its records independently of later input mutation", () => {
  const input = fixture();
  const context = modelContext(input);
  input.messages[0].text = "Changed";
  input.transcripts![0].text = "Changed speech";
  assert.equal(context.recentContext[0].text, "Synthetic message");
  assert.equal(context.recentTranscripts[0].text, "Synthetic speech");
});
test("image rendering includes exactly the selected Uint8Array view and only frame reference metadata", () => {
  const input = fixture();
  const storage = Uint8Array.from([10, 20, 30, 40]);
  input.frames = [
    {
      id: "frame",
      capturedAt: 1,
      width: 1,
      height: 1,
      bytes: storage.subarray(1, 3),
      source: "demo",
      hash: "PRIVATE_HASH",
      maskConfigVersion: "PRIVATE_MASK",
    },
  ];
  const rendered = modelMessages(input);
  const payload = JSON.stringify(rendered);
  assert(payload.includes("data:image/jpeg;base64,FB4="));
  assert.equal(payload.includes("PRIVATE_"), false);
  assert.equal(payload.includes("ChQeKA=="), false);
  assert.deepEqual(modelContext(input).frames, [
    { id: "frame", capturedAt: 1 },
  ]);
});
test("answer rendering supplies persona and text-only instructions without unresolved placeholders", () => {
  const rendered = modelMessages(fixture());
  const developer = String(rendered[0].content);
  assert(developer.includes("Brief synthetic style"));
  assert(developer.includes("No frame is present"));
  assert.equal(developer.includes("{{persona_style}}"), false);
  assert.equal(developer.includes("{{visual_instruction}}"), false);
});
test("review rendering uses its own instructions and includes the draft only as input data", () => {
  const input = fixture();
  const answer = modelMessages(input);
  input.reviewDraft = "Synthetic review draft";
  const review = modelMessages(input);
  assert.notEqual(review[0].content, answer[0].content);
  assert.equal(String(review[0].content).includes(input.reviewDraft), false);
  assert.equal(modelContext(input).reviewDraft, input.reviewDraft);
  assert.equal(JSON.stringify(review[1]).includes(input.reviewDraft), true);
});

test("service instructions override standard and experiment profiles without entering user context", () => {
  const input = {
    ...fixture(),
    instructions: "Synthetic service algorithm instructions",
  };
  const rendered = modelMessages(input, {
    answer: "Unused profile",
    review: "Unused review",
  });
  assert.equal(rendered[0].content, input.instructions);
  assert.equal(JSON.stringify(rendered[1]).includes(input.instructions), false);
});
