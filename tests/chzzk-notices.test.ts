import { test } from "node:test";
import assert from "node:assert/strict";
import { ChzzkNotices } from "../packages/chzzk-notices.ts";
import { noticeParts } from "../packages/youtube-notices.ts";
import type { ChzzkAuth } from "../packages/chzzk.ts";
import { Participation } from "../packages/infrastructure/participation/runtime.ts";
import { Store } from "../packages/storage.ts";
import { approvedProfile, privacyMessage } from "./privacy-fixtures.ts";
function fixture(
  t: any,
  access: () => Promise<string> = async () => "fixture-token",
  respond?: typeof fetch,
) {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const p = new Participation(approvedProfile(), "session"),
    store = new Store(":memory:", p);
  t.after(() => store.close());
  const sent: any[] = [];
  const request: typeof fetch = async (url, init) => {
    if (String(url).endsWith("/users/me"))
      return Response.json({
        code: 200,
        content: { channelId: auth.channelId },
      });
    assert.equal(
      String(url),
      "https://openapi.chzzk.naver.com/open/v1/chats/send",
    );
    assert.equal(init?.method, "POST");
    const b = JSON.parse(String(init?.body));
    sent.push(b);
    if (respond) return respond(url, init);
    return Response.json({
      code: 200,
      content: { messageId: `sent-${sent.length}` },
    });
  };
  const auth = {
    token: { accessToken: "fixture-token" },
    channelId: "fixture",
    access,
  } as unknown as ChzzkAuth & { channelId: string };
  const sender = new ChzzkNotices(p, auth, request);
  sender.resolve("live-chat", "fixture");
  sender.connected = true;
  const tick = (ms = 31000) => (now += ms);
  const message = (text: string) =>
    store.ingestBatch([
      privacyMessage("viewer", text, ++now, { platform: "chzzk" }),
    ]);
  const signal = new AbortController().signal;
  return { p, store, sender, auth, sent, tick, message, signal };
}
test("CHZZK sends only fixed intro, confirms insert resource and never repeats on later ordinary chat", async (t) => {
  const f = fixture(t);
  f.message("PRIVATE_VIEWER_TEXT");
  await f.sender.tick(f.signal);
  const person = f.p.get("chzzk", "fixture", "viewer")!;
  while (!person.introDelivered) {
    f.tick();
    await f.sender.tick(f.signal);
    assert(f.sent.length < 10);
  }
  assert.equal(person.state, "WAITING_CONSENT");
  assert(!JSON.stringify(f.sent).includes("PRIVATE_VIEWER_TEXT"));
  const count = f.sent.length;
  f.tick(600001);
  f.message("again");
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, count);
  f.sender.resolve("live-chat", "fixture");
  f.sender.connected = true;
  f.tick(600001);
  f.message("after reconnect");
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, count);
});
test("CHZZK single notice requires confirmed delivery and a later command", async (t) => {
  const f = fixture(t);
  f.message("!동의");
  const person = f.p.get("chzzk", "fixture", "viewer")!;
  assert.equal(person.deliveredAt, null);
  f.message("!동의");
  assert.equal(person.stage, 0);
  await f.sender.tick(f.signal);
  assert.notEqual(person.deliveredAt, null);
  assert.equal(f.sent.length, 1);
  assert(f.sent.every((b) => b.message.length <= 100));
  f.message("!동의");
  assert.equal(person.stage, 1);
});
test("CHZZK checks withdrawal after token refresh and suppresses late insertion acknowledgements", async (t) => {
  let refresh = () => {};
  const f = fixture(t, async () => {
    refresh();
    return "token";
  });
  f.message("hello");
  refresh = () => f.message("!철회");
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 0);
  assert.equal(f.p.get("chzzk", "fixture", "viewer")!.state, "WITHDRAWN");
});
test("CHZZK rejects mismatched sender, missing permission and ambiguous write success; retries obey limits", async (t) => {
  const f = fixture(t, undefined, async () =>
    Response.json({ code: 200, content: {} }),
  );
  f.message("hello");
  (f.auth as any).channelId = "other";
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 0);
  assert.equal(f.sender.state, "channel_mismatch");
  (f.auth as any).channelId = "fixture";
  f.tick(300001);
  f.p.profile.approvals.find((a) => a.platform === "chzzk")!.fixedNotices =
    false;
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 0);
  f.p.profile.approvals.find((a) => a.platform === "chzzk")!.fixedNotices =
    true;
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 1);
  assert.equal(f.p.get("chzzk", "fixture", "viewer")!.introDelivered, false);
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 1);
});
test("long unbroken notice URLs are rejected instead of truncated", () => {
  assert.throws(
    () => noticeParts(`https://example.test/${"x".repeat(200)}`),
    /notice_too_long/,
  );
});
test("CHZZK withdrawal during an insertion discards the late acknowledgement", async (t) => {
  let complete!: (r: Response) => void;
  const f = fixture(
    t,
    undefined,
    async () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  f.message("!동의");
  const pending = f.sender.tick(f.signal);
  await new Promise((resolve) => setImmediate(resolve));
  const body = f.sent[0];
  assert(body);
  f.message("!철회");
  complete(
    Response.json({
      code: 200,
      content: { messageId: "sent" },
    }),
  );
  await pending;
  assert.equal(f.p.get("chzzk", "fixture", "viewer")!.deliveredAt, null);
  assert.equal(f.p.get("chzzk", "fixture", "viewer")!.state, "WITHDRAWN");
});

test("CHZZK forbidden/quota responses pause writes without acknowledging delivery", async (t) => {
  const f = fixture(t, undefined, async () =>
    Response.json({ error: { message: "not logged" } }, { status: 403 }),
  );
  f.message("hello");
  await f.sender.tick(f.signal);
  assert.equal(f.sender.state, "permission_or_quota_blocked");
  f.tick(60001);
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 1);
  assert.equal(f.p.get("chzzk", "fixture", "viewer")!.introDelivered, false);
});

test("CHZZK stops stale jobs on reset and abort", async (t) => {
  const f = fixture(t);
  f.message("!동의");
  const abort = new AbortController();
  abort.abort();
  await f.sender.tick(abort.signal);
  assert.equal(f.sent.length, 0);
  f.sender.reset();
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 0);
  f.sender.resolve("fixture", "fixture");
  f.sender.connected = true;
  f.auth.access = async () => {
    f.sender.reset();
    return "token";
  };
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 0);
});

test("CHZZK supervisor wires subscription to automatic notices and excludes own-channel messages", async (t) => {
  const { EventEmitter } = await import("node:events");
  const { Supervisor } = await import("../packages/supervisor.ts");
  const { configSchema } = await import("../packages/config.ts");
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const p = new Participation(approvedProfile(), "session");
  const store = new Store(":memory:", p);
  const child = new EventEmitter() as any;
  child.kill = () => child.emit("exit", 0);
  child.send = () =>
    setImmediate(() =>
      child.emit("message", {
        type: "SYSTEM",
        data: { type: "connected", data: { sessionKey: "fixture-key" } },
      }),
    );
  const auth = {
    token: { accessToken: "token" },
    access: async () => "token",
    api: async (path: string) => {
      if (path === "/open/v1/sessions/auth")
        return { url: "https://fixture.nchat.naver.com/socket" };
      if (path.includes("/subscribe/"))
        setImmediate(() => {
          child.emit("message", {
            type: "SYSTEM",
            data: {
              type: "subscribed",
              data: { eventType: "CHAT", channelId: "fixture" },
            },
          });
          for (const author of ["viewer", "fixture"])
            child.emit("message", {
              type: "CHAT",
              data: {
                channelId: "fixture",
                senderChannelId: author,
                profile: { nickname: "PRIVATE_NAME" },
                content: "PRIVATE_TEXT",
                messageTime: ++now,
              },
            });
        });
      return {};
    },
  } as unknown as ChzzkAuth;
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    assert.equal(init.headers.authorization, "Bearer token");
    if (String(url).endsWith("/users/me"))
      return Response.json({ code: 200, content: { channelId: "fixture" } });
    assert.equal(
      String(url),
      "https://openapi.chzzk.naver.com/open/v1/chats/send",
    );
    const body = JSON.parse(init.body);
    assert(body.message.length <= 100);
    assert(!body.message.includes("PRIVATE_"));
    writes++;
    now += 31000;
    return Response.json({
      code: 200,
      content: { messageId: `sent-${writes}` },
    });
  });
  const supervisor = new Supervisor(
    configSchema.parse({
      chzzk: { enabled: true },
      privacy: approvedProfile(),
    }),
    store,
    auth,
  );
  t.mock.method(supervisor, "worker", () => child);
  try {
    supervisor.start();
    for (
      let i = 0;
      i < 500 && !p.get("chzzk", "fixture", "viewer")?.introDelivered;
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(p.get("chzzk", "fixture", "viewer")?.introDelivered, true);
    assert.equal(writes, 1);
    assert.equal(p.get("chzzk", "fixture", "fixture"), undefined);
    assert.equal(store.snapshot().messages.length, 0);
    await supervisor.stopPlatform("chzzk");
    assert.equal(supervisor.chzzkNotices?.connected, false);
  } finally {
    await supervisor.stop();
    store.close();
  }
});

test("CHZZK rejects credentials replaced while channel identity lookup is pending", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const p = new Participation(approvedProfile(), "session");
  const store = new Store(":memory:", p);
  t.after(() => store.close());
  const auth = {
    token: { accessToken: "first" },
    access: async () => "first",
  } as unknown as ChzzkAuth;
  let writes = 0;
  const sender = new ChzzkNotices(p, auth, async (url) => {
    if (String(url).endsWith("/users/me")) {
      auth.token = {
        accessToken: "replacement",
        refreshToken: "refresh",
        expiresAt: now + 100000,
      };
      return Response.json({ code: 200, content: { channelId: "fixture" } });
    }
    writes++;
    return Response.json({ code: 200, content: { messageId: "sent" } });
  });
  sender.resolve("fixture", "fixture");
  sender.connected = true;
  store.ingestBatch([
    privacyMessage("viewer", "hello", ++now, { platform: "chzzk" }),
  ]);
  await sender.tick(new AbortController().signal);
  assert.equal(writes, 0);
  assert.equal(p.get("chzzk", "fixture", "viewer")!.introDelivered, false);
});

test("CHZZK send throttling identifies the Chat API instead of identity lookup", async (t) => {
  const f = fixture(
    t,
    undefined,
    async () => new Response("", { status: 429 }),
  );
  f.message("hello");
  await f.sender.tick(f.signal);
  assert.equal(f.sender.state, "quota_blocked");
  assert.equal(f.sender.failure?.operation, "send");
  assert.equal(f.p.get("chzzk", "fixture", "viewer")!.introDelivered, false);
});
