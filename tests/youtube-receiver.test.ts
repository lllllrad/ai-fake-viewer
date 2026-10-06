import { test } from "node:test";
import assert from "node:assert/strict";
import {
  receiveYoutube,
  type YoutubeReceiverPorts,
  type YoutubeReceiverConfig,
  type YoutubeBatch,
} from "../packages/application/inputs/youtube-receiver.ts";
import {
  youtubeReceiveIssue,
  runYoutube,
} from "../packages/infrastructure/platforms/youtube-receiver.ts";
import { Store } from "../packages/storage.ts";
const batch = (ended = true): YoutubeBatch => ({
  messages: [],
  cursor: "next",
  ended,
  pollIntervalMs: 1100,
});
function fixture(transport: "rest" | "grpc" = "rest") {
  const controller = new AbortController();
  let current = true,
    fallbacks = 0;
  const writes: string[] = [],
    cleared: string[] = [],
    delays: number[] = [];
  const states: { state: string; api?: string }[] = [];
  const cursors = new Map<string, string>();
  const config: YoutubeReceiverConfig = {
    video: "abcdefghijk",
    transport,
    restFallback: true,
  };
  const ports: YoutubeReceiverPorts = {
    broadcastId: "broadcast",
    configured: true,
    current: () => current,
    requiresParticipation: true,
    available: () => true,
    resolve: () => {},
    status: (state, api) => {
      states.push({ state, api });
    },
    search: async () => "abcdefghijk",
    video: async () => ({ chat: "chat", broadcaster: "owner" }),
    messages: async () => batch(),
    stream: async (_chat, _cursor, _owner, _signal, receive) =>
      receive(batch()) === "end" ? "end" : "closed",
    checkpoint: (key) => cursors.get(key),
    clearCheckpoint: (key) => {
      cleared.push(key);
      cursors.delete(key);
    },
    ingest: (_messages, checkpoint) => {
      writes.push(checkpoint.key);
      cursors.set(checkpoint.key, checkpoint.value);
    },
    fallback: () => {
      fallbacks++;
    },
    issue: youtubeReceiveIssue,
    sleep: async (ms) => {
      delays.push(ms);
    },
    random: () => 0,
  };
  return {
    ports,
    config,
    controller,
    writes,
    states,
    cursors,
    cleared,
    delays,
    retire: () => {
      current = false;
    },
    run: () => receiveYoutube(config, ports, controller.signal),
    get fallbacks() {
      return fallbacks;
    },
  };
}

test("YouTube discovery bound to an old broadcast cannot resolve or update state", async () => {
  const f = fixture();
  let resolved = 0;
  f.ports.resolve = () => {
    resolved++;
  };
  f.ports.video = async () => {
    f.retire();
    return { chat: "old-chat", broadcaster: "old-owner" };
  };
  await f.run();
  assert.equal(resolved, 0);
  assert.deepEqual(f.states, []);
  assert.deepEqual(f.writes, []);
});

test("YouTube REST response from a retired broadcast cannot write or end the current broadcast", async () => {
  const f = fixture();
  f.ports.messages = async () => {
    f.retire();
    return batch();
  };
  await f.run();
  assert.deepEqual(f.writes, []);
  assert.deepEqual(
    f.states.map((s) => s.state),
    ["connecting"],
  );
});

test("YouTube gRPC callback from a retired broadcast ends its stream without applying data", async () => {
  const f = fixture("grpc");
  f.ports.stream = async (_chat, _cursor, _owner, _signal, receive) => {
    f.retire();
    assert.equal(receive(batch()), "end");
    return "end";
  };
  await f.run();
  assert.deepEqual(f.writes, []);
  assert.deepEqual(
    f.states.map((s) => s.state),
    ["connecting"],
  );
});

test("YouTube fallback needs three failed gRPC attempts and uses a separate REST cursor", async () => {
  const f = fixture("grpc");
  let attempts = 0;
  f.ports.stream = async () => {
    attempts++;
    throw Object.assign(Error("unavailable"), { code: 14 });
  };
  await f.run();
  assert.equal(attempts, 3);
  assert.equal(f.fallbacks, 1);
  assert.deepEqual(f.delays, [2000, 4000, 8000]);
  assert.deepEqual(f.writes, ["youtube:broadcast:chat:rest"]);
  assert.equal(
    f.states.filter((s) => s.state === "fallback_to_rest").length,
    1,
  );
});

test("YouTube invalid cursor clears only that connector before retrying", async () => {
  const f = fixture("grpc"),
    seen: (string | undefined)[] = [];
  f.cursors.set("youtube:broadcast:chat:grpc", "invalid");
  f.cursors.set("unrelated", "keep");
  f.ports.stream = async (_chat, cursor, _owner, _signal, receive) => {
    seen.push(cursor);
    if (cursor) throw Object.assign(Error("cursor"), { code: 3 });
    receive(batch());
    return "end";
  };
  await f.run();
  assert.deepEqual(seen, ["invalid", undefined]);
  assert.deepEqual(f.cleared, ["youtube:broadcast:chat:grpc"]);
  assert.equal(f.cursors.get("unrelated"), "keep");
  assert.equal(f.fallbacks, 0);
});

test("YouTube quota failures stop without retry or fallback and identify streamList", async () => {
  const f = fixture("grpc");
  f.ports.stream = async () => {
    throw Object.assign(Error("quota"), { code: 8 });
  };
  await f.run();
  assert.deepEqual(f.states.at(-1), {
    state: "quota_blocked",
    api: "YouTube liveChatMessages.streamList",
  });
  assert.deepEqual(f.delays, []);
  assert.equal(f.fallbacks, 0);
});

test("YouTube normal REST polling preserves logical connectivity and provider pacing", async () => {
  const f = fixture();
  let reads = 0;
  f.ports.messages = async () => batch(++reads === 2);
  await f.run();
  assert.deepEqual(f.delays, [1100]);
  assert.deepEqual(
    f.states.map((s) => s.state),
    ["connecting", "subscribed:rest", "subscribed:rest", "ended"],
  );
});

test("YouTube malformed REST data reports list rather than streamList", async () => {
  const f = fixture();
  f.ports.messages = async () => {
    throw Error("malformed payload");
  };
  f.ports.sleep = async () => {
    f.controller.abort();
  };
  await f.run();
  assert.deepEqual(f.states[1], {
    state: "reconnecting",
    api: "YouTube liveChatMessages.list",
  });
});

test("actual YouTube composition does not store an old response after a new broadcast starts", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const before = store.sessionId,
    states: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    if (String(url).includes("/videos?"))
      return Response.json({
        items: [{ liveStreamingDetails: { activeLiveChatId: "chat" } }],
      });
    store.newSession();
    return Response.json({
      items: [],
      nextPageToken: "old-response",
      offlineAt: "2026-10-06T10:00:00Z",
    });
  });
  await runYoutube(
    { video: "abcdefghijk", transport: "rest", restFallback: true },
    store,
    new AbortController().signal,
    (state) => states.push(state),
    { access: async () => "token" },
  );
  assert.notEqual(store.sessionId, before);
  assert.equal(
    store.checkpoint(`youtube:${store.sessionId}:chat:rest`),
    undefined,
  );
  assert.equal(store.checkpoint(`youtube:${before}:chat:rest`), undefined);
  assert.deepEqual(states, ["connecting"]);
});
