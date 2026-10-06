import { test } from "node:test";
import assert from "node:assert/strict";
import { NoticeBot } from "../packages/notice-bot.ts";
import { Participation } from "../packages/participation.ts";
import { Store } from "../packages/storage.ts";
import { approvedProfile, privacyMessage } from "./privacy-fixtures.ts";
import { dispatchFixedNotice } from "../apps/web/src/soop-notice-sender.ts";
function fixture(t: any) {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const profile = approvedProfile();
  profile.notices.botUserIds = ["fixture", "other-bot"];
  const p = new Participation(profile, "session"),
    store = new Store(":memory:", p),
    bot = new NoticeBot(p, "fixture");
  const tick = (n = 1) => (now += n);
  const message = (author: string, text: string) =>
    store.ingestBatch([
      privacyMessage(author, text, tick(), { platform: "soop" }),
    ]);
  t.after(() => store.close());
  return { p, store, bot, tick, message };
}
test("unconsented ordinary chat automatically schedules only fixed text; echoed delivery is not consent", (t) => {
  const { p, store, bot, message } = fixture(t);
  message("u", "PRIVATE_TEXT_AND_NICK");
  const job = bot.next(true)!;
  assert(job.text.includes("미동의 제외"));
  assert(!job.text.includes("PRIVATE"));
  assert.equal(store.snapshot().messages.length, 0);
  assert.equal(bot.next(true), null); // lease shared across tabs
  assert.equal(bot.echo("another-user", job.text), false);
  assert.equal(bot.echo("fixture", "wrong text"), false);
  assert.equal(bot.echo("fixture", job.text), true);
  assert.equal(p.get("soop", "fixture", "u")!.state, "WAITING_CONSENT");
  assert.notEqual(p.get("soop", "fixture", "u")!.deliveredAt, null);
  assert.equal(bot.next(true), null);
});
test("per-account and global limits reserve attempts before sending, including failures", (t) => {
  const { p, bot, message, tick } = fixture(t);
  p.profile.notices.globalPerMinute = 1;
  message("a", "hello");
  const one = bot.next(true)!;
  bot.failed(one.id);
  message("b", "hello");
  assert.equal(bot.next(true), null);
  tick(60001);
  const two = bot.next(true)!;
  assert(two);
  bot.echo("fixture", two.text);
  message("a", "again");
  assert.equal(bot.next(true), null);
});
test("bots, withdrawn users and unapproved/disconnected paths do not send; stale leases cannot advance consent", (t) => {
  const { p, bot, message, tick } = fixture(t);
  message("other-bot", "!동의");
  assert.equal(bot.next(true), null);
  message("u", "hi");
  assert.equal(bot.next(false), null);
  p.profile.approvals.find((x) => x.platform === "soop")!.fixedNotices = false;
  assert.equal(bot.next(true), null);
  assert.equal(bot.state, "approval_required");
  p.profile.approvals.find((x) => x.platform === "soop")!.fixedNotices = true;
  const old = bot.next(true)!;
  message("u", "!철회");
  assert(bot.echo("fixture", old.text));
  tick(60001);
  message("u", "ordinary after withdrawal");
  assert.equal(bot.next(true), null);
  message("u", "!동의");
  const stage = bot.next(true)!;
  assert(stage);
  tick(15001);
  assert(bot.echo("fixture", stage.text));
  assert.equal(p.get("soop", "fixture", "u")!.deliveredAt, null);
});
test("each consent stage needs a confirmed SDK echo followed by a new command", (t) => {
  const { p, bot, message, tick } = fixture(t);
  message("u", "!동의");
  const person = p.get("soop", "fixture", "u")!;
  for (let stage = 0; stage < p.stages().length; stage++) {
    tick(31000);
    const job = bot.next(true)!;
    assert(job);
    message("u", "!동의");
    assert.equal(person.stage, stage);
    assert(bot.echo("fixture", job.text));
    message("u", "!동의");
    assert.equal(person.stage, stage + 1);
  }
  assert.equal(person.state, "ACTIVE");
  assert.equal(bot.next(true), null);
});
test("sender calls official void method only for a live unexpired server notice and never marks it delivered", async () => {
  const job = {
    id: "fixture",
    text: "fixed notice",
    expiresAt: Date.now() + 10000,
  };
  const sent: string[] = [],
    failed: string[] = [];
  await dispatchFixedNotice(
    async () => ({ notice: job }),
    () => true,
    (text) => {
      sent.push(text);
    },
    async (id) => {
      failed.push(id);
    },
  );
  assert.deepEqual(sent, ["fixed notice"]);
  assert.equal(failed.length, 0);
  await dispatchFixedNotice(
    async () => ({ notice: job }),
    () => true,
    () => {
      throw Error("SDK failure");
    },
    async (id) => {
      failed.push(id);
    },
  );
  assert.deepEqual(failed, ["fixture"]);
  let connected = true;
  await dispatchFixedNotice(
    async () => {
      connected = false;
      return { notice: job };
    },
    () => connected,
    (text) => {
      sent.push(text);
    },
    async (id) => {
      failed.push(id);
    },
  );
  assert.equal(sent.length, 1);
});

test("global attempt limit survives a new broadcast session in the same process", (t) => {
  const { p, store, bot, message, tick } = fixture(t);
  p.profile.notices.globalPerMinute = 1;
  message("a", "first");
  const job = bot.next(true)!;
  bot.echo("fixture", job.text);
  store.newSession();
  bot.reset();
  message("b", "new session");
  assert.equal(bot.next(true), null);
  tick(60001);
  assert(bot.next(true));
});

test("confirmed intro is not repeated for later chat, but explicit consent and new sessions still work", (t) => {
  const { p, store, bot, message, tick } = fixture(t);
  message("u", "first");
  const intro = bot.next(true)!;
  assert(bot.echo("fixture", intro.text));
  tick(600001);
  message("u", "later");
  assert.equal(bot.next(true), null);
  bot.reset();
  tick(600001);
  message("u", "after reconnect");
  assert.equal(bot.next(true), null);
  message("u", "!동의");
  assert.equal(bot.next(true), null);
  tick(600001);
  message("u", "waiting for consent");
  assert.equal(bot.next(true), null);
  assert.equal(p.get("soop", "fixture", "u")!.state, "ACTIVE");
  store.newSession();
  bot.reset();
  tick(600001);
  message("u", "new broadcast");
  assert(bot.next(true));
});
