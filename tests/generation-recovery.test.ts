import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GenerationRecovery,
  type GenerationIssue,
} from "../packages/application/reactions/recovery.ts";
import { Scheduler } from "../packages/infrastructure/reactions/scheduler.ts";
import { Store } from "../packages/storage.ts";
import { Capture } from "../packages/infrastructure/inputs/screen-input.ts";
import { configSchema } from "../packages/config.ts";
import type { Transcriber } from "../packages/infrastructure/inputs/speech-input.ts";
const transient: GenerationIssue = {
  code: "temporary_request_failure",
  message: "Fixture transient issue",
  retryable: true,
  transient: true,
};
test("three consecutive transient failures stop and report the last failure time", () => {
  const recovery = new GenerationRecovery();
  assert.equal(recovery.failed(transient, 1), undefined);
  assert.equal(recovery.failed(transient, 2), undefined);
  assert.equal(recovery.failed(transient, 3), "model_error");
  assert.equal(recovery.lastIssue?.continuing, false);
  assert.equal(recovery.lastIssue?.at, 3);
  assert.match(recovery.lastIssue!.message, /3회 연속/);
});
for (const reset of ["success", "validation", "stale_context"] as const)
  test(`${reset} breaks the consecutive transient failure streak`, () => {
    const recovery = new GenerationRecovery();
    recovery.failed(transient, 1);
    recovery.failed(transient, 2);
    if (reset === "success") recovery.success();
    else
      assert.equal(
        recovery.failed({ ...transient, code: reset, transient: false }, 3),
        undefined,
      );
    assert.equal(recovery.failed(transient, 4), undefined);
    assert.equal(recovery.failed(transient, 5), undefined);
    assert.equal(recovery.failed(transient, 6), "model_error");
  });
test("budget and permanent failures stop immediately and preserve their own explanation", () => {
  for (const code of ["budget_exhausted", "input_token_limit"]) {
    const recovery = new GenerationRecovery();
    const issue = {
      code,
      message: "Fixture permanent issue",
      retryable: false,
      transient: false,
    };
    assert.equal(
      recovery.failed(issue, 1),
      code === "budget_exhausted" ? code : "model_error",
    );
    assert.equal(recovery.lastIssue?.message, issue.message);
    assert.equal(recovery.lastIssue?.continuing, false);
    recovery.success();
    assert.equal(recovery.lastIssue, undefined);
  }
});
for (const separatingResult of [
  "validation",
  "inspection_unavailable",
] as const)
  test(`scheduler resets the connection-failure streak after ${separatingResult}`, async (t) => {
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    const config = configSchema.parse({
      ai: {
        visualMode: "on_request",
        pacing: { minSeconds: 20, maxSeconds: 20 },
      },
    });
    const store = new Store(":memory:");
    let turn = 0;
    const transcriber = {
      recent: () => [
        { id: `speech-${turn}`, capturedAt: now, text: "Synthetic speech" },
      ],
      has: () => true,
    } as unknown as Transcriber;
    const scheduler = new Scheduler(
      store,
      new Capture(config.capture, false),
      config,
      async () => {
        if (turn === 2) {
          if (separatingResult === "validation") throw Error("Invalid output");
          return {
            decision: {
              action: "inspect" as const,
              text: null,
              replyToMessageId: null,
              evidenceFrameIds: [],
              evidenceMessageIds: [],
              evidenceTranscriptIds: [],
            },
          };
        }
        throw TypeError("fetch failed");
      },
      false,
      () => true,
      transcriber,
    );
    scheduler.state = "running";
    try {
      for (turn = 0; turn < 6; turn++) {
        now += 40000;
        await scheduler.tick(now);
        assert.equal(scheduler.state, turn === 5 ? "model_error" : "running");
        if (turn === 2 && separatingResult === "inspection_unavailable")
          assert.equal(scheduler.lastIssue, undefined);
        else assert.equal(scheduler.lastIssue?.continuing, turn !== 5);
      }
    } finally {
      scheduler.stop();
      store.close();
    }
  });
