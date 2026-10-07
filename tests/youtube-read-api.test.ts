import { test } from "node:test";
import assert from "node:assert/strict";
import {
  YoutubeReadApi,
  UpstreamError,
} from "../packages/infrastructure/platforms/youtube-read-api.ts";
const signal = () => new AbortController().signal;

test("YouTube read adapter separates discovery requests and returns only bound identifiers", async () => {
  const urls: URL[] = [];
  const api = new YoutubeReadApi(
    async () => "token",
    async (input, init) => {
      const url = new URL(String(input));
      urls.push(url);
      assert.equal(init?.method, "GET");
      assert.deepEqual(init?.headers, { Authorization: "Bearer token" });
      return Response.json(
        url.pathname.endsWith("/search")
          ? { items: [{ id: { videoId: "abcdefghijk" } }] }
          : {
              items: [
                {
                  liveStreamingDetails: { activeLiveChatId: "chat" },
                  snippet: { channelId: "owner", title: "PRIVATE" },
                },
              ],
            },
      );
    },
  );
  assert.equal(await api.search("owner", signal()), "abcdefghijk");
  assert.deepEqual(
    await api.video("https://youtu.be/abcdefghijk", true, signal()),
    { chat: "chat", broadcaster: "owner" },
  );
  assert.equal(urls[0].searchParams.get("eventType"), "live");
  assert.equal(
    urls[1].searchParams.get("part"),
    "liveStreamingDetails,snippet",
  );
});

test("YouTube canceled credential refresh cannot issue a read request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const api = new YoutubeReadApi(
    async () => {
      controller.abort();
      return "token";
    },
    async () => {
      calls++;
      return Response.json({});
    },
  );
  await assert.rejects(api.messages("chat", undefined, controller.signal));
  assert.equal(calls, 0);
});

test("YouTube malformed error bodies still retain HTTP status and read API attribution", async () => {
  const api = new YoutubeReadApi(
    async () => "token",
    async () => new Response("not-json", { status: 429 }),
  );
  await assert.rejects(
    api.messages("chat", "resume", signal()),
    (error: unknown) => {
      assert(error instanceof UpstreamError);
      assert.equal(error.state, "quota_blocked");
      assert.equal(error.api, "YouTube liveChatMessages.list");
      return true;
    },
  );
});

test("YouTube malformed discovery differs from an empty live-broadcast list", async () => {
  for (const body of [{ items: {} }, { items: [{ id: { videoId: 42 } }] }]) {
    const api = new YoutubeReadApi(
      async () => "token",
      async () => Response.json(body),
    );
    await assert.rejects(
      api.search("owner", signal()),
      (error: unknown) =>
        error instanceof UpstreamError &&
        error.api === "YouTube search.list" &&
        error.state === "reconnecting",
    );
  }
  const empty = new YoutubeReadApi(
    async () => "token",
    async () => Response.json({ items: [] }),
  );
  assert.equal(await empty.search("owner", signal()), undefined);
  assert.deepEqual(await empty.video("abcdefghijk", true, signal()), {
    chat: undefined,
    broadcaster: undefined,
  });
});

test("YouTube malformed video identity cannot become an active chat binding", async () => {
  const api = new YoutubeReadApi(
    async () => "token",
    async () =>
      Response.json({
        items: [
          { liveStreamingDetails: { activeLiveChatId: { private: "value" } } },
        ],
      }),
  );
  await assert.rejects(
    api.video("abcdefghijk", true, signal()),
    (error: unknown) =>
      error instanceof UpstreamError && error.api === "YouTube videos.list",
  );
});

test("YouTube read failures sanitize provider errors and preserve the requested API", async () => {
  const api = new YoutubeReadApi(
    async () => "token",
    async () => {
      throw Error("PRIVATE_PROVIDER_BODY");
    },
  );
  await assert.rejects(
    api.video("abcdefghijk", false, signal()),
    (error: unknown) => {
      assert(error instanceof UpstreamError);
      assert.equal(error.api, "YouTube videos.list");
      assert.equal(error.message, "reconnecting");
      return true;
    },
  );
});

test("YouTube retry delays cannot become negative, nonfinite or overflow Node timers", async () => {
  for (const [header, expected] of [
    ["-5", 0],
    ["Infinity", 0],
    ["invalid", 0],
    ["2", 2000],
    ["999999999999", 2147483647],
  ] as const) {
    const api = new YoutubeReadApi(
      async () => "token",
      async () =>
        Response.json({}, { status: 503, headers: { "retry-after": header } }),
    );
    await assert.rejects(
      api.messages("chat", undefined, signal()),
      (error: unknown) =>
        error instanceof UpstreamError && error.retryMs === expected,
    );
  }
});

test("authenticated discovery uses active broadcasts and binds the configured owner", async () => {
  const api = new YoutubeReadApi(
    async () => "token",
    async (input) => {
      const url = new URL(String(input));
      assert(url.pathname.endsWith("/liveBroadcasts"));
      assert.equal(url.searchParams.get("broadcastStatus"), "active");
      assert.equal(url.searchParams.get("broadcastType"), "all");
      assert.equal(url.searchParams.has("mine"), false);
      return Response.json({
        items: [
          {
            id: "abcdefghijk",
            snippet: { channelId: "other", liveChatId: "other-chat" },
          },
          {
            id: "lmnopqrstuv",
            snippet: { channelId: "owner", liveChatId: "chat" },
          },
        ],
      });
    },
  );
  assert.equal(await api.activeBroadcast("owner", signal()), "lmnopqrstuv");
});

test("authenticated discovery distinguishes empty, ambiguous, and malformed results", async () => {
  const row = {
    id: "abcdefghijk",
    snippet: { channelId: "owner", liveChatId: "chat" },
  };
  const api = (body: unknown) =>
    new YoutubeReadApi(
      async () => "token",
      async () => Response.json(body),
    );
  assert.equal(
    await api({ items: [] }).activeBroadcast("owner", signal()),
    undefined,
  );
  for (const body of [
    { items: [row, { ...row, id: "lmnopqrstuv" }] },
    { items: [row], nextPageToken: "next" },
  ])
    await assert.rejects(
      api(body).activeBroadcast("owner", signal()),
      (e: unknown) =>
        e instanceof UpstreamError &&
        e.state === "broadcast_selection_required" &&
        e.api === "YouTube liveBroadcasts.list",
    );
  await assert.rejects(
    api({ items: [{ id: 42 }] }).activeBroadcast("owner", signal()),
    (e: unknown) => e instanceof UpstreamError && e.state === "reconnecting",
  );
});
