import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage.ts";
import { SqliteConversationContext } from "../packages/infrastructure/conversation/context-sqlite.ts";
import { dependentMessages } from "../packages/domain/conversation/dependencies.ts";
import {
  retainApprovedSummary,
  summarizeChat,
} from "../packages/domain/conversation/summary.ts";

test("dependent removal traverses long chains, branching replies and cycles exactly once", () => {
  const links = Array.from({ length: 10000 }, (_, i) => ({
    sourceId: String(i),
    messageId: String(i + 1),
  }));
  links.push(
    { sourceId: "10000", messageId: "0" },
    { sourceId: "3", messageId: "branch" },
    { sourceId: "unrelated", messageId: "retained" },
  );
  const removed = dependentMessages(["0", "0"], links);
  assert.equal(removed.length, 10002);
  assert.equal(new Set(removed).size, removed.length);
  assert(removed.includes("branch"));
  assert(!removed.includes("retained"));
});

test("anonymous summary retention admits only fixed categories and never arbitrary stored fields", () => {
  const current = summarizeChat([]);
  const retained = retainApprovedSummary(
    {
      version: 1,
      state: "available",
      topics: ["개발·기술", "PRIVATE_TOPIC"],
      atmosphere: ["질문이 오감", "PRIVATE_QUOTE"],
      activity: "PRIVATE_ACTIVITY",
      raw: "PRIVATE_BODY",
    },
    current,
  );
  assert.deepEqual(retained.topics, ["개발·기술"]);
  assert.deepEqual(retained.atmosphere, ["질문이 오감"]);
  assert.equal(retained.activity, "unknown");
  assert(!JSON.stringify(retained).includes("PRIVATE"));
  assert.deepEqual(
    retainApprovedSummary(
      { version: 2, state: "available", topics: ["개발·기술"] },
      current,
    ),
    current,
  );
  const sparse = summarizeChat([
    { actor: "a", text: "게임 ㅋㅋ PRIVATE" },
    { actor: "a", text: "게임 ㅋㅋ" },
    { actor: "b", text: "코드" },
    { actor: "c", text: "음악" },
  ]);
  assert.equal(sparse.state, "available");
  assert.deepEqual(sparse.topics, []);
  assert.deepEqual(sparse.atmosphere, []);
});

function add(
  store: Store,
  author: string,
  text: string,
  platform: "youtube" | "experiment" = "youtube",
  replyToId: string | null = null,
) {
  if (platform === "youtube") store.grantConsent(platform, "fixture", author);
  store.ingestBatch([
    { platform, channel: "fixture", author, name: author, text, replyToId },
  ]);
  return store.snapshot().messages.at(-1)!;
}

test("context removal is session-scoped and handles reply links plus provenance cycles", () => {
  const store = new Store(":memory:");
  try {
    const prior = add(store, "prior", "prior-broadcast");
    const oldAi = add(store, "old-ai", "old-ai-copy", "experiment");
    store.newSession();
    const source = add(store, "viewer", "current-original");
    const first = add(store, "first", "first-copy", "experiment", source.id);
    const second = add(store, "second", "second-copy", "experiment");
    const unrelated = add(store, "other", "unrelated-copy", "experiment");
    store.recordAiContext(first.id, [second.id]);
    store.recordAiContext(second.id, [first.id]);
    // A historical record is not part of the current removal graph.
    store.recordAiContext(oldAi.id, [source.id]);
    store.hide(prior.id);
    assert(store.publicMessage(prior.id));
    store.hide(source.id);
    assert.equal(store.publicMessage(source.id), null);
    assert.equal(store.publicMessage(first.id), null);
    assert.equal(store.publicMessage(second.id), null);
    assert(store.publicMessage(unrelated.id));
    assert(store.publicMessage(prior.id));
    assert(store.publicMessage(oldAi.id));
    assert(
      store.db
        .prepare("SELECT 1 FROM ai_message_context WHERE message_id=?")
        .get(oldAi.id),
    );
  } finally {
    store.close();
  }
});

test("identity pruning removes current withdrawn identities without rewriting another broadcast", () => {
  const store = new Store(":memory:");
  try {
    const old = add(store, "prior-viewer", "old");
    store.reveal();
    const oldSession = store.sessionId;
    const before = store.db
      .prepare(
        "SELECT payload FROM events WHERE session=? AND type='identity.revealed'",
      )
      .get(oldSession);
    store.newSession();
    const current = add(store, "current-viewer", "current");
    store.reveal();
    store.hide(current.id);
    new SqliteConversationContext(store.db).pruneIdentities(store.sessionId);
    assert(
      store.db
        .prepare("SELECT 1 FROM actors_private WHERE id=?")
        .get(old.actorId),
    );
    assert.equal(
      store.db
        .prepare("SELECT 1 FROM actors_private WHERE id=?")
        .get(current.actorId),
      undefined,
    );
    assert.deepEqual(
      store.db
        .prepare(
          "SELECT payload FROM events WHERE session=? AND type='identity.revealed'",
        )
        .get(oldSession),
      before,
    );
    assert.equal(
      store.db
        .prepare(
          "SELECT payload FROM events WHERE session=? AND type='identity.revealed'",
        )
        .get(store.sessionId)?.payload,
      "[]",
    );
  } finally {
    store.close();
  }
});

test("summary clearing rolls back its cutoff and sends no invalidation when the durable audit fails", () => {
  const store = new Store(":memory:");
  try {
    for (const author of ["a", "b", "c"]) add(store, author, "게임 화이팅");
    const before = store.chatSummary();
    let invalidations = 0;
    store.on("context_invalidated", () => invalidations++);
    store.db.exec(
      "CREATE TRIGGER fail_summary_audit BEFORE INSERT ON audit_events WHEN NEW.action='chat_summary.cleared' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;",
    );
    assert.throws(() => store.clearChatSummary(), /synthetic audit/);
    assert.equal(invalidations, 0);
    assert.deepEqual(store.chatSummary(), before);
    store.db.exec("DROP TRIGGER fail_summary_audit");
    assert.equal(store.clearChatSummary().state, "insufficient_data");
    assert.equal(invalidations, 1);
    assert.equal(store.chatSummary().state, "insufficient_data");
  } finally {
    store.close();
  }
});
