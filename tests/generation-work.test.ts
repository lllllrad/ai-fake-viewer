import { test } from "node:test";
import assert from "node:assert/strict";
import { GenerationWork } from "../packages/application/reactions/generation-work.ts";
function fixture() {
  return new GenerationWork<{ text: string }>((input) => {
    input.text = "";
  });
}
test("cancel detaches old work and aborts it before its promise completes", () => {
  const work = fixture(),
    input = { text: "Synthetic private input" };
  const old = work.begin(input);
  assert.equal(work.busy, true);
  work.cancel();
  assert.equal(work.busy, false);
  assert.equal(old.signal.aborted, true);
  assert.equal(input.text, "");
  const next = work.begin({ text: "New input" });
  assert.equal(work.finish(old), false);
  assert.equal(work.busy, true);
  assert.equal(work.current(next), true);
  assert.equal(next.signal.aborted, false);
});
test("all input variants are discarded, including original draft and review", () => {
  const work = fixture(),
    original = { text: "Original" },
    review = { text: "Review" };
  const lease = work.begin(original);
  work.track(lease, review);
  work.cancel();
  assert.equal(original.text, "");
  assert.equal(review.text, "");
  const late = { text: "Late context" };
  work.track(lease, late);
  assert.equal(late.text, "");
});
test("finishing the current work preserves the accepted candidate and releases the slot once", () => {
  const work = fixture(),
    input = { text: "Candidate context" };
  const lease = work.begin(input);
  assert.equal(work.finish(lease), true);
  assert.equal(work.finish(lease), false);
  assert.equal(work.busy, false);
  assert.equal(input.text, "Candidate context");
});
test("concurrent begin is rejected and idle cancellation invalidates prior generations", () => {
  const work = fixture(),
    lease = work.begin({ text: "First" });
  assert.throws(() => work.begin({ text: "Second" }), /already active/);
  work.cancel();
  work.cancel();
  assert.equal(work.generation, lease.generation + 2);
});
test("an abort listener can start replacement work without the old cancellation clearing it", () => {
  const work = fixture(),
    lease = work.begin({ text: "First" });
  lease.signal.addEventListener("abort", () =>
    work.begin({ text: "Replacement" }),
  );
  work.cancel();
  assert.equal(work.busy, true);
  assert.equal(work.finish(lease), false);
  assert.equal(work.busy, true);
});
