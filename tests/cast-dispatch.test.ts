import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  dispatchAllowed,
  type DispatchActivity,
} from "../packages/domain/reactions/dispatch.ts";
import { Store } from "../packages/storage.ts";
import { createBroadcastCast } from "../packages/infrastructure/cast/runtime.ts";
const activity = (): DispatchActivity => ({
  upstream: 0,
  synthetic: 0,
  reservations: 1,
  globalGapCount: 0,
  memberCooldownCount: 0,
  inflight: 1,
  latestAuthors: [],
  memberAuthor: "persona-fixture",
  evidenceAvailable: true,
  proposed: "A synthetic viewer contribution",
  priorTexts: [],
});
test("dispatch includes existing reservations without double-counting the current candidate", () => {
  const a = activity(),
    policy = { global_hard_cap_messages_per_window: 4 };
  a.synthetic = 3;
  assert.equal(dispatchAllowed(policy, a), true);
  a.reservations++;
  assert.equal(dispatchAllowed(policy, a), false);
});
test("dispatch preserves cooldown, inflight, consecutive speaker and evidence gates", () => {
  for (const change of [
    { globalGapCount: 1 },
    { memberCooldownCount: 1 },
    { inflight: 3 },
    { latestAuthors: ["persona-fixture", "persona-fixture"] },
    { evidenceAvailable: false },
    { proposed: " " },
  ])
    assert.equal(dispatchAllowed({}, { ...activity(), ...change }), false);
});
test("dispatch uses upstream activity bands and Unicode-normalized long-text deduplication", () => {
  assert.equal(
    dispatchAllowed(
      {
        upstream_activity_bands: [
          {
            min_messages: 0,
            max_messages: null,
            ai_cap_messages_per_window: 0,
          },
        ],
      },
      activity(),
    ),
    false,
  );
  assert.equal(
    dispatchAllowed(
      {},
      {
        ...activity(),
        proposed: "Repeated Long Message!",
        priorTexts: ["repeated long message"],
      },
    ),
    false,
  );
  assert.equal(
    dispatchAllowed({}, { ...activity(), proposed: "Hi!", priorTexts: ["hi"] }),
    true,
  );
});
function fixture(t: TestContext, eventIds: string[] = []) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  createBroadcastCast(store, () => "Synthetic fixture").prepare();
  const runtime = store.personaRuntime()!,
    member = runtime.members[0];
  const input = {
    id: "attempt",
    sessionId: runtime.id,
    memberId: member.id,
    eventIds,
    cutoff: 0,
    sessionEpoch: runtime.controlEpoch,
    memberEpoch: member.epoch,
    definitionHash: member.hash,
    configRevision: runtime.configRevision,
  };
  assert(store.attempts.begin(input));
  assert(
    store.attempts.finish(input.id, "candidate", null, {
      text: "A synthetic viewer contribution",
    }),
  );
  const claim = { ...input, attemptId: input.id };
  const state = () =>
    store.db
      .prepare("SELECT state FROM persona_reaction_attempts WHERE id=?")
      .get(input.id)!.state;
  return { store, runtime, input, claim, state };
}
test("dispatch atomically claims one candidate once", (t) => {
  const f = fixture(t);
  assert.equal(f.store.dispatch.claim(f.claim), true);
  assert.equal(f.state(), "dispatching");
  assert.equal(f.store.dispatch.claim(f.claim), false);
});
test("dispatch cannot claim a candidate on behalf of a different cast member", (t) => {
  const f = fixture(t);
  assert.equal(
    f.store.dispatch.claim({
      ...f.claim,
      memberId: f.runtime.members[1].id,
      memberEpoch: f.runtime.members[1].epoch,
    }),
    false,
  );
  assert.equal(f.state(), "candidate");
});
test("dispatch rejects stale configuration and definition bindings", (t) => {
  const f = fixture(t);
  f.store.db
    .prepare("UPDATE persona_sessions SET revision=revision+1 WHERE id=?")
    .run(f.input.sessionId);
  assert.equal(f.store.dispatch.claim(f.claim), false);
  f.store.db
    .prepare("UPDATE persona_sessions SET revision=revision-1 WHERE id=?")
    .run(f.input.sessionId);
  f.store.db
    .prepare(
      "UPDATE persona_cast SET definition_hash='changed' WHERE member_id=?",
    )
    .run(f.input.memberId);
  assert.equal(f.store.dispatch.claim(f.claim), false);
  assert.equal(f.state(), "candidate");
});
test("all cited input IDs must still resolve within the current broadcast", (t) => {
  const f = fixture(t, ["speech"]);
  assert.equal(f.store.dispatch.claim(f.claim), false);
  f.store.transcripts.record({
    id: "speech",
    capturedAt: Date.now(),
    text: "Synthetic speech",
  });
  assert.equal(f.store.dispatch.claim(f.claim), true);
});
test("dispatch write failure rolls back without moving or reviving the attempt", (t) => {
  const f = fixture(t);
  f.store.db.exec(
    "CREATE TRIGGER fail_dispatch BEFORE UPDATE OF state ON persona_reaction_attempts WHEN NEW.state='dispatching' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
  );
  assert.equal(f.store.dispatch.claim(f.claim), false);
  assert.equal(f.state(), "candidate");
  f.store.db.exec("DROP TRIGGER fail_dispatch");
  f.store.attempts.finish(f.input.id, "canceled", "fixture stop");
  assert.equal(f.store.dispatch.claim(f.claim), false);
  assert.equal(f.state(), "canceled");
});
