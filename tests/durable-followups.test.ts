import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../packages/storage.ts";
import { Participation } from "../packages/infrastructure/participation/runtime.ts";
import { createRightsService } from "../packages/infrastructure/rights/sqlite.ts";
import { WithdrawalFollowups } from "../packages/application/rights/withdrawal-followups.ts";
import {
  approvedProfile,
  activateFixture,
  privacyMessage,
} from "./privacy-fixtures.ts";
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "durable-followup-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const broadcastPath = join(directory, "broadcast.sqlite"),
    rightsPath = join(directory, "rights.sqlite");
  const participation = new Participation(approvedProfile(), "");
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const advance = () => ++now;
  const store = new Store(broadcastPath, participation);
  const person = activateFixture(store, "viewer", advance);
  store.ingestBatch([
    privacyMessage("viewer", "PRIVATE_SYNTHETIC_CHAT", advance()),
  ]);
  return { store, participation, person, broadcastPath, rightsPath };
}
test("follow-up persistence failure rolls back consent invalidation and local erasure together", (t) => {
  const { store, participation, person } = fixture(t);
  t.after(() => store.close());
  store.db.exec(
    "CREATE TRIGGER fail_queue BEFORE INSERT ON rights_followup_outbox BEGIN SELECT RAISE(ABORT,'synthetic queue failure'); END;",
  );
  assert.throws(
    () => participation.blockAge(person.id),
    /synthetic queue failure/,
  );
  assert.equal(person.state, "ACTIVE");
  assert.equal(store.snapshot().messages.length, 1);
  assert.equal(store.rightsFollowups.count(), 0);
  store.db.exec("DROP TRIGGER fail_queue");
  participation.blockAge(person.id);
  assert.equal(store.snapshot().messages.length, 0);
  assert.equal(store.rightsFollowups.count(), 1);
  assert(
    !JSON.stringify(store.rightsFollowups.entries()).includes(
      "PRIVATE_SYNTHETIC_CHAT",
    ),
  );
});
test("rights-storage failure survives broadcast end and process recreation without retaining chat", (t) => {
  const { store, participation, person, broadcastPath, rightsPath } =
    fixture(t);
  participation.blockAge(person.id);
  const failed = new WithdrawalFollowups(
    {
      createFollowup: () => {
        throw new Error("fixture unavailable");
      },
      attachRequest: () => {},
    },
    store.rightsFollowups,
    randomUUID,
  );
  failed.flush();
  assert.equal(failed.pendingCount, 1);
  store.closeSession();
  failed.clear();
  store.close();
  const reopened = new Store(
    broadcastPath,
    new Participation(approvedProfile(), ""),
  );
  const rights = createRightsService(rightsPath);
  t.after(() => {
    reopened.close();
    rights.close();
  });
  assert.equal(reopened.closed(), true);
  assert.equal(reopened.snapshot().messages.length, 0);
  const recovered = new WithdrawalFollowups(
    rights,
    reopened.rightsFollowups,
    randomUUID,
  );
  assert.equal(recovered.pendingCount, 1);
  recovered.flush();
  assert.equal(recovered.pendingCount, 0);
  assert.equal(rights.list().length, 1);
  assert.equal(rights.list()[0].appDone, true);
});
for (const removed of [false, true])
  test(`retry after rights commit and missing acknowledgement is idempotent (removed=${removed})`, (t) => {
    const { store, participation, person, broadcastPath, rightsPath } =
      fixture(t);
    let rights = createRightsService(rightsPath);
    participation.blockAge(person.id);
    store.db.exec(
      "CREATE TRIGGER fail_ack BEFORE DELETE ON rights_followup_outbox BEGIN SELECT RAISE(ABORT,'synthetic ack failure'); END;",
    );
    const first = new WithdrawalFollowups(
      rights,
      store.rightsFollowups,
      randomUUID,
    );
    first.flush();
    assert.equal(first.pendingCount, 1);
    assert.equal(rights.list().length, 1);
    const id = rights.list()[0].id;
    if (removed) {
      rights.update(id, {
        state: "completed",
        appDone: true,
        providerDone: true,
        videoDone: true,
        copiesDone: true,
        outcome: "deleted",
      });
      rights.remove(id);
    }
    store.close();
    rights.close();
    const reopened = new Store(
      broadcastPath,
      new Participation(approvedProfile(), ""),
    );
    rights = createRightsService(rightsPath);
    t.after(() => {
      reopened.close();
      rights.close();
    });
    reopened.db.exec("DROP TRIGGER fail_ack");
    const recovered = new WithdrawalFollowups(
      rights,
      reopened.rightsFollowups,
      randomUUID,
    );
    recovered.flush();
    recovered.flush();
    assert.equal(recovered.pendingCount, 0);
    assert.equal(rights.list().length, removed ? 0 : 1);
    if (!removed) assert.equal(rights.list()[0].id, id);
  });
