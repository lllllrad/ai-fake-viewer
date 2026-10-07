import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage.ts";
import { SqliteConversationContext } from "../packages/infrastructure/conversation/context-sqlite.ts";
import { dependentMessages } from "../packages/domain/conversation/dependencies.ts";
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

function add(
  store: Store,
  author: string,
  text: string,
  platform: "experiment" = "experiment",
  replyToId: string | null = null,
) {
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

test("identity pruning removes current hidden identities without rewriting another broadcast", () => {
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
