import { test } from "node:test";
import assert from "node:assert/strict";
import type { Participant } from "../packages/domain/participation/model.ts";
import {
  receiveParticipantMessage,
  confirmObservedConsent,
  type ConsentContext,
} from "../packages/domain/participation/consent.ts";
const context: ConsentContext = {
  now: 1000,
  startedAt: 100,
  fingerprint: "fixture-policy",
  available: true,
  observationId: "observation",
};
function participant(): Participant {
  return {
    id: "viewer",
    platform: "youtube",
    broadcaster: "broadcast",
    author: "viewer",
    state: "WAITING_CONSENT",
    epoch: 0,
    stage: 0,
    age: "unknown",
    version: "fixture-policy",
    accepted: [],
    activeAfter: 0,
    lastEventAt: 100,
    lastSeenAt: 0,
    lastNoticeAt: 0,
    deliveredAt: 200,
    eventIds: new Set(),
    introPending: false,
    introDelivered: true,
    published: false,
    requestIds: [],
  };
}
const consent = { text: "!동의", sourceId: "command", publishedAt: 300 };
test("one fresh command after delivered guidance admits only later chat and does not mutate stored state", () => {
  const original = participant(),
    before = structuredClone(original);
  const accepted = receiveParticipantMessage(original, consent, context);
  assert.deepEqual(original, before);
  assert.equal(accepted.participant.state, "ACTIVE");
  assert.equal(accepted.participant.stage, 1);
  assert.equal(accepted.revisionDelta, 1);
  assert.equal(accepted.result.allow, false);
  assert.equal(
    receiveParticipantMessage(
      accepted.participant,
      { text: "same event time", publishedAt: 300 },
      context,
    ).result.allow,
    false,
  );
  assert.equal(
    receiveParticipantMessage(
      accepted.participant,
      { text: "later fixture", publishedAt: 301 },
      context,
    ).result.allow,
    true,
  );
  assert.equal(
    receiveParticipantMessage(
      accepted.participant,
      { text: "later fixture", publishedAt: 301 },
      { ...context, fingerprint: "changed" },
    ).result.allow,
    false,
  );
});
test("undelivered, replayed, old and implausibly future commands cannot activate a viewer", () => {
  for (const [current, message] of [
    [{ ...participant(), deliveredAt: null }, consent],
    [{ ...participant(), eventIds: new Set(["command"]) }, consent],
    [participant(), { ...consent, publishedAt: 100 }],
    [participant(), { ...consent, publishedAt: 99 }],
    [participant(), { ...consent, publishedAt: 6001 }],
  ] as const)
    assert.notEqual(
      receiveParticipantMessage(current, message, context).participant.state,
      "ACTIVE",
    );
});
test("withdrawal is conservative even with stale ordering and signals invalidation only on a new transition", () => {
  const active = receiveParticipantMessage(
    participant(),
    consent,
    context,
  ).participant;
  const withdrawn = receiveParticipantMessage(
    active,
    { text: "!철회", publishedAt: 1 },
    context,
  );
  assert.equal(withdrawn.withdrawn, true);
  assert.equal(withdrawn.result.withdraw, true);
  assert.equal(withdrawn.revisionDelta, 1);
  assert.equal(withdrawn.participant.epoch, 2);
  assert.deepEqual(withdrawn.participant.accepted, []);
  const replay = receiveParticipantMessage(
    withdrawn.participant,
    { text: "!철회" },
    context,
  );
  assert.equal(replay.withdrawn, false);
  assert.equal(replay.revisionDelta, 0);
  assert.equal(replay.result.withdraw, true);
  assert.equal(
    receiveParticipantMessage(
      withdrawn.participant,
      { text: "later", publishedAt: 500 },
      context,
    ).result.allow,
    false,
  );
});
test("unordered consent requires the exact fresh observation and guidance predating it", () => {
  const observed = receiveParticipantMessage(
    participant(),
    { text: "!동의" },
    context,
  ).participant;
  assert.equal(observed.state, "WAITING_CONSENT");
  assert.equal(observed.observed?.command, "!동의");
  assert.equal(confirmObservedConsent(observed, "other", context), undefined);
  assert.equal(
    confirmObservedConsent(observed, "observation", { ...context, now: 61001 }),
    undefined,
  );
  assert.equal(
    confirmObservedConsent(observed, "observation", {
      ...context,
      available: false,
    }),
    undefined,
  );
  const accepted = confirmObservedConsent(observed, "observation", context)!;
  assert.equal(accepted.participant.state, "ACTIVE");
  assert(accepted.participant.accepted.includes("manual_live_order"));
  assert.equal(
    confirmObservedConsent(accepted.participant, "observation", context),
    undefined,
  );
  const lateGuidance = confirmObservedConsent(
    { ...observed, deliveredAt: 1001 },
    "observation",
    context,
  )!;
  assert.equal(lateGuidance.participant.state, "WAITING_CONSENT");
  assert.equal(lateGuidance.participant.observed, undefined);
});
test("blocked viewers and status enquiries cannot grant consent or pass ordinary text", () => {
  const blocked = { ...participant(), age: "blocked" as const };
  assert.equal(
    receiveParticipantMessage(blocked, consent, context).participant.state,
    "WAITING_CONSENT",
  );
  const enquiry = receiveParticipantMessage(
    participant(),
    { text: "!참여상태" },
    context,
  ).participant;
  assert.equal(
    confirmObservedConsent(enquiry, "observation", context),
    undefined,
  );
  const ordinary = receiveParticipantMessage(
    participant(),
    { text: "Synthetic unconsented text", publishedAt: 500 },
    context,
  );
  assert.equal(ordinary.result.allow, false);
  assert(
    !JSON.stringify(ordinary.participant).includes(
      "Synthetic unconsented text",
    ),
  );
});
test("re-entry after withdrawal requires a new delivered notice before fresh consent", () => {
  const withdrawn = { ...participant(), state: "WITHDRAWN" as const, epoch: 4 };
  const waiting = receiveParticipantMessage(withdrawn, consent, context);
  assert.equal(waiting.participant.state, "WAITING_CONSENT");
  assert.equal(waiting.participant.deliveredAt, null);
  assert.equal(waiting.participant.epoch, 5);
  const early = receiveParticipantMessage(
    waiting.participant,
    { ...consent, sourceId: "new", publishedAt: 400 },
    context,
  );
  assert.notEqual(early.participant.state, "ACTIVE");
  const ready = receiveParticipantMessage(
    { ...early.participant, deliveredAt: 450 },
    { ...consent, sourceId: "final", publishedAt: 500 },
    context,
  );
  assert.equal(ready.participant.state, "ACTIVE");
  assert.equal(ready.participant.epoch, 6);
});
