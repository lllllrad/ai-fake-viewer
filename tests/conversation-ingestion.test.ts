import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage.ts";
import { Participation } from "../packages/infrastructure/participation/runtime.ts";
import { approvedProfile, privacyMessage } from "./privacy-fixtures.ts";
import { ConversationIngestion } from "../packages/application/conversation/ingestion.ts";
function fixture(t: TestContext, live = false) {
  const store = new Store(
    ":memory:",
    live ? new Participation(approvedProfile(), "") : undefined,
  );
  t.after(() => store.close());
  return store;
}
test("live admission does not write demo consent or emit demo notices", (t) => {
  const store = fixture(t, true);
  let notices = 0;
  store.on("consent_notice", () => notices++);
  store.ingestion.ingest([privacyMessage("viewer", "ordinary", Date.now())]);
  assert(store.participation!.get("youtube", "fixture", "viewer"));
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM consent_notice_targets").get()!.n,
    0,
  );
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM viewer_consents").get()!.n,
    0,
  );
  assert.equal(notices, 0);
  assert.equal(store.pendingConsentNotice("youtube", "fixture"), false);
});
test("invalid later input restores live admission and emits no partial events", (t) => {
  const store = fixture(t, true);
  const before = store.participation!.snapshot();
  assert.throws(() =>
    store.ingestion.ingest(
      [
        privacyMessage("viewer", "ordinary", Date.now()),
        privacyMessage("other", "", Date.now()),
      ],
      { key: "cursor", value: "next" },
    ),
  );
  assert.deepEqual(store.participation!.snapshot(), before);
  assert.equal(store.checkpoint("cursor"), undefined);
});
test("outer rollback restores reference notice claims and a retry emits exactly one notice", (t) => {
  const store = fixture(t);
  let notices = 0;
  store.on("consent_notice", () => notices++);
  assert.throws(
    () =>
      store.transaction(() => {
        store.ingestion.ingest([
          privacyMessage("viewer", "ordinary", Date.now()),
        ]);
        assert.equal(notices, 0);
        throw Error("fixture rollback");
      }),
    /fixture rollback/,
  );
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM consent_notice_state").get()!.n,
    0,
  );
  assert.equal(store.pendingConsentNotice("youtube", "fixture"), false);
  store.ingestion.ingest([privacyMessage("viewer", "ordinary", Date.now())]);
  assert.equal(notices, 1);
  store.ingestion.ingest([privacyMessage("viewer", "another", Date.now())]);
  assert.equal(notices, 1);
});
test("a failed reference notice claim rolls back both the waiting participant and cursor", (t) => {
  const store = fixture(t);
  store.db.exec(
    "CREATE TRIGGER fail_notice BEFORE INSERT ON consent_notice_state BEGIN SELECT RAISE(ABORT,'fixture notice failure'); END;",
  );
  let notices = 0;
  store.on("consent_notice", () => notices++);
  assert.throws(
    () =>
      store.ingestion.ingest(
        [privacyMessage("viewer", "ordinary", Date.now())],
        { key: "cursor", value: "next" },
      ),
    /fixture notice failure/,
  );
  assert.equal(store.pendingConsentNotice("youtube", "fixture"), false);
  assert.equal(store.checkpoint("cursor"), undefined);
  assert.equal(notices, 0);
});
test("reference consent commands remain excluded while withdrawal erases admitted text", (t) => {
  const store = fixture(t);
  store.ingestion.ingest([
    privacyMessage("viewer", "!동의", Date.now()),
    privacyMessage("viewer", "Synthetic admitted text", Date.now()),
  ]);
  assert.equal(store.snapshot().messages.length, 1);
  assert.equal(store.snapshot().messages[0]!.text, "Synthetic admitted text");
  let invalidated = 0;
  store.on("context_invalidated", () => invalidated++);
  store.ingestion.ingest([privacyMessage("viewer", "!철회", Date.now())]);
  assert.equal(store.snapshot().messages.length, 0);
  assert.equal(invalidated, 1);
});
test("ingestion passes admitted epochs and preserves removal sequence order", () => {
  const effects: Array<() => void> = [],
    published: number[] = [],
    epochs: number[] = [];
  let notices = 0,
    invalidated = 0;
  const service = new ConversationIngestion(
    {
      write: (_message, epoch) => {
        epochs.push(epoch);
        return 12;
      },
      checkpoint: () => {},
    },
    { run: (work) => work(), afterCommit: (effect) => effects.push(effect) },
    {
      closed: () => false,
      admit: () => ({
        allow: true,
        epoch: 7,
        removed: [11],
        invalidated: true,
      }),
      summary: () => {},
      claimNotices: () => [
        { platform: "youtube", channel: "fixture", occurredAt: 1 },
      ],
      refreshCollisions: () => false,
      invalidate: () => {
        invalidated++;
      },
      publish: (sequence) => published.push(sequence),
      notice: () => {
        notices++;
      },
      reset: () => {},
    },
  );
  assert.deepEqual(
    service.ingest([privacyMessage("viewer", "Synthetic", 1)]),
    [11, 12],
  );
  assert.deepEqual(epochs, [7]);
  assert.deepEqual(published, []);
  for (const effect of effects) effect();
  assert.deepEqual(published, [11, 12]);
  assert.equal(invalidated, 1);
  assert.equal(notices, 1);
});
