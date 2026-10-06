import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ReaderSession,
  type ReaderSource,
  type ReaderTransport,
} from "../packages/application/conversation/reader-session.ts";
function fixture() {
  const timers = new Map<number, () => void>(),
    packets: unknown[] = [],
    closes: number[] = [];
  let listeners: Parameters<ReaderSource["subscribe"]>[0] | undefined;
  let subscriptions = 0,
    removals = 0,
    disposed = 0,
    pings = 0,
    terminated = 0;
  const source: ReaderSource = {
    snapshot: () => ({
      type: "snapshot",
      sessionId: "fixture",
      lastSeq: 1,
      messages: [],
      identities: [],
      closed: false,
    }),
    event: (event) => ({
      ...event,
      type: "message.hidden",
      payload: { id: "removed" },
    }),
    noticeEnabled: () => true,
    subscribe: (next) => {
      subscriptions++;
      listeners = next;
      return () => {
        removals++;
        listeners = undefined;
      };
    },
  };
  const transport: ReaderTransport = {
    open: () => true,
    bufferedBytes: () => 0,
    send: (packet) => {
      packets.push(packet);
    },
    close: (code) => {
      closes.push(code);
    },
    ping: () => {
      pings++;
    },
    terminate: () => {
      terminated++;
    },
  };
  const schedule = (ms: number, action: () => void) => {
    timers.set(ms, action);
    return () => {
      timers.delete(ms);
    };
  };
  const session = new ReaderSession(
    source,
    transport,
    { after: schedule, every: schedule },
    {
      demo: false,
      authenticate: (token) => token === "fixture-token",
      disposed: () => {
        disposed++;
      },
    },
  );
  return {
    session,
    source,
    transport,
    timers,
    packets,
    closes,
    auth: () =>
      session.authenticate({
        type: "auth",
        token: "fixture-token",
        afterSeq: 99,
      }),
    listeners: () => listeners!,
    counts: () => ({ subscriptions, removals, disposed, pings, terminated }),
  };
}
test("reader authenticates once, starts from current snapshot and reprojects later events", () => {
  const f = fixture();
  assert.equal(f.packets.length, 0);
  assert.equal(f.counts().subscriptions, 0);
  f.auth();
  assert.equal(f.packets.length, 1);
  assert.equal(f.counts().subscriptions, 1);
  assert(!f.timers.has(5000));
  f.listeners().event({
    type: "message.added",
    sessionId: "fixture",
    seq: 2,
    occurredAt: 10,
    payload: { text: "WITHDRAWN_FIXTURE" },
  });
  assert(!JSON.stringify(f.packets).includes("WITHDRAWN_FIXTURE"));
  assert.deepEqual(f.packets[1], {
    type: "event",
    event: {
      type: "message.hidden",
      sessionId: "fixture",
      seq: 2,
      occurredAt: 10,
      payload: { id: "removed" },
    },
  });
  f.auth();
  assert.deepEqual(f.closes, [1008]);
  assert.equal(f.counts().removals, 1);
  assert.equal(f.timers.size, 0);
});
test("authentication timeout disposes even if the peer never finishes closing", () => {
  const f = fixture();
  f.timers.get(5000)!();
  f.auth();
  assert.deepEqual(f.closes, [1008]);
  assert.equal(f.packets.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.counts().disposed, 1);
});
test("rotation or shutdown closes unauthenticated sessions before late authentication", () => {
  const f = fixture();
  f.session.close(1008);
  f.auth();
  f.session.dispose();
  assert.equal(f.counts().subscriptions, 0);
  assert.equal(f.counts().disposed, 1);
  assert.equal(f.packets.length, 0);
});
test("slow reader is rejected before snapshot or subscription allocation", () => {
  const f = fixture();
  f.transport.bufferedBytes = () => 1024 * 1024 + 1;
  f.auth();
  assert.deepEqual(f.closes, [1013]);
  assert.equal(f.packets.length, 0);
  assert.equal(f.counts().subscriptions, 0);
});
test("send failure detaches subscriptions immediately and never escapes a publication callback", () => {
  const f = fixture();
  f.auth();
  const callback = f.listeners().reset;
  f.transport.send = () => {
    throw new Error("fixture disconnect");
  };
  assert.doesNotThrow(callback);
  assert.deepEqual(f.closes, [1011]);
  assert.equal(f.counts().removals, 1);
  callback();
  assert.equal(f.packets.length, 1);
});
test("heartbeat tracks pong and removes dead reader listeners and timers", () => {
  const f = fixture();
  f.auth();
  f.timers.get(30000)!();
  f.session.pong();
  f.timers.get(30000)!();
  assert.equal(f.counts().pings, 2);
  assert.equal(f.counts().terminated, 0);
  f.timers.get(30000)!();
  assert.equal(f.counts().terminated, 1);
  assert.equal(f.counts().removals, 1);
  assert.equal(f.timers.size, 0);
});
test("reset uses current broadcast state and disabled notices never reach the reader", () => {
  const f = fixture();
  f.auth();
  f.source.snapshot = () => ({
    type: "snapshot",
    sessionId: "next",
    lastSeq: 0,
    messages: [],
    identities: [],
    closed: true,
  });
  f.listeners().reset();
  assert.equal((f.packets[1] as { sessionId: string }).sessionId, "next");
  f.source.noticeEnabled = () => false;
  f.listeners().notice({
    platform: "youtube",
    channel: "fixture",
    occurredAt: 10,
  });
  assert.equal(f.packets.length, 2);
  f.session.dispose();
});

test("disposed notice callbacks never read storage and broken closes do not escape publishers", () => {
  const f = fixture();
  f.auth();
  const listeners = f.listeners();
  f.transport.close = () => {
    throw new Error("fixture close failure");
  };
  f.transport.send = () => {
    throw new Error("fixture send failure");
  };
  assert.doesNotThrow(listeners.reset);
  f.source.noticeEnabled = () => {
    assert.fail("disposed listener must not query storage");
  };
  listeners.notice({ platform: "youtube", channel: "fixture", occurredAt: 10 });
  assert.equal(f.counts().removals, 1);
});
