import { test } from "node:test";
import assert from "node:assert/strict";
import { apiIssues } from "../packages/api-health.ts";
import { googleJson, UpstreamError } from "../packages/youtube.ts";
import { Transcriber } from "../packages/transcription.ts";
import { configSchema } from "../packages/config.ts";
import { ChzzkNotices } from "../packages/chzzk-notices.ts";
import { Participation } from "../packages/participation.ts";
import { approvedProfile, privacyMessage } from "./privacy-fixtures.ts";
const base = {
  youtubeRead: { state: "subscribed" },
  youtubeSend: { state: "ready" },
  chzzkSend: { state: "ready" },
  audioState: "receiving",
  modelState: "running",
};
test("quota status distinguishes receipt, sending, dependency waits, and local budgets", () => {
  const receipt = apiIssues({
    ...base,
    youtubeRead: { state: "quota_blocked", api: "YouTube search.list" },
    youtubeSend: { state: "waiting_connection" },
  });
  assert.equal(receipt.length, 1);
  assert.equal(receipt[0].operation, "조회·수신");
  assert.match(receipt[0].message, /전송 API 자체.*확인되지/);
  const sending = apiIssues({
    ...base,
    youtubeSend: {
      state: "quota_blocked",
      failure: {
        api: "YouTube liveChatMessages.insert",
        operation: "send",
        state: "quota_blocked",
      },
    },
  });
  assert.equal(sending.length, 1);
  assert.equal(sending[0].operation, "채팅 전송");
  const both = apiIssues({
    ...base,
    youtubeRead: { state: "quota_blocked" },
    youtubeSend: { state: "quota_blocked" },
  });
  assert.equal(both.length, 2);
  const local = apiIssues({
    ...base,
    audioState: "budget_exhausted",
    modelState: "budget_exhausted",
  });
  assert.equal(local.length, 2);
  assert.match(local[0].message, /audio.maxRequests/);
  assert.match(local[1].api, /Responses API/);
  const identity = apiIssues({
    ...base,
    chzzkSend: {
      state: "quota_blocked",
      failure: {
        api: "CHZZK User API / users/me",
        operation: "identity",
        state: "quota_blocked",
      },
    },
  });
  assert.equal(identity[0].operation, "발송 계정 조회");
  assert.deepEqual(apiIssues(base), []);
});
test("YouTube lookup quota identifies the failing method without credentials", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { error: { errors: [{ reason: "quotaExceeded" }] } },
      { status: 403 },
    ),
  );
  await assert.rejects(
    googleJson(
      "search",
      { channelId: "fixture" },
      new AbortController().signal,
      async () => "SECRET",
    ),
    (e: any) => {
      assert(e instanceof UpstreamError);
      assert.equal(e.state, "quota_blocked");
      assert.equal(e.api, "YouTube search.list");
      assert(!JSON.stringify(e).includes("SECRET"));
      return true;
    },
  );
});
test("CHZZK identity quota is not labeled as a send failure", async () => {
  const p = new Participation(approvedProfile(), "fixture");
  p.handle(
    privacyMessage("viewer", "hello", Date.now(), { platform: "chzzk" }),
  );
  let calls = 0;
  const sender = new ChzzkNotices(
    p,
    { token: {}, access: async () => "fixture" } as any,
    async (url) => {
      calls++;
      assert(String(url).endsWith("/users/me"));
      return new Response("", { status: 429 });
    },
  );
  sender.resolve("chat", "fixture");
  sender.connected = true;
  await sender.tick(new AbortController().signal);
  assert.equal(calls, 1);
  assert.equal(sender.state, "quota_blocked");
  assert.equal(sender.failure?.operation, "identity");
  assert.equal(p.get("chzzk", "fixture", "viewer")?.introDelivered, false);
});
test("Groq provider quota is separate from the app transcription call cap", async (t) => {
  const prior = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "fixture";
  t.after(() => {
    if (prior === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = prior;
  });
  const tr = new Transcriber(
    configSchema.parse({}).audio,
    async () => new Response("", { status: 429 }),
  );
  tr.state = "receiving";
  await tr.transcribe(Buffer.alloc(320));
  assert.equal(tr.state, "quota_blocked");
  assert.equal(tr.requests, 1);
  tr.stop();
});

test("CHZZK session API rate limit retains method scope without its private query", async () => {
  const { ChzzkAuth } = await import("../packages/chzzk.ts");
  const { randomUUID } = await import("node:crypto");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const auth = new ChzzkAuth(
    "a".repeat(64),
    join(tmpdir(), randomUUID()),
    async () => new Response("", { status: 429 }),
  );
  auth.token = {
    accessToken: "SECRET",
    refreshToken: "SECRET",
    expiresAt: Date.now() + 3600000,
  };
  await assert.rejects(
    auth.api(
      "/open/v1/sessions/events/subscribe/chat?sessionKey=SECRET",
      "POST",
    ),
    (e: any) => {
      assert.equal(e.message, "quota_blocked");
      assert.match(e.api, /subscribe\/chat$/);
      assert(!JSON.stringify(e).includes("SECRET"));
      return true;
    },
  );
});
