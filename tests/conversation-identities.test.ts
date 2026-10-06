import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage.ts";
import { collidingNames } from "../packages/domain/conversation/disclosure.ts";
import { createBroadcastCast } from "../packages/infrastructure/cast/runtime.ts";
function fixture(t: TestContext) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  return store;
}
function add(
  store: Store,
  author = "private-account",
  name = "Synthetic viewer",
) {
  store.ingestion.ingest([
    {
      platform: "experiment",
      channel: "fixture",
      author,
      name,
      text: "Synthetic text",
    },
  ]);
}
test("collision detection normalizes width, punctuation, case and Unicode formatting", () => {
  assert.deepEqual(
    [...collidingNames(["Ａlice!", "a li\u200bce", "Unique"])],
    ["alice"],
  );
});
test("disclosure includes visible current identities without private account information", (t) => {
  const store = fixture(t);
  add(store);
  add(store, "hidden-account", "Hidden name");
  store.hide(store.snapshot().messages[1]!.id);
  store.setAiDesiredRunning(true);
  assert.equal(store.identities.reveal(), 1);
  assert.equal(store.aiDesiredRunning(), false);
  assert.equal(store.originsRevealed(), true);
  const payload = String(
    store.db
      .prepare("SELECT payload FROM events WHERE type='identity.revealed'")
      .get()!.payload,
  );
  assert.equal(payload.includes("private-account"), false);
  assert.equal(payload.includes("Hidden name"), false);
  const rows = JSON.parse(payload);
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    "actorId",
    "displayName",
    "kind",
  ]);
  assert.equal(rows[0].kind, "system_generated");
});
test("failed disclosure restores AI intent and sends no reader notifications", (t) => {
  const store = fixture(t);
  add(store);
  store.setAiDesiredRunning(true);
  store.db.exec(
    "CREATE TRIGGER fail_disclosure BEFORE INSERT ON events WHEN NEW.type='identity.revealed' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
  );
  let events = 0,
    resets = 0;
  store.on("event", () => events++);
  store.on("reset", () => resets++);
  assert.throws(() => store.identities.reveal(), /fixture failure/);
  assert.equal(store.aiDesiredRunning(), true);
  assert.equal(store.originsRevealed(), false);
  assert.equal(events, 0);
  assert.equal(resets, 0);
});
test("outer rollback restores disclosure collision memory and durable intent", (t) => {
  const store = fixture(t);
  add(store, "first", "Same!");
  add(store, "second", "same");
  store.readerCollisionNames.add("prior-cache");
  store.setAiDesiredRunning(true);
  let resets = 0;
  store.on("reset", () => resets++);
  assert.throws(
    () =>
      store.transaction(() => {
        store.identities.reveal();
        assert(store.readerCollisionNames.has("same"));
        assert.equal(resets, 0);
        throw Error("outer failure");
      }),
    /outer failure/,
  );
  assert.deepEqual([...store.readerCollisionNames], ["prior-cache"]);
  assert.equal(store.aiDesiredRunning(), true);
  assert.equal(store.originsRevealed(), false);
  assert.equal(resets, 0);
});
test("reader reset still runs after one committed disclosure event listener fails", (t) => {
  const store = fixture(t);
  add(store);
  let resets = 0;
  store.on("event", () => {
    throw Error("fixture listener failure");
  });
  store.on("reset", () => resets++);
  assert.throws(
    () => store.identities.reveal(),
    /Committed broadcast notification failed/,
  );
  assert.equal(store.originsRevealed(), true);
  assert.equal(resets, 1);
});
test("reference cast disclosure selects cast actors and does not change AI intent", (t) => {
  const store = fixture(t);
  createBroadcastCast(store, () => "Synthetic fixture").prepare();
  const runtime = store.personaRuntime()!;
  add(
    store,
    `persona-${runtime.members[0].id}`,
    runtime.members[0].displayName,
  );
  add(store, "unrelated-author", "Unrelated synthetic viewer");
  store.setAiDesiredRunning(true);
  assert.equal(store.identities.reveal(runtime.id), 1);
  assert.equal(store.aiDesiredRunning(), true);
  const payload = String(
    store.db
      .prepare("SELECT payload FROM events WHERE type='identity.revealed'")
      .get()!.payload,
  );
  assert.equal(payload.includes("Unrelated synthetic viewer"), false);
});
