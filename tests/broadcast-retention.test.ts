import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage.ts";
import { Participation } from "../packages/infrastructure/participation/runtime.ts";
import { approvedProfile } from "./privacy-fixtures.ts";
import { initializeBroadcastDatabase } from "../packages/infrastructure/storage/initialize.ts";
function fixture(t: TestContext, live = false) {
  const store = new Store(
    ":memory:",
    live ? new Participation(approvedProfile(), "") : undefined,
  );
  t.after(() => store.close());
  return store;
}
test("retention preserves the current closed marker even when expired content triggers cleanup", (t) => {
  const store = fixture(t, true);
  store.lifetime.end();
  const marker = store.sessionId;
  store.db.prepare("UPDATE sessions SET closed=1 WHERE id=?").run(marker);
  store.db
    .prepare(
      "INSERT INTO transcripts VALUES('expired',?,1,'Synthetic expired content')",
    )
    .run(marker);
  assert.equal(store.retention.purge(100), true);
  assert.equal(store.closed(), true);
  assert.equal(store.transcripts.count(), 0);
  assert.equal(
    initializeBroadcastDatabase(store.db, {
      now: () => 1000,
      id: () => {
        throw Error("must retain marker");
      },
    }),
    marker,
  );
  assert.equal(store.closed(), true);
});
test("live broadcast history is protected regardless of the requested age cutoff", (t) => {
  const store = fixture(t, true);
  store.transcripts.record({
    id: "speech",
    text: "Synthetic live speech",
    capturedAt: 1,
  });
  let resets = 0;
  store.on("reset", () => resets++);
  assert.equal(store.retention.purge(Date.now() + 86400000), false);
  assert.equal(store.transcripts.count(), 1);
  assert.equal(resets, 0);
});
test("retention removes expired audit-only data and older session markers without removing the current one", (t) => {
  const store = fixture(t);
  const current = store.sessionId;
  store.db.exec(
    "INSERT INTO sessions VALUES('expired',1,2); INSERT INTO audit_events(session,at,action) VALUES('expired',1,'fixture');",
  );
  assert.equal(store.retention.purge(100), true);
  assert.equal(
    store.db.prepare("SELECT 1 FROM sessions WHERE id='expired'").get(),
    undefined,
  );
  assert(store.db.prepare("SELECT 1 FROM sessions WHERE id=?").get(current));
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM audit_events").get()!.n,
    0,
  );
});
test("retention rollback restores summaries and content and sends no premature reset", (t) => {
  const store = fixture(t);
  store.transcripts.record({
    id: "speech",
    text: "Synthetic expired speech",
    capturedAt: 1,
  });
  store.db
    .prepare("INSERT INTO chat_context_summaries VALUES(?, '{}',1,0)")
    .run(store.sessionId);
  store.db.exec(
    "CREATE TRIGGER fail_retention BEFORE DELETE ON transcripts BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
  );
  let resets = 0;
  store.on("reset", () => resets++);
  assert.throws(() => store.retention.purge(100), /fixture failure/);
  assert.equal(store.transcripts.count(), 1);
  assert(store.db.prepare("SELECT 1 FROM chat_context_summaries").get());
  assert.equal(resets, 0);
  store.db.exec("DROP TRIGGER fail_retention;");
  assert.equal(store.retention.purge(100), true);
  assert.equal(resets, 1);
  assert.equal(store.retention.purge(100), false);
  assert.equal(resets, 1);
});
test("fresh identity disclosure survives cleanup while deleted actor names are removed", (t) => {
  const store = fixture(t);
  for (const [id, received] of [
    ["old", 1],
    ["fresh", Date.now()],
  ] as const) {
    store.db
      .prepare("INSERT INTO actors_private VALUES(?,?,?,?,?)")
      .run(id, store.sessionId, "experiment", id, `Synthetic ${id}`);
    store.db
      .prepare(
        "INSERT INTO messages(id,session,actor,platform,channel,source_id,received,seq) VALUES(?,?,?,'experiment','fixture',?,?,1)",
      )
      .run(id, store.sessionId, id, id, received);
  }
  store.reveal();
  assert.equal(store.retention.purge(100), true);
  assert.equal(store.originsRevealed(), true);
  const payload = String(
    store.db
      .prepare("SELECT payload FROM events WHERE type='identity.revealed'")
      .get()!.payload,
  );
  assert.equal(payload.includes("Synthetic old"), false);
  assert.equal(payload.includes("Synthetic fresh"), true);
  assert.equal(store.retention.purge(100), false);
});
test("invalid cutoffs are rejected before any cleanup", (t) => {
  const store = fixture(t);
  for (const value of [NaN, Infinity, -Infinity])
    assert.throws(
      () => store.retention.purge(value),
      /Invalid retention cutoff/,
    );
  assert.equal(store.closed(), false);
});
