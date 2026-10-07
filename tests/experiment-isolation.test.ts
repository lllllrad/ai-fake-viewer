import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/server/app.ts";
import { createExperimentApp } from "../apps/experiments/app.ts";
import {
  experimentSettingsSchema,
  loadExperimentEnvironment,
} from "../apps/experiments/settings.ts";
import { configSchema } from "../packages/config.ts";
import { AdministratorSessions } from "../packages/infrastructure/accounts/administrator-sessions.ts";

test("live and test apps have disjoint routes, credentials, cookies and lifetimes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "independent-tests-"));
  const live = await createApp(configSchema.parse({ database: ":memory:" }), {
    demo: true,
    startInputs: false,
    adminToken: "l".repeat(64),
    readerToken: "r".repeat(64),
    encryptionKey: "e".repeat(64),
    chatgptTokenPath: join(directory, "live-chatgpt"),
  });
  const testApp = await createExperimentApp(
    experimentSettingsSchema.parse({}),
    {
      directory: join(directory, "tests"),
      adminToken: "t".repeat(64),
      encryptionKey: "f".repeat(64),
    },
  );
  const liveHeaders = {
    host: "127.0.0.1:3210",
    authorization: `Bearer ${"l".repeat(64)}`,
  };
  const testHeaders = {
    host: "127.0.0.1:3211",
    authorization: `Bearer ${"t".repeat(64)}`,
  };
  try {
    assert.equal(
      (
        await live.app.inject({
          url: "/api/admin/experiments",
          headers: liveHeaders,
        })
      ).statusCode,
      404,
    );
    for (const [method, url] of [
      ["GET", "/api/admin/status"],
      ["POST", "/api/admin/ai/start"],
      ["GET", "/reader"],
      ["GET", "/overlay"],
      ["POST", "/api/admin/session/new"],
    ] as const)
      assert.equal(
        (await testApp.app.inject({ method, url, headers: testHeaders }))
          .statusCode,
        404,
        url,
      );
    const liveLogin = await live.app.inject({
      method: "POST",
      url: "/api/admin/login",
      headers: { host: liveHeaders.host },
      payload: { token: "l".repeat(64) },
    });
    const testLogin = await testApp.app.inject({
      method: "POST",
      url: "/api/admin/login",
      headers: { host: testHeaders.host },
      payload: { token: "t".repeat(64) },
    });
    const liveCookie = String(liveLogin.headers["set-cookie"]).split(";")[0];
    const testCookie = String(testLogin.headers["set-cookie"]).split(";")[0];
    assert.match(liveCookie, /^mixed_chat_admin=/);
    assert.match(testCookie, /^mixed_chat_experiments=/);
    assert.equal(
      (
        await testApp.app.inject({
          url: "/api/admin/session",
          headers: { host: testHeaders.host, cookie: liveCookie },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await live.app.inject({
          url: "/api/admin/status",
          headers: { host: liveHeaders.host, cookie: testCookie },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await testApp.app.inject({
          url: "/api/admin/session",
          headers: { ...testHeaders, authorization: liveHeaders.authorization },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await testApp.app.inject({
          url: "/api/admin/session",
          headers: { ...testHeaders, origin: "http://127.0.0.1:3210" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await testApp.app.inject({
          url: "/api/admin/session",
          headers: testHeaders,
          remoteAddress: "192.0.2.1",
        })
      ).statusCode,
      403,
    );
    const both = `${liveCookie}; ${testCookie}`;
    assert.equal(
      (
        await live.app.inject({
          url: "/api/admin/status",
          headers: { host: liveHeaders.host, cookie: both },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await testApp.app.inject({
          url: "/api/admin/session",
          headers: { host: testHeaders.host, cookie: both },
        })
      ).statusCode,
      200,
    );
    const session = (
      await testApp.app.inject({
        url: "/api/admin/experiments",
        method: "POST",
        headers: testHeaders,
        payload: { topic: "독립 테스트", provider: "fixture" },
      })
    ).json();
    assert.equal(session.personas.length, 6);
    const liveId = live.store.sessionId;
    await testApp.app.close();
    assert.equal(
      (await live.app.inject({ url: "/health", headers: liveHeaders }))
        .statusCode,
      200,
    );
    assert.equal(live.store.sessionId, liveId);
    assert.equal(live.store.snapshot().messages.length, 0);
    assert.equal(live.store.transcriptRows().length, 0);
    assert.equal(live.store.personaRuntime(), null);
    const restarted = await createExperimentApp(
      experimentSettingsSchema.parse({}),
      {
        directory: join(directory, "tests"),
        adminToken: "t".repeat(64),
        encryptionKey: "f".repeat(64),
      },
    );
    try {
      assert.equal(
        restarted.experiments.read(session.id).session.personas.length,
        6,
      );
      assert(restarted.experiments.read(session.id).session.endedAt);
      await live.app.close();
      assert.equal(
        (await restarted.app.inject({ url: "/health", headers: testHeaders }))
          .statusCode,
        200,
      );
    } finally {
      await restarted.app.close();
    }
  } finally {
    await testApp.app.close();
    await live.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("test environment ignores live provider variables and rejects broadcast configuration", () => {
  const directory = mkdtempSync(join(tmpdir(), "test-env-"));
  const keys = ["OPENAI_API_KEY", "OPENAI_MODEL", "GROQ_API_KEY"] as const;
  const before = keys.map((key) => process.env[key]);
  try {
    keys.forEach((key) => (process.env[key] = "live-fixture"));
    writeFileSync(
      join(directory, ".env"),
      `EXPERIMENT_ADMIN_TOKEN=${"t".repeat(64)}\nEXPERIMENT_ENCRYPTION_KEY=${"e".repeat(64)}\nGROQ_API_KEY=test-fixture\n`,
    );
    writeFileSync(
      join(directory, "config.json"),
      JSON.stringify({ audio: { provider: "groq", language: "ja" } }),
    );
    const settings = loadExperimentEnvironment(directory);
    assert.equal(settings.settings.port, 3211);
    assert.equal(settings.settings.audio.language, "ja");
    assert.equal(process.env.GROQ_API_KEY, "test-fixture");
    assert.equal(process.env.OPENAI_API_KEY, undefined);
    assert.equal(process.env.OPENAI_MODEL, undefined);
    assert(
      !experimentSettingsSchema.safeParse({ database: "live.sqlite" }).success,
    );
    assert(
      !experimentSettingsSchema.safeParse({ network: { bindHost: "0.0.0.0" } })
        .success,
    );
  } finally {
    keys.forEach((key, i) => {
      if (before[i] === undefined) delete process.env[key];
      else process.env[key] = before[i];
    });
    rmSync(directory, { recursive: true, force: true });
  }
});

test("test logout cannot clear the live browser cookie", () => {
  const live = new AdministratorSessions("l".repeat(64));
  const tests = new AdministratorSessions(
    "t".repeat(64),
    Date.now,
    "mixed_chat_experiments",
  );
  assert.match(tests.clearCookie(), /^mixed_chat_experiments=/);
  assert(live.authenticateCookie(live.issueCookie()));
  assert(!tests.authenticateCookie(live.issueCookie()));
});
