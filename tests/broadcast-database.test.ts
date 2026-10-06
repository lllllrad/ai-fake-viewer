import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initializeBroadcastDatabase } from "../packages/infrastructure/storage/initialize.ts";
import { broadcastSchemaVersion } from "../packages/infrastructure/storage/schema.ts";
const clock = { now: () => 1_000_000, id: () => "broadcast-fixture" };
function fixture(t: TestContext) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  return database;
}
const version = (database: DatabaseSync) =>
  database.prepare("PRAGMA user_version").get()!.user_version;
test("initialization creates a private broadcast schema and reuses its latest session", (t) => {
  const database = fixture(t);
  assert.equal(
    initializeBroadcastDatabase(database, clock),
    "broadcast-fixture",
  );
  assert.equal(version(database), broadcastSchemaVersion);
  assert.equal(
    database.prepare("PRAGMA secure_delete").get()!.secure_delete,
    1,
  );
  assert.equal(database.prepare("PRAGMA busy_timeout").get()!.timeout, 5000);
  database
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run("closed-fixture", clock.now(), clock.now());
  assert.equal(
    initializeBroadcastDatabase(database, {
      ...clock,
      id: () => {
        throw Error("must reuse");
      },
    }),
    "closed-fixture",
  );
  assert.equal(
    database
      .prepare("SELECT closed FROM sessions WHERE id='closed-fixture'")
      .get()!.closed,
    clock.now(),
  );
});
test("future database versions are rejected without creating or changing tables", (t) => {
  const database = fixture(t);
  database.exec(
    "CREATE TABLE future_marker(value TEXT); INSERT INTO future_marker VALUES('synthetic'); PRAGMA user_version=999;",
  );
  const schema = database
    .prepare("SELECT * FROM sqlite_master ORDER BY name")
    .all();
  assert.throws(
    () => initializeBroadcastDatabase(database, clock),
    /newer application/,
  );
  assert.deepEqual(
    database.prepare("SELECT * FROM sqlite_master ORDER BY name").all(),
    schema,
  );
  assert.equal(version(database), 999);
  assert.equal(
    database.prepare("SELECT value FROM future_marker").get()!.value,
    "synthetic",
  );
});
test("failure after schema creation rolls back DDL and version together", (t) => {
  const database = fixture(t);
  database.exec(
    "CREATE TABLE retained_fixture(value TEXT); INSERT INTO retained_fixture VALUES('retained'); PRAGMA user_version=2;",
  );
  const schema = database
    .prepare("SELECT * FROM sqlite_master ORDER BY name")
    .all();
  assert.throws(
    () =>
      initializeBroadcastDatabase(database, {
        ...clock,
        id: () => {
          throw Error("fixture recovery failure");
        },
      }),
    /fixture recovery failure/,
  );
  assert.deepEqual(
    database.prepare("SELECT * FROM sqlite_master ORDER BY name").all(),
    schema,
  );
  assert.equal(version(database), 2);
  assert.equal(
    database.prepare("SELECT value FROM retained_fixture").get()!.value,
    "retained",
  );
  assert.equal(
    initializeBroadcastDatabase(database, clock),
    "broadcast-fixture",
  );
});
function seedLive(database: DatabaseSync) {
  database.exec(`INSERT INTO persona_sessions(id,source_session,revision,brief,policy,state,armed,control_epoch,created,updated)
    VALUES('cast-fixture','broadcast-fixture',1,'{}','{}','live',1,4,1,1);
    INSERT INTO persona_reaction_attempts(id,session_id,member_id,event_ids,context_cutoff,session_epoch,member_epoch,definition_hash,config_revision,state,started_at,context_key)
    VALUES('attempt-fixture','cast-fixture','member-fixture','[]',1,4,0,'hash',1,'candidate',1,'context');
    INSERT INTO runtime_flags VALUES('ai_desired_running','1');
    INSERT INTO transcripts VALUES('speech-fixture','broadcast-fixture',1,'Synthetic speech');`);
}
test("restart cancels old work and advances cast epochs while preserving AI intent and speech", (t) => {
  const database = fixture(t);
  initializeBroadcastDatabase(database, clock);
  seedLive(database);
  initializeBroadcastDatabase(database, clock);
  assert.equal(
    database.prepare("SELECT control_epoch FROM persona_sessions").get()!
      .control_epoch,
    5,
  );
  const attempt = database
    .prepare("SELECT state,reason,finished_at FROM persona_reaction_attempts")
    .get()!;
  assert.deepEqual(
    { ...attempt },
    { state: "canceled", reason: "server_restart", finished_at: clock.now() },
  );
  assert.equal(
    database
      .prepare("SELECT value FROM runtime_flags WHERE key='ai_desired_running'")
      .get()!.value,
    "1",
  );
  assert.equal(
    database.prepare("SELECT text FROM transcripts").get()!.text,
    "Synthetic speech",
  );
});
test("failed recovery leaves cast epochs and unfinished work unchanged", (t) => {
  const database = fixture(t);
  initializeBroadcastDatabase(database, clock);
  seedLive(database);
  database.exec(
    "PRAGMA user_version=2; CREATE TRIGGER fail_recovery BEFORE UPDATE ON persona_reaction_attempts BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
  );
  assert.throws(
    () => initializeBroadcastDatabase(database, clock),
    /fixture failure/,
  );
  assert.equal(
    database.prepare("SELECT control_epoch FROM persona_sessions").get()!
      .control_epoch,
    4,
  );
  assert.equal(
    database.prepare("SELECT state FROM persona_reaction_attempts").get()!
      .state,
    "candidate",
  );
  assert.equal(version(database), 2);
  database.exec("DROP TRIGGER fail_recovery;");
  initializeBroadcastDatabase(database, clock);
  assert.equal(
    database.prepare("SELECT control_epoch FROM persona_sessions").get()!
      .control_epoch,
    5,
  );
});
test("historical attempt keys are upgraded without interpreting the original CREATE text", (t) => {
  const database = fixture(t);
  database.exec(`create table 'persona_reaction_attempts' (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, member_id TEXT NOT NULL,
    event_ids TEXT NOT NULL, context_cutoff INTEGER NOT NULL, session_epoch INTEGER NOT NULL,
    member_epoch INTEGER NOT NULL, definition_hash TEXT NOT NULL, config_revision INTEGER NOT NULL,
    state TEXT NOT NULL, reason TEXT, started_at INTEGER NOT NULL, finished_at INTEGER,
    model_manifest TEXT, result TEXT, public_message_id TEXT,
    UNIQUE (session_id, member_id, context_cutoff));
    INSERT INTO persona_reaction_attempts VALUES('old','cast','member','[]',42,0,0,'hash',1,'published',NULL,1,2,'{"inputMessages":["source-fixture"]}','{"text":"Synthetic"}','public-fixture');
    PRAGMA user_version=2;`);
  initializeBroadcastDatabase(database, clock);
  const row = database
    .prepare("SELECT context_key,state,result FROM persona_reaction_attempts")
    .get()!;
  assert.deepEqual(
    { ...row },
    {
      context_key: "legacy:42",
      state: "published",
      result: '{"text":"Synthetic"}',
    },
  );
  const source = database.prepare("SELECT * FROM ai_message_context").get()!;
  assert.deepEqual(
    { ...source },
    { message_id: "public-fixture", source_message_id: "source-fixture" },
  );
  initializeBroadcastDatabase(database, clock);
  assert.equal(
    database.prepare("SELECT COUNT(*) n FROM ai_message_context").get()!.n,
    1,
  );
});
