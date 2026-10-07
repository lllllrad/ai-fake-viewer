import { approvedProfile } from "./privacy-fixtures.ts";
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
  test(`administrator status contract covers ${demo ? "synthetic" : "live"} setup without external inputs`, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "status-contract-"));
    const { app, store, supervisor, capture, transcriber } = await createApp(
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
      if (demo) {
        const headers = {
          host: "127.0.0.1:3210",
          authorization: `Bearer ${"a".repeat(64)}`,
        };
        const templates = await app.inject({
          url: "/api/admin/persona/templates",
          headers,
        });
        assert.equal(templates.statusCode, 200);
        assert.equal(templates.json().templates.length, 6);
        const command = {
          method: "POST" as const,
          url: "/api/admin/persona/sessions",
          headers,
          payload: {
            session_title: "Fixture",
            topic: "Fixture",
            audience_intent: "Observe",
            public_context: "",
            private_production_context: "",
            tone_policy: "Brief",
          },
        };
        assert.equal((await app.inject(command)).statusCode, 400);
        const authorized = {
          ...command,
          headers: { ...headers, "idempotency-key": "synthetic-command" },
        };
        const first = await app.inject(authorized),
          repeated = await app.inject(authorized);
        assert.equal(first.statusCode, 200);
        assert.equal(repeated.statusCode, 200);
        assert.equal(first.json().id, repeated.json().id);
      }
      if (!demo) {
        assert.equal(
          store.db.prepare("SELECT COUNT(*) n FROM persona_templates").get()?.n,
          0,
        );
        const headers = {
          host: "127.0.0.1:3210",
          authorization: `Bearer ${"a".repeat(64)}`,
        };
        assert.equal(
          (await app.inject({ url: "/api/admin/persona/templates", headers }))
            .statusCode,
          404,
        );
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/admin/persona/sessions",
              headers,
              payload: {},
            })
          ).statusCode,
          409,
        );
        assert.equal(
          store.db
            .prepare("SELECT COUNT(*) n FROM persona_operator_commands")
            .get()?.n,
          0,
        );
      }
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
      let speechReads = 0,
        frameReads = 0;
      const originalSpeech = transcriber.recent.bind(transcriber);
      const originalFrame = capture.latest.bind(capture);
      t.mock.method(transcriber, "recent", () => {
        speechReads++;
        return originalSpeech();
      });
      t.mock.method(capture, "latest", () => {
        frameReads++;
        return originalFrame();
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
      assert.equal(speechReads, 1);
      assert.equal(frameReads, 1);
      const status = adminStatusSchema.parse(response.json());
      assert.equal(status.demo, demo);
      for (const platform of ["youtube", "chzzk", "soop"] as const)
        assert.equal(status.setup[platform].receiveApproved, demo);
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
      for (const platform of ["youtube", "chzzk", "soop"] as const)
        assert.equal(endedStatus.setup[platform].receiveApproved, demo);
      assert.deepEqual(endedStatus.audio.history, []);
    } finally {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

test("next-session receive approval survives session end and checks a known broadcast identity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "preparation-status-"));
  const { app, broadcast, store } = await createApp(
    configSchema.parse({
      database: ":memory:",
      privacy: approvedProfile(),
      youtube: { channelId: "fixture" },
      soop: { streamerId: "different-account" },
    }),
    {
      startInputs: false,
      adminToken: "a".repeat(64),
      readerToken: "r".repeat(64),
      encryptionKey: "e".repeat(64),
      chatgptTokenPath: join(directory, "chatgpt"),
      youtubeTokenPath: join(directory, "youtube"),
      chzzkTokenPath: join(directory, "chzzk"),
      soopTokenPath: join(directory, "soop"),
    },
  );
  try {
    await broadcast.endBroadcast();
    assert.equal(store.participation!.available("youtube", "fixture"), false);
    const response = await app.inject({
      url: "/api/admin/status",
      headers: {
        host: "127.0.0.1:3210",
        authorization: `Bearer ${"a".repeat(64)}`,
      },
    });
    assert.equal(response.statusCode, 200);
    const status = adminStatusSchema.parse(response.json());
    assert.equal(status.closed, true);
    assert.equal(status.setup.youtube.receiveApproved, true);
    assert.equal(status.setup.chzzk.receiveApproved, true);
    assert.equal(status.setup.soop.receiveApproved, false);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
