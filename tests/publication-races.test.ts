import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage.ts";
import { Scheduler } from "../packages/scheduler.ts";
import { Capture } from "../packages/capture.ts";
import { configSchema } from "../packages/config.ts";
import type { Model, ModelInput, ModelResult } from "../packages/model.ts";

const original = {
  platform: "youtube" as const,
  channel: "fixture",
  author: "viewer",
  name: "Viewer",
  sourceId: "one",
  text: "ORIGINAL_FIXTURE",
};
function result(input: ModelInput): ModelResult {
  return {
    decision: {
      action: "say",
      text: "A response",
      replyToMessageId: input.messages[0].id,
      evidenceMessageIds: [input.messages[0].id],
      evidenceFrameIds: [],
      evidenceTranscriptIds: [],
    },
  };
}
function fixture(model: Model) {
  const config = configSchema.parse({
    ai: { visualMode: "on_request", manualApproval: true, reviewDraft: false },
  });
  const store = new Store(":memory:");
  const scheduler = new Scheduler(
    store,
    new Capture(config.capture, false),
    config,
    model,
    false,
    () => true,
  );
  store.grantConsent(original.platform, original.channel, original.author);
  store.ingestBatch([original]);
  scheduler.state = "running";
  return { store, scheduler };
}
test("an edit during generation discards the draft even though the message identifier still exists", async () => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { store, scheduler } = fixture(async (input) => {
    enter();
    await released;
    return result(input);
  });
  try {
    const work = scheduler.tick();
    await entered;
    store.ingestBatch([{ ...original, text: "EDITED_FIXTURE" }]);
    release();
    await work;
    assert.equal(scheduler.pending, undefined);
    assert(
      scheduler.diagnostics.some(
        (entry) =>
          entry.event === "candidate_discarded" &&
          entry.details.reason === "message_changed_or_removed",
      ),
    );
    assert.equal(store.snapshot().messages.length, 1);
  } finally {
    release();
    scheduler.stop();
    store.close();
  }
});
for (const reason of ["edited", "expired"] as const)
  test(`a ${reason} candidate is discarded before scheduling a publication delay`, async () => {
    const { store, scheduler } = fixture(async (input) => result(input));
    try {
      await scheduler.tick();
      assert(scheduler.pending);
      scheduler.pending.notBefore = Date.now() + 60000;
      if (reason === "edited")
        store.ingestBatch([{ ...original, text: "EDITED_FIXTURE" }]);
      else scheduler.pending.expires = Date.now();
      scheduler.approve();
      assert.equal(scheduler.pending, undefined);
      assert.equal(scheduler.dispatchTimer, undefined);
      assert.equal(store.snapshot().messages.length, 1);
      assert(
        scheduler.diagnostics.some(
          (entry) => entry.event === "publication_discarded",
        ),
      );
    } finally {
      scheduler.stop();
      store.close();
    }
  });

test("stop between draft completion and scheduler resumption cannot restore a candidate", async () => {
  const { store, scheduler } = fixture(async (input) => {
    queueMicrotask(() => queueMicrotask(() => scheduler.stop()));
    return result(input);
  });
  try {
    await scheduler.tick();
    assert.equal(scheduler.state, "stopped");
    assert.equal(scheduler.pending, undefined);
    assert.equal(scheduler.dispatchTimer, undefined);
    assert.equal(store.snapshot().messages.length, 1);
  } finally {
    scheduler.stop();
    store.close();
  }
});
