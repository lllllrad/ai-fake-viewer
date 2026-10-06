import { test } from "node:test";
import assert from "node:assert/strict";
import { ConversationProjection } from "../packages/application/conversation/projection-service.ts";
import type {
  ConversationReadRepository,
  StoredConversationMessage,
} from "../packages/application/conversation/projection-ports.ts";
import { discloseMessage } from "../packages/domain/conversation/disclosure.ts";
import { Store } from "../packages/storage.ts";

function fixture() {
  const messages = new Map<string, StoredConversationMessage>([
    [
      "human",
      {
        id: "human",
        sessionId: "broadcast",
        actorId: "human-actor",
        displayName: "Actual nickname",
        text: "CURRENT_TEXT",
        replyToId: null,
        displayTime: 1,
        attribution: "youtube",
        seq: 1,
        author: "PRIVATE_ACCOUNT",
        channel: "PRIVATE_CHANNEL",
        consentEpoch: 7,
      },
    ],
    [
      "ai",
      {
        id: "ai",
        sessionId: "broadcast",
        actorId: "ai-actor",
        displayName: "Orbit · experiment",
        text: "AI text",
        replyToId: null,
        displayTime: 2,
        attribution: "experiment",
        seq: 2,
        author: "PRIVATE_AI_ACCOUNT",
        channel: "PRIVATE_CHANNEL",
        consentEpoch: 0,
      },
    ],
  ]);
  const state = {
    allowed: true,
    closed: false,
    revealed: false,
    messageReads: 0,
    windowReads: 0,
  };
  const identities = [
    {
      actorId: "human-actor",
      displayName: "Actual nickname",
      kind: "platform_received" as const,
    },
    {
      actorId: "ai-actor",
      displayName: "Orbit",
      kind: "system_generated" as const,
    },
    {
      actorId: "absent",
      displayName: "OLD_PRIVATE_NAME",
      kind: "platform_received" as const,
    },
  ];
  const repository: ConversationReadRepository = {
    message: (id) => {
      state.messageReads++;
      return messages.get(id);
    },
    recentMessages: () => {
      state.windowReads++;
      return [...messages.values()];
    },
    event: (seq) => ({
      seq,
      sessionId: "broadcast",
      type: "message.added",
      target: "human",
      occurredAt: 1,
      payload: { text: "OLD_PRIVATE_TEXT" },
    }),
    latestIdentities: () => (state.revealed ? identities : undefined),
    disclosed: () => state.revealed,
    lastSequence: () => 2,
    replaySequences: () => [1],
  };
  const projection = new ConversationProjection(repository, {
    sessionId: () => "broadcast",
    closed: () => state.closed,
    permitted: (message) =>
      message.attribution === "experiment" || state.allowed,
  });
  return { projection, state, messages, identities };
}
test("public snapshot uses one message window and excludes private fields or denied identities", () => {
  const { projection, state, messages } = fixture();
  assert(
    !JSON.stringify(projection.readerMessage(messages.get("human")!)).includes(
      "PRIVATE",
    ),
  );
  const first = projection.readerSnapshot();
  assert.equal(state.windowReads, 1);
  assert.equal(state.messageReads, 0);
  assert.equal(first.messages[0].displayName, "Actual nickname");
  assert.equal(first.messages[1].displayName, "Orbit");
  assert(first.messages.every((message) => message.attribution === "mixed"));
  assert(!JSON.stringify(first).includes("PRIVATE"));
  state.revealed = true;
  state.allowed = false;
  const next = projection.readerSnapshot();
  assert.equal(next.messages.length, 1);
  assert.equal(next.messages[0].attribution, "experiment");
  assert.deepEqual(
    next.identities.map((identity) => identity.actorId),
    ["ai-actor"],
  );
  assert(!JSON.stringify(next).includes("Actual nickname"));
});
test("cached message events and replay recheck current permissions and text", () => {
  const { projection, state, messages } = fixture();
  const event = projection.event(1);
  messages.get("human")!.text = "LATEST_TEXT";
  assert(JSON.stringify(projection.readerEvent(event)).includes("LATEST_TEXT"));
  assert(
    !JSON.stringify(projection.readerEvent(event)).includes("CURRENT_TEXT"),
  );
  state.allowed = false;
  assert.equal(projection.readerEvent(event).type, "message.hidden");
  assert.equal(projection.replay(0)[0].type, "message.hidden");
  assert(!JSON.stringify(projection.readerEvent(event)).includes("TEXT"));
});
test("closed and foreign broadcasts cannot revive cached messages or identity mappings", () => {
  const { projection, state, identities } = fixture();
  const event = projection.event(1);
  state.revealed = true;
  state.allowed = false;
  const identityEvent = {
    seq: 3,
    sessionId: "broadcast",
    type: "identity.revealed",
    occurredAt: 1,
    payload: identities,
  };
  assert.deepEqual(projection.readerEvent(identityEvent).payload, [
    identities[1],
  ]);
  state.closed = true;
  assert.equal(projection.readerEvent(event).type, "message.hidden");
  assert.deepEqual(projection.readerSnapshot().messages, []);
  assert.deepEqual(projection.readerSnapshot().identities, []);
  assert.deepEqual(projection.readerEvent(identityEvent).payload, []);
  state.closed = false;
  assert.equal(
    projection.readerEvent({ ...event, sessionId: "prior" }).type,
    "message.hidden",
  );
  assert.deepEqual(
    projection.readerEvent({ ...identityEvent, sessionId: "prior" }).payload,
    [],
  );
});
test("disclosure preserves platform nicknames, trims only the legacy synthetic suffix and does not mutate input", () => {
  const human = {
    displayName: "User · experiment",
    attribution: "youtube",
    text: "text",
  };
  assert.equal(discloseMessage(human, false).displayName, human.displayName);
  assert.equal(discloseMessage(human, true).attribution, "youtube");
  assert.equal(human.attribution, "youtube");
  assert.equal(
    discloseMessage({ ...human, attribution: "experiment" }, false).displayName,
    "User",
  );
});
test("SQLite projection returns the latest 300 messages in order and bounds replay", () => {
  const store = new Store(":memory:");
  try {
    store.ingestBatch(
      Array.from({ length: 1005 }, (_, index) => ({
        platform: "experiment" as const,
        channel: "fixture",
        author: "synthetic",
        name: "Synthetic",
        text: String(index),
      })),
    );
    const messages = store.readerSnapshot().messages;
    assert.equal(messages.length, 300);
    assert.equal(messages[0].text, "705");
    assert.equal(messages.at(-1)!.text, "1004");
    assert.equal(store.replay(0).length, 1001);
    const event = store.publicEvent(messages.at(-1)!.seq);
    store.hide(messages.at(-1)!.id);
    assert.equal(store.readerEvent(event).type, "message.hidden");
    assert.equal(store.readerSnapshot().messages.length, 300);
    assert.equal(store.readerSnapshot().messages.at(-1)!.text, "1003");
  } finally {
    store.close();
  }
});
