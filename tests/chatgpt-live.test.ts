import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatgptAuth } from "../packages/infrastructure/accounts/chatgpt-auth.ts";
import { chatgptModel } from "../packages/infrastructure/reactions/chatgpt-model.ts";
import { modelMessages } from "../packages/infrastructure/reactions/model-messages.ts";
import { configSchema } from "../packages/config.ts";
import { createApp } from "../apps/server/app.ts";
function authFixture(path: string) {
  const auth: any = new ChatgptAuth("e".repeat(64), path);
  auth.data.active = "fixture";
  auth.data.accounts = [
    {
      clientId: "fixture",
      subject: "synthetic",
      email: null,
      accessToken: "fixture-access",
      refreshToken: "fixture-refresh",
      idToken: null,
      expiresAt: Date.now() + 3600000,
      earliestRefreshAt: 0,
      scopes: ["chatgpt.tokens.use.direct"],
      model: "fixture-model",
    },
  ];
  auth.save();
  return auth;
}
test("live ChatGPT subscription is ready and can start without OPENAI_API_KEY or OPENAI_MODEL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subscription-live-"));
  const key = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_MODEL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  authFixture(join(dir, "chatgpt"));
  const env = await createApp(
    configSchema.parse({
      input: { streamUrl: "rtmp://127.0.0.1/fixture" },
      database: ":memory:",
      ai: { provider: "chatgpt_subscription", visualMode: "on_request" },
    }),
    {
      startInputs: false,
      adminToken: "a".repeat(64),
      readerToken: "r".repeat(64),
      encryptionKey: "e".repeat(64),
      chatgptTokenPath: join(dir, "chatgpt"),
    },
  );
  const headers = {
    host: "127.0.0.1:3210",
    authorization: `Bearer ${"a".repeat(64)}`,
  };
  try {
    const status = (
      await env.app.inject({ url: "/api/admin/status", headers })
    ).json();
    assert.equal(status.ai.readiness.ready, true);
    assert.equal(status.ai.provider, "chatgpt_subscription");
    const login = await env.app.inject({
      method: "POST",
      url: "/api/admin/chatgpt/authorize",
      headers,
      payload: {},
    });
    assert.equal(login.statusCode, 200);
    assert.equal(new URL(login.json().url).hostname, "auth.openai.com");
    assert.equal(
      (
        await env.app.inject({
          method: "POST",
          url: "/api/admin/ai/start",
          headers,
        })
      ).statusCode,
      200,
    );
  } finally {
    await env.app.close();
    rmSync(dir, { recursive: true, force: true });
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
    if (model === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = model;
  }
});
test("subscription rechecks context after asynchronous token refresh and records request IDs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subscription-boundary-"));
  const auth = authFixture(join(dir, "tokens"));
  const input: any = {
    frames: [],
    messages: [],
    persona: { name: "synthetic", style: "brief" },
    description: "fixture",
  };
  let allowed = true,
    calls = 0;
  const ids: string[] = [];
  const decision = {
    action: "skip",
    text: null,
    replyToMessageId: null,
    evidenceFrameIds: [],
    evidenceMessageIds: [],
  };
  const request = (async (url: any, init: any) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    calls++;
    const body = JSON.parse(init.body);
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.equal(body.previous_response_id, undefined);
    assert.equal(body.model, "fixture-model");
    assert.deepEqual(body.input, modelMessages(input));
    for (const key of [
      "tools",
      "conversation",
      "background",
      "max_output_tokens",
      "metadata",
    ])
      assert.equal(body[key], undefined);
    return new Response(
      `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(decision) }] }], usage: { input_tokens: 2, output_tokens: 2 } } })}\n\n`,
      { headers: { "x-request-id": "synthetic-request" } },
    );
  }) as typeof fetch;
  const run = chatgptModel(
    configSchema.parse({
      input: { streamUrl: "rtmp://127.0.0.1/fixture" },
      database: ":memory:",
      ai: { provider: "chatgpt_subscription" },
    }).ai,
    auth,
    request,
    {
      authorize: () => {
        if (!allowed) throw Error("context invalidated");
      },
      requestId: (id) => ids.push(id),
    },
  );
  try {
    await run(input, new AbortController().signal);
    assert.equal(calls, 1);
    assert.deepEqual(ids, ["synthetic-request"]);
    auth.access = async () => {
      allowed = false;
      return "synthetic-token";
    };
    await assert.rejects(
      run(input, new AbortController().signal),
      /context invalidated/,
    );
    assert.equal(calls, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
