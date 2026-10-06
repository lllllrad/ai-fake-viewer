import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WithdrawalFollowups,
  type FollowupWriter,
} from "../packages/application/rights/withdrawal-followups.ts";
const withdrawal = {
  participantId: "participant",
  epoch: 2,
  platform: "youtube",
  account: "fixture-account",
  session: "broadcast",
  broadcaster: "fixture-channel",
  published: true,
  requestIds: ["request-1"],
};
function fixture() {
  const created: Array<{
      intake: unknown;
      requestIds: string[];
      appDone: boolean;
    }> = [],
    attached: Array<[string, string]> = [];
  const writer: FollowupWriter = {
    create: (intake, requestIds, appDone) => {
      created.push(structuredClone({ intake, requestIds, appDone }));
      return { id: `task-${created.length}` };
    },
    attachRequest: (task, request) => {
      attached.push([task, request]);
    },
  };
  return {
    created,
    attached,
    writer,
    service: new WithdrawalFollowups(writer),
  };
}
test("withdrawal snapshots only minimal intake and bounded deduplicated request identifiers", () => {
  const f = fixture();
  const input = {
    ...withdrawal,
    requestIds: Array.from({ length: 120 }, (_, i) => `request-${i}`),
    rawChat: "PRIVATE_FIXTURE",
    unrelatedState: "PRIVATE_FIXTURE",
  };
  f.service.withdrawn(input);
  input.requestIds.push("later-mutation");
  f.service.flush();
  assert.equal(f.created.length, 1);
  assert.equal(f.created[0].appDone, true);
  assert.equal(f.created[0].requestIds.length, 100);
  assert(!JSON.stringify(f.created).includes("PRIVATE_FIXTURE"));
  assert(!f.created[0].requestIds.includes("later-mutation"));
  assert.equal(f.service.pendingCount, 0);
});
test("failed creation keeps one follow-up and merges late IDs without blocking local withdrawal", () => {
  const f = fixture(),
    create = f.writer.create;
  f.writer.create = () => {
    throw new Error("fixture rights unavailable");
  };
  f.service.withdrawn(withdrawal);
  assert.doesNotThrow(() => f.service.flush());
  f.service.requestReturned(withdrawal.participantId, 1, "late-request");
  f.service.requestReturned(withdrawal.participantId, 1, "late-request");
  assert.equal(f.service.pendingCount, 1);
  f.writer.create = create;
  f.service.flush();
  f.service.flush();
  assert.equal(f.created.length, 1);
  assert.deepEqual(f.created[0].requestIds, ["request-1", "late-request"]);
});
test("failed late attachment is retried on the same task rather than creating another request", () => {
  const f = fixture(),
    attach = f.writer.attachRequest;
  f.service.withdrawn(withdrawal);
  f.service.flush();
  f.writer.attachRequest = () => {
    throw new Error("fixture rights unavailable");
  };
  assert.doesNotThrow(() =>
    f.service.requestReturned(withdrawal.participantId, 1, "late-request"),
  );
  assert.equal(f.service.pendingCount, 1);
  f.writer.attachRequest = attach;
  f.service.flush();
  assert.deepEqual(f.attached, [["task-1", "late-request"]]);
  assert.equal(f.created.length, 1);
  assert.equal(f.service.pendingCount, 0);
});
test("late requests stay with the withdrawal epoch in which their input was authorized", () => {
  const f = fixture();
  f.service.withdrawn(withdrawal);
  f.service.flush();
  f.service.withdrawn({ ...withdrawal, epoch: 4, requestIds: [] });
  f.service.flush();
  f.service.requestReturned(withdrawal.participantId, 1, "old-request");
  f.service.requestReturned(withdrawal.participantId, 3, "new-request");
  f.service.requestReturned("someone-else", 1, "unrelated");
  assert.deepEqual(f.attached, [
    ["task-1", "old-request"],
    ["task-2", "new-request"],
  ]);
});
test("unpublished viewers without external request IDs do not create external follow-up work", () => {
  const f = fixture();
  f.service.withdrawn({ ...withdrawal, published: false, requestIds: [] });
  f.service.flush();
  assert.equal(f.created.length, 0);
  f.service.withdrawn(withdrawal);
  f.service.flush();
  f.service.withdrawn(withdrawal);
  f.service.flush();
  assert.equal(f.created.length, 1);
  f.service.clear();
  assert.equal(f.service.pendingCount, 0);
});
