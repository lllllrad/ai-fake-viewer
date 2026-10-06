import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDecision } from "../packages/application/reactions/validate-decision.ts";
import {
  publicationProblem,
  evidenceProblem,
  prepareReview,
} from "../packages/domain/reactions/publication.ts";
import type { ReactionDecision } from "../packages/domain/reactions/decision.ts";

const decision: ReactionDecision = {
  action: "say",
  text: "A visible change",
  replyToMessageId: "human",
  evidenceMessageIds: ["human"],
  evidenceFrameIds: [],
  evidenceTranscriptIds: [],
};
function fixture() {
  const input = {
    messages: [{ id: "human", text: "original" }],
    frames: [],
    privacyRevision: 2,
  };
  const candidate = {
    generation: 3,
    sessionId: "broadcast",
    expires: 100,
    input,
    decision,
  };
  const current = {
    messages: new Map([["human", "original"]]),
    frames: new Set<string>(),
    transcripts: new Set<string>(),
    recentVideo: false,
    privacyRevision: 2,
    generation: 3,
    sessionId: "broadcast",
    now: 99,
    running: true,
    closed: false,
  };
  return { input, candidate, current };
}
test("decision validation separates contract parsing from evidence and output policies", () => {
  const { input } = fixture();
  assert.deepEqual(validateDecision(decision, input), decision);
  assert.throws(() =>
    validateDecision({ ...decision, unexpected: "field" }, input),
  );
  assert.throws(
    () =>
      validateDecision({ ...decision, evidenceMessageIds: ["missing"] }, input),
    /Invalid evidence/,
  );
  assert.throws(
    () => validateDecision({ ...decision, action: "skip" }, input),
    /null text/,
  );
  assert.throws(
    () => validateDecision({ ...decision, text: "x".repeat(121) }, input),
    /Invalid output/,
  );
  assert.throws(
    () =>
      validateDecision({ ...decision, text: "fixture@example.test" }, input),
    /Rejected output/,
  );
});
test("review drops expired background without mutating input and refuses expired cited speech", () => {
  const input = {
    messages: [],
    frames: [],
    transcripts: [
      { id: "old", text: "old", capturedAt: 1 },
      { id: "current", text: "current", capturedAt: 2 },
    ],
    newTranscripts: [{ id: "old", text: "old", capturedAt: 1 }],
  };
  const draft = {
    ...decision,
    evidenceMessageIds: [],
    replyToMessageId: null,
    evidenceTranscriptIds: ["current"],
  };
  const review = prepareReview(input, draft, new Set(["current"]))!;
  assert.deepEqual(
    review.transcripts?.map((t) => t.id),
    ["current"],
  );
  assert.deepEqual(review.newTranscripts, []);
  assert.equal(review.reviewDraft, decision.text);
  assert.equal(input.transcripts.length, 2);
  assert.equal(prepareReview(input, draft, new Set()), undefined);
});
test("publication binds a candidate to the broadcast, generation, running state and exact deadline", () => {
  const { candidate, current } = fixture();
  assert.equal(publicationProblem(candidate, current), undefined);
  for (const [patch, expected] of [
    [{ closed: true }, "broadcast_closed"],
    [{ running: false }, "stopped"],
    [{ sessionId: "next" }, "broadcast_changed"],
    [{ generation: 4 }, "generation_changed"],
    [{ now: 100 }, "candidate_expired"],
    [{ privacyRevision: 3 }, "privacy_changed"],
  ] as const)
    assert.equal(
      publicationProblem(candidate, { ...current, ...patch }),
      expected,
    );
});
test("all input message bodies remain current and cited audio/video must still exist", () => {
  const { input, current } = fixture();
  assert.equal(
    evidenceProblem(input, decision, {
      ...current,
      messages: new Map([["human", "edited"]]),
    }),
    "message_changed_or_removed",
  );
  assert.equal(
    evidenceProblem(input, decision, { ...current, messages: new Map() }),
    "message_changed_or_removed",
  );
  assert.equal(
    evidenceProblem({ ...input, frames: [{ id: "frame" }] }, decision, current),
    "video_stale",
  );
  assert.equal(
    evidenceProblem(
      input,
      { ...decision, evidenceFrameIds: ["frame"] },
      current,
    ),
    "frame_removed",
  );
  assert.equal(
    evidenceProblem(
      input,
      { ...decision, evidenceTranscriptIds: ["speech"] },
      current,
    ),
    "speech_removed",
  );
});
