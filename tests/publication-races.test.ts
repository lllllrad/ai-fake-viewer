import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage.ts";
import { Scheduler } from "../packages/infrastructure/reactions/scheduler.ts";
import { Capture } from "../packages/infrastructure/inputs/screen-input.ts";
import { configSchema } from "../packages/config.ts";
import type {
  Model,
  ModelInput,
  ModelResult,
} from "../packages/application/reactions/model-port.ts";

const original = {
  platform: "experiment" as const,
  channel: "fixture",
  author: "viewer",
  name: "Viewer",
  sourceId: "one",
  text: "ORIGINAL_FIXTURE",
};
function result(input: ModelInput<Buffer>): ModelResult {
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
function fixture(model: Model<Buffer>) {
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
    {
      recent: () => [
        {
          id: "speech-" + store.lastSeq(),
          text: "Synthetic speech",
          capturedAt: Date.now(),
        },
      ],
      has: () => true,
    } as any,
  );

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

test("delayed publication storage failure stops AI without an uncaught timer exception", async (t) => {
  const { store, scheduler } = fixture(async (input) => result(input));
  try {
    await scheduler.tick();
    assert(scheduler.pending);
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
    scheduler.pending.notBefore = Date.now() + 10;
    scheduler.pending.expires = Date.now() + 1000;
    scheduler.approve();
    assert(scheduler.dispatchTimer);
    t.mock.method(store, "publishSynthetic", () => {
      throw Error("fixture storage failure");
    });
    assert.doesNotThrow(() => t.mock.timers.tick(10));
    assert.equal(scheduler.state, "scheduler_error");
    assert.equal(scheduler.lastIssue?.code, "scheduler_error");
    assert.equal(scheduler.dispatchTimer, undefined);
    assert.equal(scheduler.timer, undefined);
    assert.equal(scheduler.pending, undefined);
    assert.equal(store.snapshot().messages.length, 1);
  } finally {
    scheduler.stop();
    store.close();
  }
});

for (const cancel of ["stop", "context"] as const)
  test(`a slow canceled request cannot block or release replacement work after ${cancel}`, async () => {
    const releases: Array<() => void> = [];
    const entered: Array<() => void> = [];
    const arrivals = [0, 1].map(
      (index) =>
        new Promise<void>((resolve) => {
          entered[index] = resolve;
        }),
    );
    const signals: AbortSignal[] = [];
    const inputs: ModelInput<Buffer>[] = [];
    let calls = 0;
    const { store, scheduler } = fixture(async (input, signal) => {
      const index = calls++,
        response = result(input);
      signals.push(signal);
      inputs.push(input);
      const held = new Promise<void>((resolve) => {
        releases[index] = resolve;
      });
      entered[index]?.();
      await held; // Simulates a transport that ignores cancellation.
      return response;
    });
    try {
      const old = scheduler.tick();
      await arrivals[0];
      if (cancel === "stop") {
        scheduler.stop();
        scheduler.state = "running";
      } else scheduler.invalidateChatContext();
      assert.equal(scheduler.busy, false);
      assert.equal(signals[0].aborted, true);
      assert.equal(inputs[0].messages.length, 0);
      store.ingestion.ingest([
        {
          ...original,
          sourceId: "replacement-source",
          text: "Replacement synthetic input",
        },
      ]);
      const replacement = scheduler.tick();
      await arrivals[1];
      assert.equal(scheduler.busy, true);
      releases[0]();
      await old;
      assert.equal(scheduler.busy, true);
      assert.equal(signals[1].aborted, false);
      assert.equal(scheduler.pending, undefined);
      await scheduler.tick();
      assert.equal(calls, 2);
      releases[1]();
      await replacement;
      assert.equal(scheduler.busy, false);
      assert(scheduler.pending);
      assert.equal(scheduler.state, "running");
    } finally {
      for (const release of releases) release();
      scheduler.stop();
      store.close();
    }
  });
