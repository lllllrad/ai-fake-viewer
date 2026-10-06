import { test } from "node:test";
import assert from "node:assert/strict";
import { participationStatusSchema } from "../packages/contracts/participation.ts";
import { approvedProfile } from "./privacy-fixtures.ts";

function fixture() {
  return {
    generatedAt: 1,
    pendingFollowups: 0,
    noticeBot: "ready",
    youtubeNoticeBot: "disabled",
    chzzkNoticeBot: "disabled",
    profile: approvedProfile(),
    issues: [],
    rights: [],
    videos: [],
    participants: [
      {
        id: "fixture",
        platform: "soop",
        broadcaster: "fixture",
        account: "viewer",
        state: "WAITING_CONSENT",
        age: "unknown",
        stage: 0,
        epoch: 0,
        deliveredAt: null,
        observed: {
          id: "command",
          receivedAt: 1,
          command: "!동의",
          rawText: "must not cross the boundary",
        },
        notice: { stage: "combined", text: "fixed fixture notice" },
        rawText: "must not cross the boundary",
      },
    ],
  };
}
test("participation status strips unrelated participant data and requires complete current state", () => {
  const data = participationStatusSchema.parse(fixture());
  assert(!JSON.stringify(data).includes("must not cross"));
  assert.equal(data.participants[0].observed?.command, "!동의");
  assert.throws(() => participationStatusSchema.parse({}));
  assert.throws(() =>
    participationStatusSchema.parse({
      ...fixture(),
      participants: [{ id: "fixture" }],
    }),
  );
  assert.throws(() =>
    participationStatusSchema.parse({ ...fixture(), pendingFollowups: -1 }),
  );
});
test("participation status rejects malformed rights and video records instead of inventing defaults", () => {
  assert.throws(() =>
    participationStatusSchema.parse({
      ...fixture(),
      rights: [{ id: "fixture" }],
    }),
  );
  assert.throws(() =>
    participationStatusSchema.parse({
      ...fixture(),
      videos: [{ id: "fixture" }],
    }),
  );
});
