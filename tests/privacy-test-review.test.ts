import { test } from "node:test";
import assert from "node:assert/strict";
import {
  privacyProfileSchema,
  profileIssues,
  assertProfileUpdate,
} from "../packages/privacy-profile.ts";
import { Participation } from "../packages/participation.ts";
import { Store } from "../packages/storage.ts";
import { NoticeBot } from "../packages/notice-bot.ts";
import { approvedProfile, privacyMessage } from "./privacy-fixtures.ts";

function reviewedProfile() {
  const p = approvedProfile();
  p.testReview = {
    reference: "Operator confirmed revised scope for testing",
    checkedAt: "2026-10-05T00:00:00Z",
  };
  p.overseasBasis = "unconfirmed";
  p.processing.countries = [];
  for (const key of [
    "subprocessors",
    "retention",
    "evidenceUrl",
    "checkedAt",
  ] as const)
    p.processing[key] = "";
  p.processing.accountSettingsVerified = false;
  p.processing.dataSharingDisabled = false;
  p.processing.noticeMatchesConfiguration = false;
  p.publications = [];
  p.notices.approvedLimitConfirmed = false;
  return p;
}
test("operator-reviewed testing defers metadata without inventing provider facts; defaults remain strict", () => {
  const p = reviewedProfile();
  assert.deepEqual(profileIssues(p), []);
  delete p.testReview;
  assert(profileIssues(p).length > 0);
  assert(
    !privacyProfileSchema.safeParse({
      testReview: { reference: "", checkedAt: "invalid" },
    }).success,
  );
});
test("test review preserves required notices, operator identity and provider endpoint checks", () => {
  for (const key of [
    "operator",
    "contact",
    "collectionNotice",
    "publicationNotice",
    "overseasNotice",
    "policyUrl",
    "noticeVersion",
  ] as const) {
    const p = reviewedProfile();
    p[key] = "";
    assert(profileIssues(p).length > 0, key);
  }
  const p = reviewedProfile();
  p.processing.endpoint = "https://example.test/v1";
  assert(profileIssues(p).length > 0);
  p.processing.endpoint = "https://api.openai.com/v1";
  p.processing.contract = "ChatGPT subscription";
  assert(profileIssues(p).length > 0);
});
test("changing review evidence requires renewed viewer notice version", () => {
  const previous = approvedProfile(),
    next = reviewedProfile();
  assert.throws(() => assertProfileUpdate(previous, next));
  next.noticeVersion = "reviewed-test-2";
  assert.doesNotThrow(() => assertProfileUpdate(previous, next));
  const without = structuredClone(next);
  delete without.testReview;
  assert.throws(() => assertProfileUpdate(next, without));
});
test("reviewed tests retain channel approval, delivery, consent, withdrawal and rate limits", (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const profile = reviewedProfile();
  profile.notices.globalPerMinute = 1;
  const p = new Participation(profile, "test"),
    store = new Store(":memory:", p),
    bot = new NoticeBot(p, "fixture", "youtube");
  t.after(() => store.close());
  assert(!p.available("youtube", "other"));
  const send = (author: string, text: string) =>
    store.ingestBatch([privacyMessage(author, text, ++now)]);
  send("u", "PRIVATE_UNCONSENTED");
  assert.equal(store.snapshot().messages.length, 0);
  const intro = bot.next(true)!;
  assert(intro);
  assert(bot.echo("fixture", intro.text));
  send("v", "PRIVATE_OTHER");
  assert.equal(bot.next(true), null);
  send("u", "!동의");
  const person = p.get("youtube", "fixture", "u")!;
  send("u", "!동의");
  assert.equal(person.state, "ACTIVE");
  now += 60001;
  const stage = bot.next(true)!;
  assert(stage);
  send("u", "!철회");
  bot.echo("fixture", stage.text);
  assert.equal(person.state, "WITHDRAWN");
  assert.equal(store.snapshot().messages.length, 0);
  profile.approvals = [];
  assert(!p.available("youtube", "fixture"));
});
