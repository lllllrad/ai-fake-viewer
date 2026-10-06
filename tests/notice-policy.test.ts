import { test } from "node:test";
import assert from "node:assert/strict";
import type { Participant } from "../packages/domain/participation/model.ts";
import {
  applyGuidanceDelivery,
  reserveGuidance,
  type NoticePermission,
} from "../packages/domain/participation/notices.ts";
const now = 1_000_000;
function participant(id = "target"): Participant {
  return {
    id,
    platform: "youtube",
    broadcaster: "room",
    author: id,
    state: "WAITING_CONSENT",
    epoch: 0,
    stage: 0,
    age: "unknown",
    version: "policy",
    accepted: [],
    activeAfter: 0,
    lastEventAt: 0,
    lastSeenAt: now - 1000,
    lastNoticeAt: 0,
    deliveredAt: null,
    eventIds: new Set(),
    introPending: true,
    introDelivered: false,
    published: false,
    requestIds: [],
  };
}
const permission: NoticePermission = {
  participationAvailable: true,
  fixedNoticesApproved: true,
  limitsConfirmed: true,
  perAccountIntervalMs: 10000,
  globalPerMinute: 2,
};
const delivery = {
  platform: "youtube",
  broadcaster: "room",
  at: now,
  targetId: "target",
};
test("reservation consumes a rate slot without delivering guidance, mutating state or accepting consent", () => {
  const p = participant(),
    before = structuredClone(p),
    history = [now - 60000, now - 1000];
  const result = reserveGuidance(p, history, permission, now);
  assert.equal(result.allowed, true);
  assert.deepEqual(result.history, [now - 1000, now]);
  assert.deepEqual(history, [now - 60000, now - 1000]);
  assert.deepEqual(p, before);
  assert.equal(p.deliveredAt, null);
  assert.equal(p.state, "WAITING_CONSENT");
});
test("rate boundaries distinguish per-account cooldown and global use across participants", () => {
  assert.equal(
    reserveGuidance(
      { ...participant(), lastNoticeAt: now - 9999 },
      [],
      permission,
      now,
    ).allowed,
    false,
  );
  assert.equal(
    reserveGuidance(
      { ...participant(), lastNoticeAt: now - 10000 },
      [],
      permission,
      now,
    ).allowed,
    true,
  );
  const blocked = reserveGuidance(
    participant("other"),
    [now - 59999, now - 1],
    permission,
    now,
  );
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) assert.equal(blocked.reason, "global_limit");
  assert.equal(
    reserveGuidance(participant(), [now - 60000, now - 1], permission, now)
      .allowed,
    true,
  );
});
test("missing authorization and already-covered or blocked participants cannot reserve another notice", () => {
  for (const key of [
    "participationAvailable",
    "fixedNoticesApproved",
    "limitsConfirmed",
  ] as const)
    assert.equal(
      reserveGuidance(participant(), [], { ...permission, [key]: false }, now)
        .allowed,
      false,
    );
  for (const p of [
    { ...participant(), deliveredAt: now - 1 },
    { ...participant(), age: "blocked" as const },
    { ...participant(), state: "ACTIVE" as const },
    { ...participant(), state: "WITHDRAWN" as const },
  ])
    assert.equal(reserveGuidance(p, [], permission, now).allowed, false);
});
test("room delivery covers a target and recently observed waiting viewers without granting their consent", () => {
  for (const p of [
    participant(),
    { ...participant("recent"), lastSeenAt: now - 300000 },
  ]) {
    const next = applyGuidanceDelivery(p, delivery);
    assert.notEqual(next, p);
    assert.equal(next.deliveredAt, now);
    assert.equal(next.state, "WAITING_CONSENT");
    assert.equal(next.epoch, 0);
    assert.deepEqual(next.accepted, []);
    assert.equal(p.deliveredAt, null);
  }
});
test("room boundaries, absent viewers, future arrivals and blocked states never share guidance", () => {
  for (const p of [
    { ...participant(), platform: "chzzk" },
    { ...participant(), broadcaster: "other" },
    { ...participant("unknown"), lastSeenAt: 0 },
    { ...participant("old"), lastSeenAt: now - 300001 },
    { ...participant("future"), lastSeenAt: now + 1 },
    { ...participant(), age: "blocked" as const },
    { ...participant(), state: "WITHDRAWN" as const },
    { ...participant(), state: "ACTIVE" as const },
  ])
    assert.equal(applyGuidanceDelivery(p, delivery), p);
});
test("replayed acknowledgements cannot extend the consent window or overwrite an earlier receipt", () => {
  const covered = applyGuidanceDelivery(participant(), delivery);
  assert.equal(
    applyGuidanceDelivery(covered, { ...delivery, at: now + 500 }),
    covered,
  );
  assert.equal(
    applyGuidanceDelivery(covered, { ...delivery, at: now - 500 }),
    covered,
  );
  const p = participant();
  assert.equal(applyGuidanceDelivery(p, { ...delivery, at: NaN }), p);
});
