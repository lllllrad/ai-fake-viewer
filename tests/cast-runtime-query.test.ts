import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage.ts";
import { createBroadcastCast } from "../packages/infrastructure/cast/runtime.ts";
function fixture(t: TestContext) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  createBroadcastCast(store, () => "Synthetic fixture").prepare();
  const runtime = store.personaRuntime()!;
  return { store, runtime };
}
test("six-member runtime uses a fixed five-query snapshot instead of per-member history reads", (t) => {
  const f = fixture(t);
  let queries = 0;
  const prepare = f.store.db.prepare.bind(f.store.db);
  t.mock.method(f.store.db, "prepare", (sql: string) => {
    queries++;
    return prepare(sql);
  });
  const runtime = f.store.personaRuntime()!;
  assert.equal(runtime.members.length, 6);
  assert.equal(queries, 5);
  assert(runtime.members.every((member) => member.presence.length === 1));
  assert(runtime.members.every((member) => member.lastPublishedAt === null));
});
test("batched cast statistics keep visible speech timestamps and leading consecutive counts", (t) => {
  const { store, runtime } = fixture(t);
  const [a, b] = runtime.members;
  const publish = (member: typeof a, time: number) => {
    const id = store.publishSynthetic({
      actor: "persona-" + member.id,
      name: member.displayName,
      text: "Synthetic contribution " + time,
      replyToId: null,
      sourceMessageIds: [],
    });
    assert(id);
    store.db.prepare("UPDATE messages SET received=? WHERE id=?").run(time, id);
    return id;
  };
  publish(b, 1000);
  publish(a, 2000);
  publish(a, 3000);
  const hidden = publish(b, 4000);
  store.db.prepare("UPDATE messages SET hidden=1 WHERE id=?").run(hidden);
  const current = store.personaRuntime()!;
  assert.equal(current.members[0].lastPublishedAt, 3000);
  assert.equal(current.members[0].consecutiveMessages, 2);
  assert.equal(current.members[1].lastPublishedAt, 1000);
  assert.equal(current.members[1].consecutiveMessages, 0);
});
test("runtime excludes muted and absent members and preserves ordered presence intervals", (t) => {
  const { store, runtime } = fixture(t),
    [a, b, c] = runtime.members;
  store.db
    .prepare("UPDATE persona_cast SET muted=1 WHERE member_id=?")
    .run(b.id);
  store.db
    .prepare("UPDATE persona_cast SET status='departed' WHERE member_id=?")
    .run(c.id);
  store.db
    .prepare("INSERT INTO persona_presence VALUES(?,?,2,2000,20,NULL,NULL)")
    .run(runtime.id, a.id);
  const current = store.personaRuntime()!;
  assert.equal(current.members.length, 4);
  assert.equal(current.members[0].presence.length, 2);
  assert.equal(current.members[0].presence[1].joined_after_seq, 20);
});
test("runtime cannot expose another broadcast or a closed broadcast with inconsistent cast flags", (t) => {
  const { store } = fixture(t),
    id = store.sessionId;
  store.sessionId = "other";
  assert.equal(store.personaRuntime(), null);
  store.sessionId = id;
  store.db.prepare("UPDATE sessions SET closed=1 WHERE id=?").run(id);
  assert.equal(store.personaRuntime(), null);
});
test("invalid persisted cast definitions are rejected at the runtime boundary", (t) => {
  const { store, runtime } = fixture(t);
  store.db
    .prepare(
      "UPDATE persona_cast SET definition_snapshot='{}' WHERE member_id=?",
    )
    .run(runtime.members[0].id);
  assert.throws(() => store.personaRuntime());
});
