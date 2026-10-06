import { test } from "node:test";
import assert from "node:assert/strict";
import { YoutubeNoticeTransport } from "../packages/infrastructure/platforms/youtube-notice-transport.ts";
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const notice = { chat: "chat", broadcaster: "channel", text: "fixed notice" };
const receipt = () => ({
  id: "sent",
  snippet: {
    liveChatId: "chat",
    authorChannelId: "channel",
    textMessageDetails: { messageText: notice.text },
  },
});
function fixture() {
  const account = {
    connected: true,
    channelId: "channel",
    access: async () => "token",
  };
  let valid = true,
    connected = true;
  const calls: RequestInit[] = [];
  let sending = 0;
  let respond = async () => Response.json(receipt());
  const transport = new YoutubeNoticeTransport(account, async (url, init) => {
    assert.equal(
      url,
      "https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet",
    );
    calls.push(init!);
    return respond();
  });
  const controller = new AbortController();
  const send = () =>
    transport.send(notice, controller.signal, {
      valid: () => valid,
      connected: () => connected,
      sending: () => {
        sending++;
      },
    });
  return {
    account,
    calls,
    controller,
    send,
    invalidate: () => {
      valid = false;
    },
    disconnect: () => {
      connected = false;
    },
    respond: (fn: typeof respond) => {
      respond = fn;
    },
    get sending() {
      return sending;
    },
  };
}

test("YouTube fixed notice transport sends only one exact insertion and validates its resource", async () => {
  const f = fixture();
  assert.deepEqual(await f.send(), { status: "delivered" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, "POST");
  assert.deepEqual(f.calls[0].headers, {
    authorization: "Bearer token",
    "content-type": "application/json",
  });
  assert.deepEqual(JSON.parse(String(f.calls[0].body)), {
    snippet: {
      liveChatId: "chat",
      type: "textMessageEvent",
      textMessageDetails: { messageText: notice.text },
    },
  });
});

test("YouTube fixed notice transport rechecks account and consent after token refresh", async () => {
  for (const invalidate of [
    (f: ReturnType<typeof fixture>) => f.invalidate(),
    (f: ReturnType<typeof fixture>) => {
      f.account.channelId = "other";
    },
    (f: ReturnType<typeof fixture>) => {
      f.account.connected = false;
    },
    (f: ReturnType<typeof fixture>) => f.controller.abort(),
  ]) {
    const f = fixture(),
      pending = deferred<string>();
    f.account.access = () => pending.promise;
    const sending = f.send();
    invalidate(f);
    pending.resolve("token");
    assert.deepEqual(await sending, { status: "stale" });
    assert.equal(f.calls.length, 0);
  }
});

test("YouTube fixed notice transport pauses new writes while receipt is disconnected", async () => {
  const f = fixture();
  f.disconnect();
  assert.deepEqual(await f.send(), { status: "waiting_connection" });
  assert.equal(f.calls.length, 0);
});

test("YouTube receipt reconnect does not discard an exact successful insertion", async () => {
  const f = fixture(),
    pending = deferred<Response>();
  f.respond(() => pending.promise);
  const sending = f.send();
  await flush();
  f.disconnect();
  pending.resolve(Response.json(receipt()));
  assert.deepEqual(await sending, { status: "delivered" });
});

test("YouTube target invalidation while reading an error body cannot publish stale quota state", async () => {
  const f = fixture(),
    body = deferred<unknown>();
  const response = Response.json({}, { status: 403 });
  response.json = () => body.promise;
  f.respond(async () => response);
  const sending = f.send();
  await flush();
  f.invalidate();
  body.resolve({ error: { errors: [{ reason: "quotaExceeded" }] } });
  assert.deepEqual(await sending, { status: "stale" });
});

test("YouTube insertion failures retain operation attribution and existing retry delay", async () => {
  for (const [status, reason, state, retryAfterMs] of [
    [403, "quotaExceeded", "quota_blocked", 300000],
    [429, "", "quota_blocked", 60000],
    [403, "forbidden", "permission_blocked", 300000],
    [401, "", "auth_required", 300000],
    [500, "", "delivery_unconfirmed", 60000],
  ] as const) {
    const f = fixture();
    f.respond(async () =>
      Response.json({ error: { errors: [{ reason }] } }, { status }),
    );
    assert.deepEqual(await f.send(), {
      status: "rejected",
      retryAfterMs,
      failure: {
        api: "YouTube liveChatMessages.insert",
        operation: "send",
        state,
      },
    });
    assert.equal(f.calls.length, 1);
  }
});

test("YouTube malformed or mismatched receipts never prove delivery", async () => {
  for (const body of [
    { ...receipt(), id: 123 },
    { ...receipt(), snippet: { ...receipt().snippet, liveChatId: "other" } },
    {
      ...receipt(),
      snippet: { ...receipt().snippet, authorChannelId: "other" },
    },
    {
      ...receipt(),
      snippet: {
        ...receipt().snippet,
        textMessageDetails: { messageText: "other" },
      },
    },
  ]) {
    const f = fixture();
    f.respond(async () => Response.json(body));
    await assert.rejects(f.send(), { message: "delivery_unconfirmed" });
  }
});

test("YouTube late refresh failure is stale and current provider errors stay sanitized", async () => {
  const f = fixture(),
    pending = deferred<string>();
  f.account.access = () => pending.promise;
  const sending = f.send();
  f.invalidate();
  pending.reject(Error("PRIVATE_REFRESH_BODY"));
  assert.deepEqual(await sending, { status: "stale" });
  const g = fixture();
  g.respond(async () => {
    throw Error("PRIVATE_PROVIDER_BODY");
  });
  await assert.rejects(g.send(), { message: "delivery_unconfirmed" });
});
