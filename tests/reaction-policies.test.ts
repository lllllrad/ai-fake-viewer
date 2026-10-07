import { chooseCastMember } from "../services/viewer-ai/cast-selection.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectEvidenceWindow,
  baselinePacingBlocked,
  messageVersion,
} from "../packages/domain/reactions/evidence.ts";
import {
  castPacingBlocked,
  type ReactionMember,
} from "../packages/domain/reactions/cast-selection.ts";

test("evidence selection keeps the latest ten chunks, distinguishes context from triggers and does not consume input", () => {
  const transcripts = Array.from({ length: 12 }, (_, index) => ({
    id: String(index),
    text: "speech",
    capturedAt: 100 + index,
  })).reverse();
  const processedTranscriptIds = new Set(["old", "2"]);
  const original = { id: "human", speaker: "viewer", text: "first" };
  const processedMessageVersions = new Map([
    ["missing", "version"],
    ["human", messageVersion(original)],
  ]);
  const value = selectEvidenceWindow({
    now: 120,
    windowMs: 100,
    transcripts,
    processedTranscriptIds,
    processedMessageVersions,
    allowedPlatforms: ["youtube", "experiment"],
    recent: [
      { id: "expired", displayTime: 1, seq: 1, attribution: "youtube" },
      { id: "human", displayTime: 110, seq: 2, attribution: "youtube" },
      { id: "ai", displayTime: 111, seq: 3, attribution: "experiment" },
    ],
    messages: [
      { id: "expired", speaker: "viewer", text: "old" },
      { ...original, text: "edited" },
      { id: "ai", speaker: "synthetic", text: "response" },
    ],
  });
  assert.deepEqual(
    value.transcripts.map((t) => t.id),
    Array.from({ length: 10 }, (_, i) => String(i + 2)),
  );
  assert.equal(value.newTranscripts.length, 9);
  assert.equal(value.triggerMessage?.text, "edited");
  assert.deepEqual(
    value.newExternalMessages.map((message) => message.id),
    ["human"],
  );
  assert.equal(value.externalSequence, 2);
  assert.deepEqual([...value.processedTranscriptIds], ["2"]);
  assert.deepEqual([...value.processedMessageVersions.keys()], ["human"]);
  assert.equal(processedTranscriptIds.size, 2);
  assert.equal(processedMessageVersions.size, 2);
  assert.equal(transcripts[0].id, "11");
});
test("synthetic chat alone never becomes a human input trigger", () => {
  const value = selectEvidenceWindow({
    now: 100,
    windowMs: 100,
    transcripts: [],
    processedTranscriptIds: new Set(),
    processedMessageVersions: new Map(),
    allowedPlatforms: ["experiment"],
    recent: [{ id: "ai", displayTime: 99, seq: 1, attribution: "experiment" }],
    messages: [{ id: "ai", speaker: "synthetic", text: "response" }],
  });
  assert.equal(value.newMessages.length, 1);
  assert.equal(value.triggerMessage, undefined);
  assert.equal(value.recentExternalCount, 0);
});

function selectionFixture() {
  const member: ReactionMember = {
    displayName: "Orbit",
    attention: 1,
    focusTags: [],
    lastPublishedAt: null,
    consecutiveMessages: 0,
    presence: [
      {
        joined_at: 100,
        joined_after_seq: 10,
        left_at: 200,
        left_after_seq: 20,
      },
    ],
    snapshot: {
      core: { interests: [], observation_focus: [] },
      participation: { base_propensity: 1, topic_sensitivity: 1 },
    },
  };
  const recent = [
    { id: "before", displayTime: 99, seq: 9, attribution: "youtube" },
    { id: "joined-cutoff", displayTime: 100, seq: 10, attribution: "youtube" },
    { id: "inside", displayTime: 100, seq: 11, attribution: "youtube" },
    { id: "last", displayTime: 200, seq: 20, attribution: "youtube" },
    { id: "after", displayTime: 201, seq: 21, attribution: "youtube" },
  ];
  const messages = recent.map((event) => ({
    id: event.id,
    speaker: "viewer",
    text: "text",
  }));
  const transcripts = [99, 100, 200, 201].map((at) => ({
    id: String(at),
    capturedAt: at,
    text: "speech",
  }));
  return {
    members: [member],
    recent,
    observation: {
      messages,
      newMessages: messages,
      transcripts,
      newTranscripts: transcripts,
      frames: [{ id: "frame", capturedAt: 100, bytes: "opaque" }],
    },
    now: 220,
    contextWindowMs: 1000,
    minimumPacingMs: 20,
    maximumPacingMs: 20,
    policy: {},
    random: () => 0,
  };
}
test("member observations respect both sequence and time boundaries without losing the full transcript context", () => {
  const fixture = selectionFixture();
  const selected = chooseCastMember(fixture)!;
  assert.equal(selected.member, fixture.members[0]);
  assert.deepEqual(
    selected.observation.messages.map((m) => m.id),
    ["inside", "last"],
  );
  assert.deepEqual(
    selected.observation.transcripts.map((t) => t.id),
    ["100", "200"],
  );
  assert.deepEqual(
    selected.observation.newTranscripts.map((t) => t.id),
    ["100", "200"],
  );
  assert.equal(selected.observation.frames[0].bytes, "opaque");
  assert.equal(fixture.observation.messages.length, 5);
});
test("cooldown, consecutive speech and zero propensity cannot be bypassed by deterministic selection", () => {
  const fixture = selectionFixture(),
    member = fixture.members[0];
  member.lastPublishedAt = fixture.now - 1;
  assert.equal(chooseCastMember(fixture), undefined);
  member.lastPublishedAt = null;
  member.consecutiveMessages = 2;
  assert.equal(chooseCastMember(fixture), undefined);
  member.consecutiveMessages = 0;
  member.snapshot.participation.base_propensity = 0;
  assert.equal(chooseCastMember(fixture), undefined);
  const speakingMember = structuredClone(member);
  speakingMember.displayName = "Other";
  speakingMember.snapshot.participation.base_propensity = 1;
  assert.equal(
    chooseCastMember({ ...fixture, members: [member, speakingMember] })?.member,
    speakingMember,
  );
  member.snapshot.participation.base_propensity = 0.1;
  assert.equal(chooseCastMember({ ...fixture, random: () => 0.9 }), undefined);
});
test("observation eligibility includes pacing and model delay but never exceeds the context window", () => {
  const fixture = selectionFixture();
  fixture.now = 50200;
  fixture.contextWindowMs = 120000;
  fixture.maximumPacingMs = 20000;
  fixture.members[0].presence[0].left_at = null;
  fixture.members[0].presence[0].left_after_seq = null;
  fixture.policy = { max_observation_age_ms: 12000, model_timeout_ms: 30000 };
  assert(chooseCastMember(fixture));
  fixture.contextWindowMs = 40000;
  assert.equal(chooseCastMember(fixture), undefined);
});
test("baseline and cast pacing enforce global and activity-band limits independently", () => {
  assert.equal(baselinePacingBlocked(15, [], 100000), false);
  assert.equal(baselinePacingBlocked(16, [], 100000), true);
  assert.equal(baselinePacingBlocked(0, [99997, 99998, 99999], 100000), true);
  const input = {
    recent: [
      { id: "ai", seq: 1, attribution: "experiment", displayTime: 99999 },
    ],
    speechTimes: [],
    now: 100000,
    lastSpoke: 0,
    policy: {
      global_hard_cap_messages_per_window: 6,
      upstream_activity_bands: [
        { min_messages: 0, max_messages: null, ai_cap_messages_per_window: 1 },
      ],
    },
  };
  assert.equal(castPacingBlocked(input), true);
  assert.equal(castPacingBlocked({ ...input, recent: [] }), false);
  assert.equal(
    castPacingBlocked({ ...input, recent: [], lastSpoke: 99999 }),
    true,
  );
});
