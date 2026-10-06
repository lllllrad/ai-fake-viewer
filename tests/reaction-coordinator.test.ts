import { test } from "node:test";
import assert from "node:assert/strict";
import { ReactionCoordinator } from "../packages/application/reactions/coordinator.ts";
import { TimingGate } from "../packages/application/reactions/timing-gate.ts";
import { configSchema } from "../packages/config.ts";
import { Store } from "../packages/storage.ts";

test("the application coordinator uses its clock for generation, pacing and candidate expiry", async (t) => {
  let now = 1_000_000;
  let chunk = { id: "first", capturedAt: now, text: "Synthetic speech" };
  const hashes: string[] = [];
  const store = new Store(":memory:");
  const config = configSchema.parse({
    ai: {
      visualMode: "on_request",
      reviewDraft: false,
      manualApproval: true,
      pacing: { minSeconds: 20, maxSeconds: 20 },
    },
  });
  const coordinator = new ReactionCoordinator<Uint8Array, number>(
    store,
    { recent: () => [], has: () => false },
    config,
    async () => {
      now += 25;
      return {
        decision: {
          action: "say",
          text: "확인했어요.",
          replyToMessageId: null,
          evidenceFrameIds: [],
          evidenceMessageIds: [],
          evidenceTranscriptIds: [chunk.id],
        },
      };
    },
    false,
    () => true,
    { recent: () => [chunk], has: (id) => id === chunk.id },
    new TimingGate(config.ai.gate, {
      ensureReady: () => assert.fail("Disabled gate must not run"),
      evaluate: async () => assert.fail("Disabled gate must not run"),
    }),
    () => 0,
    {
      now: () => now,
      id: () => "fixture-attempt",
      hash: (value) => {
        hashes.push(value);
        return value;
      },
      clock: {
        repeat: () => assert.fail("Manual ticks must not allocate timers"),
        cancelRepeat: () => {},
        delay: () => assert.fail("Manual approval must not allocate timers"),
        cancelDelay: () => {},
      },
      issue: () =>
        assert.fail("Successful generation must not classify an error"),
    },
  );
  t.after(() => {
    coordinator.stop();
    store.close();
  });
  coordinator.state = "running";
  await coordinator.tick();
  assert.equal(coordinator.phase, "awaiting_human_review");
  assert.equal(coordinator.pending?.expires, 1_030_000);
  assert.equal(coordinator.lastAttempt, 1_020_025);
  assert.equal(
    coordinator.diagnostics.find((event) => event.event === "model_result")
      ?.details.elapsedMs,
    25,
  );
  assert.deepEqual(JSON.parse(hashes[0]), {
    transcripts: ["first"],
    messages: [],
  });
  now = 1_030_000;
  coordinator.approve();
  assert.equal(coordinator.pending, undefined);
  assert.equal(store.snapshot().messages.length, 0);
  assert.equal(coordinator.diagnostics.at(-1)?.event, "publication_discarded");

  chunk = { ...chunk, id: "second", capturedAt: now };
  await coordinator.tick();
  coordinator.approve();
  assert.equal(store.snapshot().messages.length, 1);
  assert.equal(coordinator.lastSpoke, now);
  assert.equal(coordinator.diagnostics.at(-1)?.at, now);
});
