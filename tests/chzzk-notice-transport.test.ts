import { test } from "node:test";
import assert from "node:assert/strict";
import { ChzzkNoticeTransport } from "../packages/infrastructure/platforms/chzzk-notice-transport.ts";
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture() {
  const account: { token: object | undefined; access(): Promise<string> } = {
    token: {},
    access: async () => "token",
  };
  const controller = new AbortController();
  let valid = true;
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  let respond = async (url: string) =>
    Response.json(
      url.endsWith("users/me")
        ? { code: 200, content: { channelId: "channel" } }
        : { code: 200, content: { messageId: "sent" } },
    );
  const transport = new ChzzkNoticeTransport(account, async (url, init) => {
    calls.push({ url: String(url), init });
    return respond(String(url));
  });
  const send = () =>
    transport.send(
      { broadcaster: "channel", text: "fixed notice" },
      controller.signal,
      { valid: () => valid, sending: () => {} },
    );
  return {
    account,
    controller,
    calls,
    send,
    invalidate: () => {
      valid = false;
    },
    respond: (fn: typeof respond) => {
      respond = fn;
    },
  };
}

test("CHZZK notice transport verifies identity then inserts exactly one fixed message", async () => {
  const f = fixture();
  const result = await f.send();
  assert.equal(result.status, "delivered");
  assert.equal(result.current(), true);
  assert.deepEqual(
    f.calls.map((c) => c.url),
    [
      "https://openapi.chzzk.naver.com/open/v1/users/me",
      "https://openapi.chzzk.naver.com/open/v1/chats/send",
    ],
  );
  assert.equal(f.calls[1].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(f.calls[1].init?.body)), {
    message: "fixed notice",
  });
});

test("CHZZK consent invalidation during token refresh prevents all HTTP requests", async () => {
  const f = fixture(),
    pending = deferred<string>();
  f.account.access = () => pending.promise;
  const sending = f.send();
  f.invalidate();
  pending.resolve("token");
  assert.equal((await sending).status, "stale");
  assert.equal(f.calls.length, 0);
});

test("CHZZK credential replacement while identity lookup is pending prevents insertion", async () => {
  const f = fixture(),
    pending = deferred<Response>();
  f.respond(() => pending.promise);
  const sending = f.send();
  await flush();
  f.account.token = {};
  pending.resolve(
    Response.json({ code: 200, content: { channelId: "channel" } }),
  );
  assert.equal((await sending).status, "stale");
  assert.equal(f.calls.length, 1);
});

test("CHZZK lookup and insertion limits preserve distinct API names and retry delays", async () => {
  for (const identity of [true, false]) {
    const f = fixture();
    f.respond(async (url) =>
      identity || url.endsWith("chats/send")
        ? Response.json({}, { status: 429 })
        : Response.json({ code: 200, content: { channelId: "channel" } }),
    );
    const result = await f.send();
    assert.equal(result.status, "rejected");
    if (result.status !== "rejected") throw Error("expected rejection");
    assert.deepEqual(result.failure, {
      api: identity
        ? "CHZZK User API / users/me"
        : "CHZZK Chat API / chats/send",
      operation: identity ? "identity" : "send",
      state: "quota_blocked",
    });
    assert.equal(result.retryAfterMs, identity ? 300000 : 60000);
    assert.equal(f.calls.length, identity ? 1 : 2);
  }
});

test("CHZZK wrong account and malformed receipts never confirm delivery", async () => {
  for (const [identity, content] of [
    [true, { channelId: "other" }],
    [false, { messageId: 42 }],
    [false, { messageId: "" }],
  ] as const) {
    const f = fixture();
    f.respond(async (url) =>
      Response.json({
        code: 200,
        content:
          identity || url.endsWith("chats/send")
            ? content
            : { channelId: "channel" },
      }),
    );
    const result = await f.send();
    assert.equal(result.status, "rejected");
    if (result.status !== "rejected") throw Error("expected rejection");
    assert.equal(
      result.state,
      identity ? "channel_mismatch" : "delivery_unconfirmed",
    );
    assert.equal(f.calls.length, identity ? 1 : 2);
  }
});

test("CHZZK late identity failure is stale and cannot publish old API health", async () => {
  const f = fixture(),
    pending = deferred<Response>();
  f.respond(() => pending.promise);
  const sending = f.send();
  await flush();
  f.invalidate();
  pending.resolve(Response.json({}, { status: 429 }));
  assert.equal((await sending).status, "stale");
});

test("CHZZK completed receipts retain a current credential and consent check", async () => {
  for (const invalidate of [
    (f: ReturnType<typeof fixture>) => {
      f.account.token = {};
    },
    (f: ReturnType<typeof fixture>) => f.invalidate(),
    (f: ReturnType<typeof fixture>) => f.controller.abort(),
  ]) {
    const f = fixture();
    const result = await f.send();
    assert.equal(result.status, "delivered");
    invalidate(f);
    assert.equal(result.current(), false);
  }
});

test("CHZZK provider exceptions expose only fixed diagnostic states", async () => {
  const f = fixture();
  f.respond(async () => {
    throw Error("PRIVATE_PROVIDER_RESPONSE");
  });
  const result = await f.send();
  assert.equal(result.status, "rejected");
  if (result.status !== "rejected") throw Error("expected rejection");
  assert.equal(result.state, "delivery_unconfirmed");
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});
