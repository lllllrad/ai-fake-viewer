import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AutomaticCast } from "../packages/application/cast/automatic.ts";
import { SqliteAutomaticCast } from "../packages/infrastructure/cast/automatic-sqlite.ts";
import {
  automaticDefinitions,
  researchBasis,
} from "../packages/persona/automatic.ts";
import { Store } from "../packages/storage.ts";
function fixture(t: TestContext) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const repository = new SqliteAutomaticCast(store.db, {
    sessionId: () => store.sessionId,
    closed: () => store.closed(),
    sequence: () => store.lastSeq(),
    id: randomUUID,
    now: () => 12345,
    transaction: (work) => store.transaction(work),
  });
  const composition = {
    cards: automaticDefinitions,
    researchBasis,
    id: randomUUID,
  };
  return {
    store,
    composition,
    service: new AutomaticCast(repository, composition),
  };
}
test("automatic preparation writes six present members without a manual authoring workflow", (t) => {
  const { store, service, composition } = fixture(t);
  const id = service.ensure("Synthetic topic");
  assert.equal(service.summary().length, 6);
  for (const table of ["persona_templates", "persona_jobs", "persona_reviews"])
    assert.equal(
      store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n,
      0,
    );
  assert.equal(
    store.db
      .prepare(
        "SELECT COUNT(*) n FROM persona_presence WHERE joined_at=12345 AND joined_after_seq=0 AND left_at IS NULL",
      )
      .get()?.n,
    6,
  );
  assert.equal(
    store.db
      .prepare(
        "SELECT COUNT(*) n FROM persona_cast WHERE status='present' AND epoch=1",
      )
      .get()?.n,
    6,
  );
  composition.cards = () => {
    assert.fail("must reuse existing cast");
  };
  assert.equal(service.ensure("Changed description"), id);
  assert.equal(store.personaRuntime()?.armed, false);
});
test("a failed presence write rolls back every automatic cast record before retry", (t) => {
  const { store, service } = fixture(t);
  store.db.exec(
    "CREATE TRIGGER fail_presence BEFORE INSERT ON persona_presence BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
  );
  assert.throws(() => service.ensure("Synthetic topic"), /synthetic failure/);
  for (const table of [
    "persona_sessions",
    "persona_versions",
    "persona_cast",
    "persona_presence",
    "persona_audit",
  ])
    assert.equal(
      store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n,
      0,
    );
  store.db.exec("DROP TRIGGER fail_presence");
  assert.ok(service.ensure("Synthetic topic"));
  assert.equal(service.summary().length, 6);
});
test("automatic names avoid normalized viewer and cast collisions without mutating source cards", (t) => {
  const { store, service, composition } = fixture(t);
  const cards = automaticDefinitions("Synthetic topic");
  cards.forEach((card) => {
    card.definition.display_name_suggestion = "Ａ B!";
  });
  store.db
    .prepare("INSERT INTO actors_private VALUES(?,?,?,?,?)")
    .run("fixture", store.sessionId, "youtube", "viewer", "ab");
  composition.cards = () => cards;
  service.ensure("Synthetic topic");
  const names = service.summary().map((member) => member.name);
  assert.equal(new Set(names).size, 6);
  assert(names.every((name) => name.startsWith("시청자")));
  assert(
    cards.every((card) => card.definition.display_name_suggestion === "Ａ B!"),
  );
});
test("duplicate identities and closed broadcasts cannot create an automatic cast", (t) => {
  const { store, service, composition } = fixture(t);
  const cards = automaticDefinitions("Synthetic topic");
  cards[1].definition.persona_id = cards[0].definition.persona_id;
  composition.cards = () => cards;
  assert.throws(
    () => service.ensure("Synthetic topic"),
    /DUPLICATE_CAST_IDENTITY/,
  );
  assert.equal(service.summary().length, 0);
  store.closeSession();
  assert.throws(() => service.ensure("Synthetic topic"), /SESSION_CLOSED/);
});
