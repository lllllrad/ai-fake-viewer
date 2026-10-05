import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatgptAuth } from "../packages/chatgpt-auth.ts";
import { chatgptModel, modelMessages } from "../packages/model.ts";
import { configSchema } from "../packages/config.ts";
import { profileIssues } from "../packages/privacy-profile.ts";
import { createApp } from "../apps/server/app.ts";
import { approvedProfile } from "./privacy-fixtures.ts";
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
function profile() {
  const p = approvedProfile();
  p.processing.provider = "chatgpt_subscription";
  p.processing.contract = "ChatGPT subscription";
  return p;
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
      privacy: profile(),
      ai: { provider: "chatgpt_subscription" },
    }),
    {
      startInputs: false,
      adminToken: "a".repeat(64),
      readerToken: "r".repeat(64),
      encryptionKey: "e".repeat(64),
      chatgptTokenPath: join(dir, "chatgpt"),
      youtubeTokenPath: join(dir, "youtube.tokens"),
      soopTokenPath: join(dir, "soop"),
      chzzkTokenPath: join(dir, "chzzk"),
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
test("subscription contract and endpoint cannot silently inherit the API-only profile", () => {
  const p = profile();
  assert.deepEqual(profileIssues(p), []);
  p.processing.contract = "API";
  assert(profileIssues(p).some((x) => x.includes("불일치")));
  p.processing.contract = "ChatGPT subscription";
  p.processing.endpoint = "https://eu.api.openai.com/v1";
  assert(profileIssues(p).some((x) => x.includes("endpoint")));
});
test("subscription rechecks consent after asynchronous token refresh and records request IDs", async () => {
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
    configSchema.parse({ ai: { provider: "chatgpt_subscription" } }).ai,
    auth,
    request,
    {
      authorize: () => {
        if (!allowed) throw Error("withdrawn");
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
    await assert.rejects(run(input, new AbortController().signal), /withdrawn/);
    assert.equal(calls, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
