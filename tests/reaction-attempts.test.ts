import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage.ts";
import { createBroadcastCast } from "../packages/infrastructure/cast/runtime.ts";
function fixture(t: { after(fn: () => void): void }) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const cast = createBroadcastCast(store, () => "Synthetic fixture");
  cast.prepare();
  const runtime = store.personaRuntime()!,
    member = runtime.members[0];
  const input = {
    id: "attempt",
    sessionId: runtime.id,
    memberId: member.id,
    eventIds: [],
    cutoff: 0,
    sessionEpoch: runtime.controlEpoch,
    memberEpoch: member.epoch,
    definitionHash: member.hash,
    configRevision: runtime.configRevision,
  };
  const row = () =>
    store.db
      .prepare(
        "SELECT state,result,model_manifest FROM persona_reaction_attempts WHERE id=?",
      )
      .get(input.id);
  return { store, cast, runtime, member, input, row };
}
test("attempt reservation is idempotent for the same member and context", (t) => {
  const f = fixture(t);
  assert.equal(f.store.attempts.begin(f.input), true);
  assert.equal(f.store.attempts.begin({ ...f.input, id: "duplicate" }), false);
  assert.equal(
    f.store.attempts.begin({
      ...f.input,
      id: "fresh",
      eventIds: ["new-speech"],
    }),
    true,
  );
});
for (const field of [
  "sessionId",
  "memberId",
  "sessionEpoch",
  "memberEpoch",
  "definitionHash",
  "configRevision",
] as const) {
  test("attempt reservation rejects a stale " + field, (t) => {
    const f = fixture(t),
      input = { ...f.input };
    if (typeof input[field] === "number")
      Object.assign(input, { [field]: Number(input[field]) + 1 });
    else Object.assign(input, { [field]: "stale" });
    assert.equal(f.store.attempts.begin(input), false);
    assert.equal(f.row(), undefined);
  });
}
test("muted, absent, disarmed and closed casts cannot reserve model work", (t) => {
  const f = fixture(t);
  f.store.db
    .prepare("UPDATE persona_cast SET muted=1 WHERE member_id=?")
    .run(f.member.id);
  assert.equal(f.store.attempts.begin(f.input), false);
  f.store.db
    .prepare(
      "UPDATE persona_cast SET muted=0,status='absent' WHERE member_id=?",
    )
    .run(f.member.id);
  assert.equal(f.store.attempts.begin(f.input), false);
  f.store.db
    .prepare("UPDATE persona_cast SET status='present' WHERE member_id=?")
    .run(f.member.id);
  f.cast.stopActive();
  assert.equal(f.store.attempts.begin(f.input), false);
  f.cast.prepare();
  const updated = f.store.personaRuntime()!;
  f.store.closeSession();
  assert.equal(
    f.store.attempts.begin({ ...f.input, sessionEpoch: updated.controlEpoch }),
    false,
  );
});
test("stale member results cannot become candidates and can still be canceled", (t) => {
  const f = fixture(t);
  f.store.attempts.begin(f.input);
  f.store.db
    .prepare("UPDATE persona_cast SET epoch=epoch+1 WHERE member_id=?")
    .run(f.member.id);
  assert.equal(
    f.store.attempts.finish(f.input.id, "candidate", null, { text: "late" }),
    false,
  );
  assert.equal(f.row()!.state, "generating");
  assert.equal(
    f.store.attempts.finish(f.input.id, "canceled", "member_changed"),
    true,
  );
  assert.equal(
    f.store.attempts.finish(
      f.input.id,
      "candidate",
      null,
      { text: "late" },
      { private: "late" },
    ),
    false,
  );
  assert.equal(f.row()!.state, "canceled");
  assert.equal(f.row()!.result, null);
  assert.equal(f.row()!.model_manifest, null);
});
test("dispatching attempts cannot regress to candidates", (t) => {
  const f = fixture(t);
  f.store.attempts.begin(f.input);
  assert.equal(
    f.store.attempts.finish(f.input.id, "candidate", null, {
      text: "candidate",
    }),
    true,
  );
  f.store.db
    .prepare(
      "UPDATE persona_reaction_attempts SET state='dispatching' WHERE id=?",
    )
    .run(f.input.id);
  assert.equal(
    f.store.attempts.finish(f.input.id, "candidate", null, {
      text: "overwrite",
    }),
    false,
  );
  assert.equal(f.row()!.state, "dispatching");
  assert.equal(JSON.parse(String(f.row()!.result)).text, "candidate");
});
test("attempt completion cannot write across the current broadcast boundary", (t) => {
  const f = fixture(t);
  f.store.attempts.begin(f.input);
  const previous = f.store.sessionId;
  f.store.sessionId = "other";
  assert.equal(f.store.attempts.finish(f.input.id, "failed", "late"), false);
  assert.equal(f.row()!.state, "generating");
  f.store.sessionId = previous;
});
