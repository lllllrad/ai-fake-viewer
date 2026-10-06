import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage.ts";
import { Participation } from "../packages/infrastructure/participation/runtime.ts";
import {
  approvedProfile,
  activateFixture,
  privacyMessage,
} from "./privacy-fixtures.ts";
function fixture(t: TestContext) {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const participation = new Participation(approvedProfile(), "");
  const store = new Store(":memory:", participation);
  t.after(() => store.close());
  activateFixture(store, "viewer", (ms) => (now += ms));
  store.ingestBatch([
    privacyMessage("viewer", "Synthetic lifetime fixture", ++now),
  ]);
  store.transcripts.record({
    id: "speech",
    text: "Synthetic speech",
    capturedAt: now,
  });
  assert.equal(store.snapshot().messages.length, 1);
  store.setAiDesiredRunning(true);
  store.readerCollisionNames.add("fixture-name");
  return { store, participation };
}
test("live replacement commits one open session and resets readers once", (t) => {
  const { store, participation } = fixture(t);
  const previous = store.sessionId;
  let resets = 0;
  store.on("reset", () => {
    resets++;
    assert.notEqual(store.sessionId, previous);
    assert.equal(store.closed(), false);
    assert.equal(store.snapshot().messages.length, 0);
    assert.equal(participation.ended, false);
  });
  store.lifetime.createNext();
  assert.equal(resets, 1);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM sessions").get()!.n, 1);
  assert.equal(store.transcripts.count(), 0);
  assert.equal(participation.participants.size, 0);
  assert.equal(store.aiDesiredRunning(), false);
  assert.equal(store.readerCollisionNames.size, 0);
});
test("failed replacement restores deleted rows, live participant references and AI intent", (t) => {
  const { store, participation } = fixture(t);
  const session = store.sessionId;
  const participant = participation.get("youtube", "fixture", "viewer")!;
  const snapshot = participation.snapshot();
  let resets = 0;
  store.on("reset", () => resets++);
  store.db.exec(
    "CREATE TRIGGER fail_snapshot BEFORE UPDATE ON runtime_flags WHEN NEW.key='participation' BEGIN SELECT RAISE(ABORT,'fixture snapshot failure'); END;",
  );
  assert.throws(() => store.lifetime.createNext(), /fixture snapshot failure/);
  store.db.exec("DROP TRIGGER fail_snapshot");
  assert.equal(resets, 0);
  assert.equal(store.sessionId, session);
  assert.equal(store.closed(), false);
  assert.equal(participation.get("youtube", "fixture", "viewer"), participant);
  assert.deepEqual(participation.snapshot(), snapshot);
  assert.equal(store.snapshot().messages.length, 1);
  assert.equal(store.transcripts.count(), 1);
  assert.equal(store.aiDesiredRunning(), true);
  assert(store.readerCollisionNames.has("fixture-name"));
});
test("broadcast end is idempotent and leaves a closed marker", (t) => {
  const { store, participation } = fixture(t);
  let resets = 0;
  store.on("reset", () => resets++);
  store.lifetime.end();
  const marker = store.sessionId;
  store.lifetime.end();
  assert.equal(store.sessionId, marker);
  assert.equal(resets, 1);
  assert.equal(store.closed(), true);
  assert.equal(participation.ended, true);
  assert.equal(store.transcripts.count(), 0);
});
test("nested lifetime replacement emits nothing and restores memory on outer rollback", (t) => {
  const { store, participation } = fixture(t);
  const session = store.sessionId;
  let resets = 0;
  store.on("reset", () => resets++);
  assert.throws(
    () =>
      store.transaction(() => {
        store.lifetime.createNext();
        assert.equal(resets, 0);
        throw Error("outer failure");
      }),
    /outer failure/,
  );
  assert.equal(store.sessionId, session);
  assert.equal(participation.ended, false);
  assert.equal(store.snapshot().messages.length, 1);
  assert.equal(resets, 0);
});
test("reader notification failure cannot undo a committed broadcast end", (t) => {
  const { store } = fixture(t);
  store.on("reset", () => {
    throw Error("fixture reader failure");
  });
  assert.throws(
    () => store.lifetime.end(),
    /Committed broadcast notification failed/,
  );
  assert.equal(store.closed(), true);
  assert.equal(store.snapshot().messages.length, 0);
  assert.equal(store.transcripts.count(), 0);
  store.lifetime.end();
});
test("reference session creation failure does not leave the old session closed", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const session = store.sessionId;
  store.setAiDesiredRunning(true);
  let events = 0;
  store.on("event", () => events++);
  store.db.exec(
    "CREATE TRIGGER fail_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'fixture session failure'); END;",
  );
  assert.throws(() => store.lifetime.createNext(), /fixture session failure/);
  assert.equal(store.sessionId, session);
  assert.equal(store.closed(), false);
  assert.equal(store.aiDesiredRunning(), true);
  assert.equal(events, 0);
});
