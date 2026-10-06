import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../packages/config.ts";
import { createApp } from "../apps/server/app.ts";
import { adminStatusSchema } from "../packages/contracts/admin-status.ts";
import { projectAdminStatus } from "../packages/application/status/projection.ts";

for (const demo of [false, true])
  test(`administrator status contract covers ${demo ? "synthetic" : "live"} setup without external inputs`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "status-contract-"));
    const { app, store, supervisor } = await createApp(
      configSchema.parse({
        database: ":memory:",
        privacy: { rightsDatabase: ":memory:" },
      }),
      {
        demo,
        startInputs: false,
        adminToken: "a".repeat(64),
        readerToken: "r".repeat(64),
        encryptionKey: "e".repeat(64),
        chatgptTokenPath: join(directory, "chatgpt.tokens"),
        youtubeTokenPath: join(directory, "youtube.tokens"),
        chzzkTokenPath: join(directory, "chzzk.tokens"),
        soopTokenPath: join(directory, "soop.tokens"),
      },
    );
    try {
      store.recordTranscript({
        id: "synthetic-1",
        capturedAt: 1000,
        text: "Synthetic earlier speech",
      });
      store.recordTranscript({
        id: "synthetic-2",
        capturedAt: 2000,
        text: "Synthetic latest speech",
      });
      Object.assign(supervisor.states.youtube!, {
        unapprovedField: "SYNTHETIC_PRIVATE_VALUE",
      });
      const response = await app.inject({
        method: "GET",
        url: "/api/admin/status",
        headers: {
          host: "127.0.0.1:3210",
          authorization: `Bearer ${"a".repeat(64)}`,
        },
      });
      assert.equal(response.statusCode, 200);
      const status = adminStatusSchema.parse(response.json());
      assert.equal(status.demo, demo);
      assert.equal(status.sessionId, store.sessionId);
      assert.equal(status.setup.youtube.channelId, null);
      assert.deepEqual(
        status.audio.history.map((entry) => entry.id),
        ["synthetic-2", "synthetic-1"],
      );
      assert(!response.body.includes("SYNTHETIC_PRIVATE_VALUE"));
      const stripped = adminStatusSchema.parse({
        ...status,
        secret: "SYNTHETIC_SECRET",
        chatgpt: { ...status.chatgpt, refreshToken: "SYNTHETIC_SECRET" },
      });
      assert(!JSON.stringify(stripped).includes("SYNTHETIC_SECRET"));
      for (const invalid of [
        { ...status, audio: undefined },
        {
          ...status,
          ai: { ...status.ai, usage: { ...status.ai.usage, calls: "0" } },
        },
        { ...status, generatedAt: Infinity },
      ])
        assert.equal(adminStatusSchema.safeParse(invalid).success, false);
      const closed = projectAdminStatus({
        ...status,
        closed: true,
        personas: [
          {
            id: "fixture",
            name: "Synthetic",
            motive: "Observe",
            participation: "Occasional",
          },
        ],
        ai: {
          ...status.ai,
          pending: { text: "Synthetic draft", expires: 3000 },
        },
      });
      assert.deepEqual(closed.messages, []);
      assert.deepEqual(closed.personas, []);
      assert.equal(closed.ai.pending, null);
      assert.deepEqual(closed.audio.history, []);
      assert.equal(closed.audio.latestText, null);
      assert.equal(closed.chatSummary.state, "insufficient_data");
      assert.equal(status.audio.history.length, 2); // Projection must not mutate its input.
      store.closeSession();
      const ended = await app.inject({
        method: "GET",
        url: "/api/admin/status",
        headers: {
          host: "127.0.0.1:3210",
          authorization: `Bearer ${"a".repeat(64)}`,
        },
      });
      assert.equal(ended.statusCode, 200);
      const endedStatus = adminStatusSchema.parse(ended.json());
      assert.equal(endedStatus.closed, true);
      assert.deepEqual(endedStatus.audio.history, []);
    } finally {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
