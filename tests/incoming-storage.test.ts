import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage.ts";
import type { Incoming } from "../packages/contracts/incoming.ts";
const message = (extra: Partial<Incoming> = {}): Incoming => ({
  platform: "experiment",
  channel: "fixture",
  author: "synthetic-author",
  name: "Synthetic viewer",
  text: "Synthetic message",
  sourceId: "source-fixture",
  ...extra,
});
function fixture(t: TestContext) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  return store;
}
test("source identity deduplicates empty IDs and legitimate edits retain the original actor", (t) => {
  const store = fixture(t);
  assert.equal(store.ingestBatch([message({ sourceId: "" })]).length, 1);
  assert.equal(store.ingestBatch([message({ sourceId: "" })]).length, 0);
  const actor = store.snapshot().messages[0]!.actorId;
  assert.equal(
    store.ingestBatch([
      message({ sourceId: "", text: "Edited synthetic message" }),
    ]).length,
    1,
  );
  assert.equal(store.snapshot().messages.length, 1);
  assert.equal(store.snapshot().messages[0]!.actorId, actor);
  assert.equal(store.snapshot().messages[0]!.text, "Edited synthetic message");
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM actors_private").get()!.n,
    1,
  );
});
test("an existing synthetic message cannot change authors or create an orphan actor", (t) => {
  const store = fixture(t);
  store.ingestBatch([message()]);
  assert.equal(
    store.ingestBatch([
      message({ author: "other-author", text: "Replacement" }),
    ]).length,
    0,
  );
  assert.equal(store.snapshot().messages[0]!.text, "Synthetic message");
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM actors_private").get()!.n,
    1,
  );
});
test("hidden messages cannot be revived and missing source IDs represent separate messages", (t) => {
  const store = fixture(t);
  store.ingestBatch([message()]);
  store.hide(store.snapshot().messages[0]!.id);
  assert.equal(store.ingestBatch([message({ text: "Replacement" })]).length, 0);
  assert.equal(store.snapshot().messages.length, 0);
  assert.equal(
    store.ingestBatch([
      message({ sourceId: null }),
      message({ sourceId: null }),
    ]).length,
    2,
  );
});
test("outer rollback removes input, checkpoint and deferred reader notifications", (t) => {
  const store = fixture(t);
  let events = 0;
  store.on("event", () => events++);
  assert.throws(
    () =>
      store.transaction(() => {
        store.ingestBatch([message()], { key: "cursor", value: "next" });
        assert.equal(events, 0);
        throw Error("fixture outer failure");
      }),
    /fixture outer failure/,
  );
  assert.equal(events, 0);
  assert.equal(store.snapshot().messages.length, 0);
  assert.equal(store.checkpoint("cursor"), undefined);
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM actors_private").get()!.n,
    0,
  );
});
test("a failed connector checkpoint rolls back all messages in its batch", (t) => {
  const store = fixture(t);
  store.db.exec(
    "CREATE TRIGGER fail_checkpoint BEFORE INSERT ON connector_checkpoints BEGIN SELECT RAISE(ABORT,'fixture checkpoint failure'); END;",
  );
  let events = 0;
  store.on("event", () => events++);
  assert.throws(
    () => store.ingestBatch([message()], { key: "cursor", value: "next" }),
    /fixture checkpoint failure/,
  );
  assert.equal(events, 0);
  assert.equal(store.snapshot().messages.length, 0);
  assert.equal(store.lastSeq(), 0);
});
test("closed broadcasts neither accept input nor create checkpoints", (t) => {
  const store = fixture(t);
  store.closeSession();
  assert.deepEqual(
    store.ingestBatch([message()], { key: "cursor", value: "next" }),
    [],
  );
  assert.equal(store.checkpoint("cursor"), undefined);
});
test("one failed reader notification does not suppress later committed messages", (t) => {
  const store = fixture(t);
  let events = 0;
  store.on("event", () => {
    events++;
    if (events === 1) throw Error("fixture reader failure");
  });
  assert.throws(
    () =>
      store.ingestBatch([message(), message({ sourceId: "second" })], {
        key: "cursor",
        value: "next",
      }),
    /Committed broadcast notification failed/,
  );
  assert.equal(events, 2);
  assert.equal(store.snapshot().messages.length, 2);
  assert.equal(store.checkpoint("cursor"), "next");
});
