import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../packages/config.ts";
import { createApp } from "../apps/server/app.ts";

test("broadcast end turns off AI and clears its restart intent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pipeline-end-"));
  const { app, store, scheduler, supervisor } = await createApp(
    configSchema.parse({
      database: ":memory:",
      ai: { visualMode: "on_request" },
    }),
    {
      demo: true,
      startInputs: false,
      adminToken: "a".repeat(64),
      readerToken: "r".repeat(64),
      encryptionKey: "e".repeat(64),
      chatgptTokenPath: join(directory, "chatgpt.tokens"),
      chzzkTokenPath: join(directory, "chzzk.tokens"),
      soopTokenPath: join(directory, "soop.tokens"),
    },
  );
  try {
    scheduler.state = "running";
    store.setAiDesiredRunning(true);
    supervisor.status("youtube", "ended");
    assert.equal(scheduler.state, "broadcast_ended");
    assert.equal(store.aiDesiredRunning(), false);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
