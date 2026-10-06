import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeYoutube,
  youtubeChatBatch,
} from "../packages/infrastructure/platforms/youtube-chat-payload.ts";
import { runYoutube } from "../packages/youtube.ts";
import { Store } from "../packages/storage.ts";
const item = (id = "one", author = "viewer") => ({
  id,
  snippet: {
    type: "textMessageEvent",
    displayMessage: "hello",
    publishedAt: "2026-10-06T10:00:00Z",
  },
  authorDetails: { channelId: author, displayName: "@viewer" },
});

test("YouTube payload decoding preserves REST and gRPC text and provider time equivalently", () => {
  const rest = normalizeYoutube(item(), "room");
  const grpc = normalizeYoutube(
    {
      id: "one",
      snippet: {
        type: 1,
        text_message_details: { message_text: "hello" },
        published_at: "2026-10-06T10:00:00Z",
      },
      author_details: { channel_id: "viewer", display_name: "@viewer" },
    },
    "room",
  );
  assert.deepEqual(rest, grpc);
  assert.equal(rest?.publishedAt, Date.parse("2026-10-06T10:00:00Z"));
  assert.equal(rest?.name, "@viewer");
});

test("YouTube payload decoding never fabricates an author identity", () => {
  assert.equal(
    normalizeYoutube({ id: "one", snippet: item().snippet }, "room"),
    null,
  );
  const fallback = normalizeYoutube(
    {
      id: "one",
      snippet: { ...item().snippet, authorChannelId: "real-channel" },
    },
    "room",
  );
  assert.equal(fallback?.author, "real-channel");
});

test("one invalid YouTube message does not discard valid neighbours or leak unknown fields", () => {
  const invalid = {
    ...item("invalid"),
    authorDetails: { channelId: "viewer", displayName: "x".repeat(121) },
  };
  const batch = youtubeChatBatch(
    {
      items: [
        null,
        1,
        [],
        invalid,
        { ...item(), privateField: "PRIVATE" },
        { id: "other", snippet: { type: "SUPER_CHAT_EVENT" } },
      ],
      nextPageToken: "next",
    },
    { chat: "room" },
    "rest",
  );
  assert.equal(batch.messages.length, 1);
  assert.equal(batch.cursor, "next");
  assert.equal(JSON.stringify(batch).includes("PRIVATE"), false);
});

test("YouTube batch maps approved broadcaster and excludes own channel messages", () => {
  const batch = youtubeChatBatch(
    { items: [item("own", "owner"), item()], next_page_token: "grpc-next" },
    { chat: "chat", broadcaster: "owner", ownChannel: "owner" },
    "grpc",
  );
  assert.equal(batch.messages.length, 1);
  assert.equal(batch.messages[0].channel, "owner");
  assert.equal(batch.cursor, "grpc-next");
});

test("malformed YouTube page control fields cannot advance cursors or signal broadcast end", () => {
  for (const page of [
    null,
    [],
    { items: {} },
    { nextPageToken: 12 },
    { offlineAt: true },
    { offline_at: "invalid" },
    { pollingIntervalMillis: -1 },
    { pollingIntervalMillis: Infinity },
  ])
    assert.throws(() => youtubeChatBatch(page, { chat: "chat" }, "rest"));
  const page = youtubeChatBatch(
    { offlineAt: "2026-10-06T10:00:00Z", pollingIntervalMillis: 10 },
    { chat: "chat" },
    "rest",
  );
  assert.equal(page.ended, true);
  assert.equal(page.pollIntervalMs, 1000);
});

test("YouTube missing or invalid provider timestamps remain unknown", () => {
  for (const publishedAt of [
    undefined,
    "invalid",
    "1960-01-01T00:00:00Z",
    123,
  ]) {
    const message = normalizeYoutube(
      { ...item(), snippet: { ...item().snippet, publishedAt } },
      "room",
    );
    assert.equal(message?.publishedAt, null);
  }
});

test("YouTube discovery aborted during HTTP cannot resume connection state", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const controller = new AbortController(),
    states: string[] = [];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    controller.abort();
    return Response.json({
      items: [{ liveStreamingDetails: { activeLiveChatId: "chat" } }],
    });
  });
  await runYoutube(
    { video: "abcdefghijk", transport: "rest", restFallback: true },
    store,
    controller.signal,
    (s) => states.push(s),
    { access: async () => "token" },
  );
  assert.equal(calls, 1);
  assert.deepEqual(states, ["stopped"]);
});

test("YouTube malformed REST page is rejected before its checkpoint is stored", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const controller = new AbortController(),
    states: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL) =>
    String(url).includes("/videos?")
      ? Response.json({
          items: [{ liveStreamingDetails: { activeLiveChatId: "chat" } }],
        })
      : Response.json({ items: {}, nextPageToken: "must-not-save" }),
  );
  await runYoutube(
    { video: "abcdefghijk", transport: "rest", restFallback: true },
    store,
    controller.signal,
    (s) => {
      states.push(s);
      if (s === "reconnecting") controller.abort();
    },
    { access: async () => "token" },
  );
  assert.equal(
    store.checkpoint(`youtube:${store.sessionId}:chat:rest`),
    undefined,
  );
  assert.deepEqual(states, ["connecting", "reconnecting", "stopped"]);
});
