import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../packages/storage.ts";
import { Participation } from "../packages/infrastructure/participation/runtime.ts";
import {
  approvedProfile,
  activateFixture,
  privacyMessage,
} from "./privacy-fixtures.ts";
import type { Incoming } from "../packages/contracts/incoming.ts";

function fixture(t: TestContext) {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const advance = (ms = 1) => (now += ms);
  const directory = mkdtempSync(join(tmpdir(), "participation-transaction-"));
  const path = join(directory, "broadcast.sqlite");
  const participation = new Participation(approvedProfile(), "");
  const store = new Store(path, participation);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const person = activateFixture(store, "viewer", advance);
  store.ingestBatch([
    privacyMessage("viewer", "SYNTHETIC_PRIVATE_CONTEXT", advance()),
  ]);
  return { participation, store, person, advance, path };
}
test("age blocking commits invalidation and raw deletion before publishing follow-up work", (t) => {
  const { participation, store, person, path } = fixture(t);
  const prior = structuredClone(person);
  const effects: string[] = [];
  participation.onWithdraw = () => {
    assert.equal(
      store.db.prepare("SELECT 1 FROM messages WHERE text<>''").get(),
      undefined,
    );
    effects.push("withdrawn");
  };
  store.on("context_invalidated", () => effects.push("invalidated"));
  store.db.exec(
    "CREATE TRIGGER fail_erasure BEFORE UPDATE OF hidden ON messages BEGIN SELECT RAISE(ABORT,'synthetic erasure failure'); END;",
  );
  assert.throws(() => participation.blockAge(person.id), /synthetic erasure/);
  assert.deepEqual(person, prior);
  assert.equal(participation.byId(person.id), person);
  assert.deepEqual(effects, []);
  assert.equal(store.snapshot().messages.length, 1);
  const reloaded = new Store(path, new Participation(approvedProfile(), ""));
  assert.equal(reloaded.participation!.byId(person.id).state, "ACTIVE");
  assert.equal(reloaded.snapshot().messages.length, 1);
  reloaded.close();
  store.db.exec("DROP TRIGGER fail_erasure");
  participation.blockAge(person.id);
  assert.deepEqual(effects, ["withdrawn", "invalidated"]);
  assert.equal(person.age, "blocked");
  assert.equal(store.snapshot().messages.length, 0);
  const committed = new Store(path, new Participation(approvedProfile(), ""));
  assert.equal(committed.participation!.byId(person.id).age, "blocked");
  assert.equal(committed.snapshot().messages.length, 0);
  committed.close();
});
test("a rejected ingestion batch restores live consent references and suppresses withdrawal effects", (t) => {
  const { participation, store, person, advance } = fixture(t);
  const prior = structuredClone(person),
    revision = participation.revision;
  let notifications = 0;
  participation.onWithdraw = () => notifications++;
  store.on("context_invalidated", () => notifications++);
  assert.throws(() =>
    store.ingestBatch([
      privacyMessage("viewer", "!철회", advance()),
      { platform: "invalid" } as unknown as Incoming,
    ]),
  );
  assert.deepEqual(person, prior);
  assert.equal(participation.revision, revision);
  assert.equal(notifications, 0);
  assert.equal(store.snapshot().messages.length, 1);
  store.ingestBatch([privacyMessage("viewer", "!철회", advance())]);
  assert.equal(notifications, 2);
  assert.equal(person.state, "WITHDRAWN");
  assert.equal(store.snapshot().messages.length, 0);
});
test("failed profile replacement restores the profile, every participant and their context", (t) => {
  const { participation, store, person } = fixture(t);
  const fingerprint = participation.fingerprint,
    before = participation.snapshot();
  store.db.exec(
    "CREATE TRIGGER fail_participation_save BEFORE INSERT ON runtime_flags WHEN NEW.key='participation' BEGIN SELECT RAISE(ABORT,'synthetic snapshot failure'); END;",
  );
  assert.throws(
    () =>
      participation.replaceProfile({
        ...approvedProfile(),
        noticeVersion: "fixture-next",
      }),
    /synthetic snapshot/,
  );
  assert.equal(participation.fingerprint, fingerprint);
  assert.deepEqual(participation.snapshot(), before);
  assert.equal(participation.byId(person.id), person);
  assert.equal(store.snapshot().messages.length, 1);
  store.db.exec("DROP TRIGGER fail_participation_save");
  participation.replaceProfile({
    ...approvedProfile(),
    noticeVersion: "fixture-next",
  });
  assert.equal(person.state, "WITHDRAWN");
  assert.equal(store.snapshot().messages.length, 0);
});
test("a failed broadcast end restores session identity and participation before retry", (t) => {
  const { participation, store, person } = fixture(t);
  const id = store.sessionId;
  store.db.exec(
    "CREATE TRIGGER fail_session_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'synthetic session failure'); END;",
  );
  assert.throws(() => store.deleteAll(true), /synthetic session/);
  assert.equal(store.sessionId, id);
  assert.equal(participation.sessionId, id);
  assert.equal(participation.ended, false);
  assert.equal(participation.byId(person.id), person);
  assert.equal(person.state, "ACTIVE");
  assert.equal(store.snapshot().messages.length, 1);
  store.db.exec("DROP TRIGGER fail_session_delete");
  store.deleteAll(true);
  assert.equal(store.closed(), true);
  assert.equal(participation.participants.size, 0);
});
