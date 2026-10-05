import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YoutubeAuth, youtubeScope } from "../packages/youtube-auth.ts";
import { YoutubeNotices, noticeParts } from "../packages/youtube-notices.ts";
import { Participation } from "../packages/participation.ts";
import { Store } from "../packages/storage.ts";
import { approvedProfile, privacyMessage } from "./privacy-fixtures.ts";
import { configSchema } from "../packages/config.ts";
import { createApp } from "../apps/server/app.ts";

function env(t: any) {
  for (const [key, value] of Object.entries({
    YOUTUBE_CLIENT_ID: "fixture-client",
    YOUTUBE_CLIENT_SECRET: "fixture-secret",
  })) {
    const old = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (old === undefined) delete process.env[key];
      else process.env[key] = old;
    });
  }
}
test("YouTube OAuth binds state/PKCE/redirect, requires sending scope, encrypts tokens and coalesces refresh", async (t) => {
  env(t);
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const dir = mkdtempSync(join(tmpdir(), "youtube-auth-")),
    path = join(dir, "token");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const forms: URLSearchParams[] = [];
  const request: typeof fetch = async (url, init) => {
    if (String(url).includes("/channels?"))
      return Response.json({ items: [{ id: "fixture" }] });
    const fields = new URLSearchParams(String(init?.body));
    forms.push(fields);
    return Response.json({
      access_token: "private-access",
      refresh_token: "private-refresh",
      token_type: "Bearer",
      expires_in: 3600,
      scope: youtubeScope,
    });
  };
  const auth = new YoutubeAuth("a".repeat(64), path, request);
  const login = new URL(
    auth.authorizationUrl("http://127.0.0.1:3210/oauth/youtube/callback"),
  );
  assert.equal(login.searchParams.get("scope"), youtubeScope);
  assert.equal(login.searchParams.get("code_challenge_method"), "S256");
  await assert.rejects(auth.callback("code", "wrong"));
  await auth.callback("code", login.searchParams.get("state")!);
  assert.equal(
    forms[0].get("redirect_uri"),
    login.searchParams.get("redirect_uri"),
  );
  assert(forms[0].get("code_verifier"));
  assert.equal(auth.channelId, "fixture");
  assert(!readFileSync(path).includes(Buffer.from("private-access")));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  await assert.rejects(auth.callback("code", login.searchParams.get("state")!));
  now += 3600000;
  await Promise.all([auth.access(), auth.access()]);
  assert.equal(forms.length, 2);
  assert.equal(forms[1].get("grant_type"), "refresh_token");
  const restored = new YoutubeAuth("a".repeat(64), path, request);
  assert.equal(restored.channelId, "fixture");
  restored.forget();
  assert.equal(restored.connected, false);
});

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
    assert.equal(
      String(url),
      "https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet",
    );
    assert.equal(init?.method, "POST");
    const b = JSON.parse(String(init?.body));
    sent.push(b);
    if (respond) return respond(url, init);
    return Response.json({
      id: `sent-${sent.length}`,
      snippet: { ...b.snippet, authorChannelId: "fixture" },
    });
  };
  const auth = { connected: true, channelId: "fixture", access } as YoutubeAuth;
  const sender = new YoutubeNotices(p, auth, request);
  sender.resolve("live-chat", "fixture");
  sender.connected = true;
  const tick = (ms = 31000) => (now += ms);
  const message = (text: string) =>
    store.ingestBatch([privacyMessage("viewer", text, ++now)]);
  const signal = new AbortController().signal;
  return { p, store, sender, auth, sent, tick, message, signal };
}
test("YouTube sends only fixed intro, confirms insert resource and never repeats on later ordinary chat", async (t) => {
  const f = fixture(t);
  f.message("PRIVATE_VIEWER_TEXT");
  await f.sender.tick(f.signal);
  const person = f.p.get("youtube", "fixture", "viewer")!;
  while (!person.introDelivered) {
    f.tick();
    await f.sender.tick(f.signal);
    assert(f.sent.length < 10);
  }
  assert.equal(person.state, "UNCONSENTED");
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
test("YouTube multi-part stages require every confirmed part and a later command", async (t) => {
  const f = fixture(t);
  f.message("!동의");
  const person = f.p.get("youtube", "fixture", "viewer")!;
  await f.sender.tick(f.signal);
  assert.equal(person.deliveredAt, null);
  f.message("!동의");
  assert.equal(person.stage, 0);
  for (let i = 0; person.deliveredAt === null && i < 20; i++) {
    f.tick();
    await f.sender.tick(f.signal);
  }
  assert.notEqual(person.deliveredAt, null);
  assert(f.sent.length > 1);
  assert(
    f.sent.every((b) => b.snippet.textMessageDetails.messageText.length <= 200),
  );
  f.message("!동의");
  assert.equal(person.stage, 1);
});
test("YouTube checks withdrawal after token refresh and suppresses late insertion acknowledgements", async (t) => {
  let refresh = () => {};
  const f = fixture(t, async () => {
    refresh();
    return "token";
  });
  f.message("hello");
  refresh = () => f.message("!철회");
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 0);
  assert.equal(f.p.get("youtube", "fixture", "viewer")!.state, "WITHDRAWN");
});
test("YouTube rejects mismatched sender, missing permission and ambiguous write success; retries obey limits", async (t) => {
  const f = fixture(t, undefined, async () =>
    Response.json({ id: "wrong", snippet: { liveChatId: "another-chat" } }),
  );
  f.message("hello");
  (f.auth as any).channelId = "other";
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 0);
  assert.equal(f.sender.state, "channel_mismatch");
  (f.auth as any).channelId = "fixture";
  f.p.profile.approvals.find((a) => a.platform === "youtube")!.fixedNotices =
    false;
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 0);
  f.p.profile.approvals.find((a) => a.platform === "youtube")!.fixedNotices =
    true;
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 1);
  assert.equal(f.p.get("youtube", "fixture", "viewer")!.introDelivered, false);
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 1);
});
test("long unbroken notice URLs are rejected instead of truncated", () => {
  assert.throws(
    () => noticeParts(`https://example.test/${"x".repeat(200)}`),
    /notice_too_long/,
  );
});
test("YouTube OAuth routes require admin initiation, validate public callback state and disallow manual delivery", async (t) => {
  env(t);
  t.mock.method(globalThis, "fetch", async (url: any) => {
    if (String(url) === "https://oauth2.googleapis.com/token")
      return Response.json({
        access_token: "fixture-access",
        refresh_token: "fixture-refresh",
        expires_in: 3600,
        token_type: "Bearer",
        scope: youtubeScope,
      });
    if (
      String(url) ===
      "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true"
    )
      return Response.json({ items: [{ id: "fixture" }] });
    throw Error("Unexpected fixture request");
  });
  const dir = mkdtempSync(join(tmpdir(), "youtube-routes-"));
  const app = await createApp(
    configSchema.parse({
      youtube: {
        enabled: true,
        redirectUri: "https://example.test/oauth/youtube/callback",
      },
      privacy: approvedProfile(),
    }),
    {
      startInputs: false,
      adminToken: "a".repeat(64),
      readerToken: "r".repeat(64),
      encryptionKey: "e".repeat(64),
      youtubeTokenPath: join(dir, "youtube"),
      chatgptTokenPath: join(dir, "chatgpt"),
      chzzkTokenPath: join(dir, "chzzk"),
      soopTokenPath: join(dir, "soop"),
    },
  );
  try {
    const headers = {
      host: "127.0.0.1:3210",
      authorization: `Bearer ${"a".repeat(64)}`,
    };
    assert.equal(
      (
        await app.app.inject({
          method: "POST",
          url: "/api/admin/youtube/authorize",
          headers: { host: headers.host },
        })
      ).statusCode,
      401,
    );
    const login = await app.app.inject({
      method: "POST",
      url: "/api/admin/youtube/authorize",
      headers,
    });
    assert.equal(login.statusCode, 200);
    assert.equal(
      new URL(login.json().url).searchParams.get("redirect_uri"),
      "https://example.test/oauth/youtube/callback",
    );
    const callback = await app.app.inject({
      url: "/oauth/youtube/callback?state=bad&code=private-code",
      headers: { host: "example.test" },
      remoteAddress: "203.0.113.10",
    });
    assert.equal(callback.statusCode, 400);
    assert(!callback.body.includes("private-code"));
    assert.match(
      String(callback.headers["content-type"]),
      /^text\/plain; charset=utf-8$/i,
    );
    assert(callback.body.includes("YouTube 연결 실패"));
    const success = await app.app.inject({
      url: `/oauth/youtube/callback?state=${encodeURIComponent(new URL(login.json().url).searchParams.get("state")!)}&code=fixture-code`,
      headers: { host: "example.test" },
      remoteAddress: "203.0.113.10",
    });
    assert.equal(success.statusCode, 200);
    assert.match(
      String(success.headers["content-type"]),
      /^text\/plain; charset=utf-8$/i,
    );
    assert(success.body.includes("YouTube 연결 완료"));
    assert(!success.body.includes("fixture-code"));
    const status = (
      await app.app.inject({ url: "/api/admin/status", headers })
    ).json();
    assert.equal(status.setup.youtube.connected, true);

    app.store.ingestBatch([privacyMessage("u", "hello", Date.now())]);
    const person = app.participation!.get("youtube", "fixture", "u")!;
    assert.equal(
      (
        await app.app.inject({
          method: "POST",
          url: `/api/admin/privacy/participants/${person.id}/notice-delivered`,
          headers,
          payload: { delivered: true },
        })
      ).statusCode,
      400,
    );
    app.store.ingestBatch([
      privacyMessage("u", "!동의", Date.now() + 1, { platform: "chzzk" }),
    ]);
    const chzzkPerson = app.participation!.get("chzzk", "fixture", "u")!;
    assert.equal(
      (
        await app.app.inject({
          method: "POST",
          url: `/api/admin/privacy/participants/${chzzkPerson.id}/notice-delivered`,
          headers,
          payload: { delivered: true },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.app.inject({
          method: "POST",
          url: "/api/admin/youtube/disconnect",
          headers,
        })
      ).statusCode,
      200,
    );
  } finally {
    await app.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const broadcasterTest of [false, true])
  test(`supervisor sends fixed notices and excludes echoes with broadcaster testing ${broadcasterTest}`, async (t) => {
    const { Supervisor } = await import("../packages/supervisor.ts");
    const p = new Participation(approvedProfile(), "session"),
      store = new Store(":memory:", p);
    const config = configSchema.parse({
      youtube: {
        enabled: true,
        video: "abcdefghijk",
        transport: "rest",
        allowBroadcasterTesting: broadcasterTest,
      },
      privacy: approvedProfile(),
    });
    let writes = 0,
      reads = 0;
    t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
      assert.equal(
        init.headers.Authorization ?? init.headers.authorization,
        "Bearer fixture-token",
      );
      if (String(url).includes("/videos?"))
        return Response.json({
          items: [
            {
              snippet: { channelId: "fixture" },
              liveStreamingDetails: { activeLiveChatId: "live-chat" },
            },
          ],
        });
      if (init.method === "POST") {
        writes++;
        const body = JSON.parse(init.body);
        assert(!JSON.stringify(body).includes("PRIVATE_VIEWER"));
        return Response.json({
          id: "sent",
          snippet: { ...body.snippet, authorChannelId: "fixture" },
        });
      }
      reads++;
      return Response.json({
        pollingIntervalMillis: 1000,
        nextPageToken: "cursor",
        items:
          reads === 1
            ? [
                {
                  id: "viewer-event",
                  snippet: {
                    type: "textMessageEvent",
                    publishedAt: new Date(Date.now() + 1).toISOString(),
                    displayMessage: "PRIVATE_VIEWER",
                  },
                  authorDetails: {
                    channelId: broadcasterTest ? "fixture" : "viewer",
                    displayName: "PRIVATE_NAME",
                  },
                },
                {
                  id: "self-event",
                  snippet: {
                    type: "textMessageEvent",
                    publishedAt: new Date().toISOString(),
                    displayMessage: "[안내 1/1] fixed bot notice",
                  },
                  authorDetails: {
                    channelId: "fixture",
                    displayName: "broadcaster",
                  },
                },
              ]
            : [],
      });
    });
    const auth = {
      connected: true,
      channelId: "fixture",
      access: async () => "fixture-token",
    } as YoutubeAuth;
    const supervisor = new Supervisor(config, store, {} as any, false, auth);
    try {
      supervisor.start();
      for (
        let n = 0;
        n < 300 &&
        !p.get("youtube", "fixture", broadcasterTest ? "fixture" : "viewer")
          ?.introDelivered;
        n++
      )
        await new Promise((r) => setTimeout(r, 10));
      assert.equal(writes, 1);
      assert.equal(
        p.get("youtube", "fixture", broadcasterTest ? "fixture" : "viewer")
          ?.introDelivered,
        true,
      );
      if (!broadcasterTest)
        assert.equal(p.get("youtube", "fixture", "fixture"), undefined);
      assert.equal(store.snapshot().messages.length, 0);
    } finally {
      await supervisor.stop();
      store.close();
    }
  });

test("YouTube rejects expired authorization and insufficient scope before saving credentials", async (t) => {
  env(t);
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const dir = mkdtempSync(join(tmpdir(), "youtube-denied-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  const auth = new YoutubeAuth("a".repeat(64), join(dir, "token"), async () => {
    calls++;
    return Response.json({
      access_token: "token",
      refresh_token: "refresh",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/youtube.readonly",
    });
  });
  let login = new URL(
    auth.authorizationUrl("http://127.0.0.1:3210/oauth/youtube/callback"),
  );
  now += 300001;
  await assert.rejects(auth.callback("code", login.searchParams.get("state")!));
  assert.equal(calls, 0);
  login = new URL(
    auth.authorizationUrl("http://127.0.0.1:3210/oauth/youtube/callback"),
  );
  await assert.rejects(
    auth.callback("code", login.searchParams.get("state")!),
    /permission/,
  );
  assert.equal(calls, 1);
  assert.equal(auth.connected, false);
});

test("YouTube withdrawal during an insertion discards the late acknowledgement", async (t) => {
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
      id: "sent",
      snippet: { ...body.snippet, authorChannelId: "fixture" },
    }),
  );
  await pending;
  assert.equal(f.p.get("youtube", "fixture", "viewer")!.deliveredAt, null);
  assert.equal(f.p.get("youtube", "fixture", "viewer")!.state, "WITHDRAWN");
});

test("YouTube forbidden/quota responses pause writes without acknowledging delivery", async (t) => {
  const f = fixture(t, undefined, async () =>
    Response.json({ error: { message: "not logged" } }, { status: 403 }),
  );
  f.message("hello");
  await f.sender.tick(f.signal);
  assert.equal(f.sender.state, "permission_or_quota_blocked");
  f.tick(60001);
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 1);
  assert.equal(f.p.get("youtube", "fixture", "viewer")!.introDelivered, false);
});

test("broadcaster test filter handles REST and gRPC messages and reserves all automatic notice parts", async () => {
  const { normalizeYoutube, ignoreYoutubeOwnMessage } =
    await import("../packages/youtube.ts");
  assert.equal(configSchema.parse({}).youtube.allowBroadcasterTesting, false);
  for (const text of [
    "hello",
    "!동의",
    "!철회",
    ...noticeParts("fixed notice ".repeat(50)),
  ]) {
    for (const item of [
      {
        id: "rest",
        snippet: { type: "textMessageEvent", displayMessage: text },
        authorDetails: { channelId: "fixture" },
      },
      {
        id: "grpc",
        snippet: { type: "TEXT_MESSAGE_EVENT", display_message: text },
        author_details: { channel_id: "fixture" },
      },
    ]) {
      const m = normalizeYoutube(item, "chat")!;
      assert(ignoreYoutubeOwnMessage(m, "fixture"));
      assert.equal(
        ignoreYoutubeOwnMessage(m, "fixture", true),
        text.startsWith("[안내 "),
      );
      assert(
        !ignoreYoutubeOwnMessage({ ...m, author: "viewer" }, "fixture", true),
      );
    }
  }
});

test("YouTube retains confirmed parts when receive state changes during an insertion", async (t) => {
  const f = fixture(t, undefined, async (_url, init) => {
    const b = JSON.parse(String(init?.body));
    // A normal receiver rollover can happen while the independent write finishes.
    f.sender.connected = false;
    return Response.json({
      id: `sent-${f.sent.length}`,
      snippet: { ...b.snippet, authorChannelId: "fixture" },
    });
  });
  f.message("!동의");
  const person = f.p.get("youtube", "fixture", "viewer")!;
  const parts: string[] = [];
  for (let n = 0; n < 20 && person.deliveredAt === null; n++) {
    f.sender.connected = true;
    await f.sender.tick(f.signal);
    parts.push(f.sent.at(-1)?.snippet.textMessageDetails.messageText);
    f.message("!동의"); // Only the command after final confirmed delivery may advance.
    if (person.stage === 1) break;
    assert.equal(person.stage, 0);
    f.tick();
  }
  assert.equal(person.stage, 1);
  assert.equal(new Set(parts).size, parts.length);
  assert(parts.length > 1);
  assert(parts[0].startsWith("[안내 1/"));
});

test("YouTube confirms an intro across receive rollover and does not send it again without new chat", async (t) => {
  const f = fixture(t, undefined, async (_url, init) => {
    const b = JSON.parse(String(init?.body));
    f.sender.connected = false;
    return Response.json({
      id: "sent",
      snippet: { ...b.snippet, authorChannelId: "fixture" },
    });
  });
  f.message("hello");
  await f.sender.tick(f.signal);
  assert.equal(f.p.get("youtube", "fixture", "viewer")!.introDelivered, true);
  for (let n = 0; n < 5; n++) {
    f.tick(60001);
    f.sender.connected = true;
    await f.sender.tick(f.signal);
  }
  assert.equal(f.sent.length, 1);
});

test("YouTube pauses during credential refresh disconnect without dropping partial progress", async (t) => {
  let disconnect = false;
  const f = fixture(t, async () => {
    if (disconnect) f.sender.connected = false;
    return "fixture-token";
  });
  f.message("!동의");
  await f.sender.tick(f.signal);
  f.tick();
  disconnect = true;
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 1);
  f.tick();
  disconnect = false;
  f.sender.connected = true;
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 2);
  assert(
    f.sent[1].snippet.textMessageDetails.messageText.startsWith("[안내 2/"),
  );
});

test("YouTube normal REST poll continuation does not disconnect notice delivery", async (t) => {
  const { runYoutube } = await import("../packages/youtube.ts");
  const f = fixture(t),
    controller = new AbortController();
  const states: string[] = [];
  let reads = 0;
  t.mock.method(globalThis, "fetch", async (url: any) => {
    if (String(url).includes("/videos?"))
      return Response.json({
        items: [
          {
            snippet: { channelId: "fixture" },
            liveStreamingDetails: { activeLiveChatId: "live-chat" },
          },
        ],
      });
    if (++reads === 2) controller.abort();
    return Response.json({
      items: [],
      nextPageToken: "next",
      pollingIntervalMillis: 1000,
    });
  });
  await runYoutube(
    { video: "abcdefghijk", transport: "rest", restFallback: true },
    f.store,
    controller.signal,
    (s) => states.push(s),
    { access: async () => "fixture-token" },
  );
  assert.equal(reads, 2);
  assert.deepEqual(states, ["connecting", "subscribed:rest", "stopped"]);
});
