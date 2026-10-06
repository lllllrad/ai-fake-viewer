import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeConversationPacket,
  emptyConversation,
  receiveConversation,
} from "../apps/web/src/features/conversation/state.ts";
import type {
  ConversationMessage,
  ConversationPacket,
} from "../packages/contracts/conversation.ts";

const message = (seq = 1, sessionId = "broadcast"): ConversationMessage => ({
  id: `message-${seq}`,
  sessionId,
  actorId: "synthetic-actor",
  displayName: "Synthetic viewer",
  text: "Synthetic fixture",
  replyToId: null,
  displayTime: 1_000,
  attribution: "mixed",
  seq,
});
const snapshot = (
  messages = [message()],
  sessionId = "broadcast",
): ConversationPacket => ({
  type: "snapshot",
  sessionId,
  lastSeq: messages.at(-1)?.seq ?? 0,
  messages,
  closed: false,
  demo: false,
});
const added = (seq: number, sessionId = "broadcast"): ConversationPacket => ({
  type: "event",
  event: {
    type: "message.added",
    sessionId,
    seq,
    occurredAt: 1_000,
    payload: message(seq, sessionId),
  },
});
const initial = () => receiveConversation(emptyConversation(), snapshot());

test("public protocol rejects invalid JSON, malformed messages and unrenderable dates", () => {
  for (const raw of [
    "{",
    "null",
    JSON.stringify({ type: "snapshot" }),
    JSON.stringify(snapshot([{ ...message(), displayTime: 1e20 }])),
  ])
    assert.equal(decodeConversationPacket(raw), undefined);
  assert.deepEqual(
    decodeConversationPacket(JSON.stringify(snapshot())),
    snapshot(),
  );
});

test("reconnect snapshots replace old content and discard foreign broadcast messages", () => {
  const next = receiveConversation(
    initial(),
    snapshot([message(2, "next"), message(3)], "next"),
  );
  assert.deepEqual(next.messages, [message(2, "next")]);
  assert.equal(next.sessionId, "next");
  assert.deepEqual(receiveConversation(next, snapshot([])).messages, []);
});

test("replayed and foreign events cannot duplicate or overwrite the active conversation", () => {
  const state = initial();
  assert.equal(receiveConversation(state, added(1)), state);
  assert.equal(receiveConversation(state, added(2, "old")), state);
  const next = receiveConversation(state, added(2));
  assert.equal(next.messages.length, 2);
  assert.equal(receiveConversation(next, added(1)), next);
});

test("withdrawn messages disappear immediately and a current snapshot cannot resurrect them", () => {
  const state = receiveConversation(initial(), added(2));
  const next = receiveConversation(state, {
    type: "event",
    event: {
      type: "message.hidden",
      sessionId: "broadcast",
      seq: 3,
      occurredAt: 1_000,
      payload: { id: "message-1" },
    },
  });
  assert.deepEqual(next.messages, [message(2)]);
  assert.deepEqual(receiveConversation(next, snapshot([message(2)])).messages, [
    message(2),
  ]);
});

test("closed broadcasts clear messages and guidance and reject delayed additions", () => {
  const notice = receiveConversation(initial(), {
    type: "consent_notice",
    occurredAt: 1_000,
  });
  const closed = receiveConversation(notice, {
    type: "event",
    event: {
      type: "session.closed",
      sessionId: "broadcast",
      seq: 2,
      occurredAt: 1_000,
      payload: null,
    },
  });
  assert.equal(closed.closed, true);
  assert.equal(closed.noticeAt, null);
  assert.deepEqual(receiveConversation(closed, added(3)).messages, []);
  assert.equal(
    receiveConversation(closed, { type: "consent_notice", occurredAt: 2_000 }),
    closed,
  );
  assert.deepEqual(
    receiveConversation(initial(), {
      ...snapshot(),
      closed: true,
    } as ConversationPacket).messages,
    [],
  );
});

test("disclosure uses server projection rather than inferring message origins", () => {
  const next = receiveConversation(initial(), {
    type: "event",
    event: {
      type: "identity.revealed",
      sessionId: "broadcast",
      seq: 2,
      occurredAt: 1_000,
      payload: [],
    },
  });
  assert.equal(next.messages[0]!.attribution, "mixed");
  assert.equal(
    receiveConversation(
      next,
      snapshot([{ ...message(), attribution: "experiment" }]),
    ).messages[0]!.attribution,
    "experiment",
  );
});

test("edits replace message content without duplicates and the live window stays bounded", () => {
  let state = receiveConversation(
    emptyConversation(),
    snapshot(Array.from({ length: 310 }, (_, i) => message(i + 1))),
  );
  assert.equal(state.messages.length, 300);
  state = receiveConversation(state, added(311));
  assert.equal(state.messages[0]!.seq, 12);
  const changed = { ...message(311), text: "Edited synthetic fixture" };
  state = receiveConversation(state, {
    type: "event",
    event: {
      type: "message.updated",
      sessionId: "broadcast",
      seq: 312,
      occurredAt: 1_000,
      payload: changed,
    },
  });
  assert.equal(state.messages.length, 300);
  assert.deepEqual(state.messages.at(-1), changed);
});
