import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage.ts";

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "publication-"));
  const path = join(directory, "broadcast.sqlite");
  const store = new Store(path);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  store.grantConsent("youtube", "fixture", "viewer");
  store.ingestBatch([
    {
      platform: "youtube",
      channel: "fixture",
      author: "viewer",
      name: "Viewer",
      sourceId: "one",
      text: "SYNTHETIC_INPUT",
    },
  ]);
  const source = store.snapshot().messages[0]!.id;
  const input = {
    actor: "persona-fixture",
    name: "Synthetic",
    text: "SYNTHETIC_RESPONSE",
    replyToId: null,
    sourceMessageIds: [source, source],
  };
  return { store, path, source, input };
}

test("provenance failure rolls back the message, actor and event before any notification", (t) => {
  const { store, input } = fixture(t);
  const sequence = store.lastSeq();
  let notified = false;
  store.on("event", () => {
    notified = true;
  });
  store.db.exec(
    "CREATE TRIGGER fail_provenance BEFORE INSERT ON ai_message_context BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
  );
  assert.equal(store.publishSynthetic(input), null);
  assert.equal(store.lastSeq(), sequence);
  assert.equal(store.snapshot().messages.length, 1);
  assert.equal(
    store.db
      .prepare("SELECT 1 FROM actors_private WHERE source='experiment'")
      .get(),
    undefined,
  );
  assert.equal(notified, false);
  store.db.exec("DROP TRIGGER fail_provenance");
  assert.ok(store.publishSynthetic(input));
});

test("reader notification observes committed publication and complete deduplicated provenance", (t) => {
  const { store, path, input, source } = fixture(t);
  const reader = new DatabaseSync(path);
  t.after(() => reader.close());
  let observed: unknown;
  store.once("event", () => {
    observed = reader
      .prepare(
        "SELECT m.id, c.source_message_id FROM messages m JOIN ai_message_context c ON c.message_id=m.id WHERE m.platform='experiment'",
      )
      .all();
  });
  const id = store.publishSynthetic(input);
  assert.ok(id);
  assert.deepEqual(JSON.parse(JSON.stringify(observed)), [
    { id, source_message_id: source },
  ]);
});

test("a reader notification failure cannot turn a committed publication into a retry", (t) => {
  const { store, input } = fixture(t);
  store.once("event", () => {
    throw new Error("synthetic observer failure");
  });
  const id = store.publishSynthetic(input);
  assert.ok(id);
  assert.ok(store.snapshot().messages.some((message) => message?.id === id));
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS count FROM ai_message_context").get()
      ?.count,
    1,
  );
});

for (const state of ["missing", "hidden", "foreign", "closed"] as const)
  test(`publication rejects ${state} broadcast evidence`, (t) => {
    const { store, input, source } = fixture(t);
    if (state === "missing") input.sourceMessageIds = ["missing"];
    if (state === "hidden")
      store.db.prepare("UPDATE messages SET hidden=1 WHERE id=?").run(source);
    if (state === "foreign")
      store.db
        .prepare("UPDATE messages SET session='foreign' WHERE id=?")
        .run(source);
    if (state === "closed")
      store.db
        .prepare("UPDATE sessions SET closed=1 WHERE id=?")
        .run(store.sessionId);
    const sequence = store.lastSeq();
    assert.equal(store.publishSynthetic(input), null);
    assert.equal(store.lastSeq(), sequence);
  });
