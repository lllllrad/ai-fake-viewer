import { test } from "node:test";
import assert from "node:assert/strict";
import { generateReviewedDraft } from "../packages/application/reactions/draft-review.ts";
import { StaleModelContextError } from "../packages/application/reactions/errors.ts";
const empty = {
  text: null,
  replyToMessageId: null,
  evidenceFrameIds: [],
  evidenceMessageIds: [],
  evidenceTranscriptIds: [],
};
const say = {
  ...empty,
  action: "say",
  text: "A synthetic response",
  evidenceTranscriptIds: ["new"],
};
function fixture() {
  const input = {
    frames: [] as { id: string }[],
    messages: [],
    transcripts: [
      { id: "old", text: "OLD", capturedAt: 1 },
      { id: "new", text: "NEW", capturedAt: 2 },
    ],
    newTranscripts: [{ id: "new", text: "NEW", capturedAt: 2 }],
    reviewDraft: undefined as string | undefined,
  };
  const requests: (typeof input)[] = [],
    phases: string[] = [];
  const options = {
    input,
    signal: new AbortController().signal,
    isCurrent: () => true,
    inspectAllowed: true,
    review: true,
    latestFrames: () => [{ id: "earlier" }, { id: "latest" }],
    hasTranscript: (id: string): boolean => id === "new",
    model: async (request: typeof input): Promise<{ decision: unknown }> => {
      requests.push(request);
      return { decision: say };
    },
    active: (_input: typeof input) => {},
    phase: (phase: string) => {
      phases.push(phase);
    },
    trace: () => {},
  };
  return { options, requests, phases };
}
test("one visual inspection uses the latest frame before independent review", async () => {
  const { options, requests, phases } = fixture();
  const model = options.model;
  options.model = async (request) => {
    if (!requests.length) {
      requests.push(request);
      return { decision: { ...empty, action: "inspect" } };
    }
    return model(request);
  };
  const outcome = await generateReviewedDraft(options);
  assert.equal(outcome.kind, "candidate");
  assert.deepEqual(phases, [
    "generating_draft",
    "generating_draft_with_frame",
    "ai_review",
  ]);
  assert.deepEqual(requests[1].frames, [{ id: "latest" }]);
  assert.equal(requests[2].reviewDraft, say.text);
  assert.deepEqual(
    requests[2].transcripts.map((t) => t.id),
    ["new"],
  );
  assert.equal(options.input.frames.length, 0);
  assert.equal(options.input.transcripts.length, 2);
});
for (const stage of [1, 2, 3])
  test(`cancellation after call ${stage} prevents any later calls or candidate`, async () => {
    const { options } = fixture();
    const controller = new AbortController();
    options.signal = controller.signal;
    let calls = 0;
    options.model = async () => {
      calls++;
      if (calls === stage) controller.abort();
      return { decision: calls === 1 ? { ...empty, action: "inspect" } : say };
    };
    assert.equal((await generateReviewedDraft(options)).kind, "canceled");
    assert.equal(calls, stage);
  });
test("a replaced generation is canceled even if its provider ignores abort", async () => {
  const { options } = fixture();
  options.model = async () => {
    options.isCurrent = () => false;
    return { decision: say };
  };
  assert.equal((await generateReviewedDraft(options)).kind, "canceled");
});
for (const unavailable of [true, false])
  test(`inspection is bounded when unavailable=${unavailable}`, async () => {
    const { options } = fixture();
    let calls = 0;
    options.inspectAllowed = !unavailable;
    options.model = async () => {
      calls++;
      return { decision: { ...empty, action: "inspect" } };
    };
    const result = await generateReviewedDraft(options);
    assert.equal(result.kind, "skipped");
    if (result.kind === "skipped")
      assert.equal(
        result.reason,
        unavailable ? "inspection_unavailable" : "repeated_inspection",
      );
    assert.equal(calls, unavailable ? 1 : 2);
  });
test("expired cited speech rejects before a review request", async () => {
  const { options, requests } = fixture();
  options.hasTranscript = () => false;
  await assert.rejects(generateReviewedDraft(options), StaleModelContextError);
  assert.equal(requests.length, 1);
});
test("review refusal produces a skipped outcome rather than the original draft", async () => {
  const { options } = fixture();
  options.model = async (request) => ({
    decision: request.reviewDraft ? { ...empty, action: "skip" } : say,
  });
  const result = await generateReviewedDraft(options);
  assert.equal(result.kind, "skipped");
  if (result.kind === "skipped") assert.equal(result.reason, "review_rejected");
});
