import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage.ts";
import { PersonaService } from "../packages/persona/service.ts";
import { configSchema } from "../packages/config.ts";
function fixture(t: TestContext) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const service = new PersonaService(store, undefined, configSchema.parse({}));
  const cast = service.ensureAutomaticCast();
  service.arm(cast.id, cast.control_epoch);
  const runtime = store.personaRuntime()!;
  for (const [index, state] of [
    "generating",
    "candidate",
    "dispatching",
    "published",
  ].entries()) {
    const member = runtime.members[index];
    store.beginPersonaAttempt({
      id: `attempt-${index}`,
      sessionId: runtime.id,
      memberId: member.id,
      eventIds: [],
      cutoff: index,
      sessionEpoch: runtime.controlEpoch,
      memberEpoch: member.epoch,
      definitionHash: member.hash,
      configRevision: runtime.configRevision,
    });
    store.db
      .prepare("UPDATE persona_reaction_attempts SET state=? WHERE id=?")
      .run(state, `attempt-${index}`);
  }
  return { store, service, cast };
}
test("cast stop atomically advances execution epoch and cancels only unfinished attempts", (t) => {
  const { store, service, cast } = fixture(t);
  const stopped = service.stopActive("fixture_stop")!;
  assert.equal(stopped.armed, false);
  assert.equal(stopped.control_epoch, cast.control_epoch + 1);
  const rows = store.db
    .prepare("SELECT state,reason FROM persona_reaction_attempts ORDER BY id")
    .all();
  assert.deepEqual(
    rows.map((row) => row.state),
    ["canceled", "canceled", "canceled", "published"],
  );
  assert(rows.slice(0, 3).every((row) => row.reason === "fixture_stop"));
  assert.throws(
    () => service.arm(cast.id, cast.control_epoch),
    /STALE_CONTROL_EPOCH/,
  );
  service.arm(cast.id, stopped.control_epoch);
  assert.equal(store.personaRuntime()?.armed, true);
  assert.equal(
    store.db
      .prepare(
        "SELECT state FROM persona_reaction_attempts WHERE id='attempt-2'",
      )
      .get()?.state,
    "canceled",
  );
});
for (const failure of ["cancellation", "audit"] as const)
  test(`failed ${failure} rolls back cast stop and every attempt transition`, (t) => {
    const { store, service, cast } = fixture(t);
    const before = service.getSession(cast.id);
    const attempts = store.db
      .prepare("SELECT * FROM persona_reaction_attempts ORDER BY id")
      .all();
    const target =
      failure === "cancellation"
        ? "BEFORE UPDATE ON persona_reaction_attempts"
        : "BEFORE INSERT ON persona_audit";
    store.db.exec(
      `CREATE TRIGGER fail_cast ${target} BEGIN SELECT RAISE(ABORT,'synthetic stop failure'); END;`,
    );
    assert.throws(() => service.stopActive(), /synthetic stop failure/);
    assert.deepEqual(service.getSession(cast.id), before);
    assert.deepEqual(
      store.db
        .prepare("SELECT * FROM persona_reaction_attempts ORDER BY id")
        .all(),
      attempts,
    );
    store.db.exec("DROP TRIGGER fail_cast");
    assert.equal(service.stopActive()?.armed, false);
  });
test("an arm audit failure leaves the cast disabled", (t) => {
  const { store, service } = fixture(t);
  const stopped = service.stopActive()!;
  store.db.exec(
    "CREATE TRIGGER fail_arm BEFORE INSERT ON persona_audit BEGIN SELECT RAISE(ABORT,'synthetic arm failure'); END;",
  );
  assert.throws(
    () => service.arm(stopped.id, stopped.control_epoch),
    /synthetic arm failure/,
  );
  assert.equal(store.personaRuntime()?.armed, false);
});
test("cast controls reject foreign broadcasts and cannot arm a closed broadcast", (t) => {
  const { store, service, cast } = fixture(t);
  store.db
    .prepare("UPDATE persona_sessions SET source_session='foreign' WHERE id=?")
    .run(cast.id);
  assert.throws(
    () => service.arm(cast.id, cast.control_epoch),
    /SESSION_NOT_FOUND/,
  );
  assert.throws(() => service.stop(cast.id), /SESSION_NOT_FOUND/);
  assert.equal(service.stopActive(), null);
  store.db
    .prepare("UPDATE persona_sessions SET source_session=? WHERE id=?")
    .run(store.sessionId, cast.id);
  store.db
    .prepare("UPDATE sessions SET closed=1 WHERE id=?")
    .run(store.sessionId);
  assert.throws(
    () => service.arm(cast.id, cast.control_epoch),
    /SESSION_CLOSED/,
  );
});
