import { test } from "node:test";
import assert from "node:assert/strict";
import { Participation } from "../packages/participation.ts";
import { Store } from "../packages/storage.ts";
import { YoutubeNotices } from "../packages/youtube-notices.ts";
import { ChzzkNotices } from "../packages/chzzk-notices.ts";
import { normalizeChzzk } from "../packages/chzzk.ts";
import {
  assertProfileUpdate,
  profileIssues,
} from "../packages/privacy-profile.ts";
import { approvedProfile, privacyMessage } from "./privacy-fixtures.ts";

for (const platform of ["youtube", "chzzk"] as const) {
  test(`${platform} single-step test sends one message and requires one fresh post-delivery consent`, async (t) => {
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    const profile = approvedProfile();
    profile.singleStepTest = true;
    profile.testReview = {
      reference: "Explicit temporary test",
      checkedAt: "2026-10-05T00:00:00Z",
    };
    profile.audioEnabled = true;
    profile.videoEnabled = true;
    profile.noticeUrl = "https://cafe.naver.com/lllllrad/staff/2";
    const p = new Participation(profile, "session"),
      store = new Store(":memory:", p);
    t.after(() => store.close());
    const sent: string[] = [];
    const request: typeof fetch = async (url, init) => {
      if (String(url).endsWith("/users/me"))
        return Response.json({ code: 200, content: { channelId: "fixture" } });
      const b = JSON.parse(String(init?.body));
      sent.push(
        platform === "youtube"
          ? b.snippet.textMessageDetails.messageText
          : b.message,
      );
      return platform === "youtube"
        ? Response.json({
            id: "sent",
            snippet: { ...b.snippet, authorChannelId: "fixture" },
          })
        : Response.json({ code: 200, content: { messageId: "sent" } });
    };
    const sender =
      platform === "youtube"
        ? new YoutubeNotices(
            p,
            {
              connected: true,
              channelId: "fixture",
              access: async () => "token",
            } as any,
            request,
            true,
          )
        : new ChzzkNotices(
            p,
            { token: {}, access: async () => "token" } as any,
            request,
            true,
          );
    sender.resolve("chat", "fixture");
    sender.connected = true;
    const send = (text: string) => {
      const at = ++now;
      const message =
        platform === "chzzk"
          ? normalizeChzzk({
              channelId: "fixture",
              senderChannelId: "fixture",
              profile: { nickname: "Synthetic broadcaster" },
              content: text,
              messageTime: at,
            })
          : privacyMessage("fixture", text, at, { platform });
      store.ingestBatch([message]);
      return message;
    };
    send("hello");
    const person = p.get(platform, "fixture", "fixture")!;
    const earlyConsent = send("!동의");
    assert.equal(person.state, "WAITING_CONSENT");
    await sender.tick(new AbortController().signal);
    assert.equal(sent.length, 1);
    assert(sent[0].startsWith("[안내 1/1]"));
    assert(sent[0].length <= (platform === "chzzk" ? 100 : 200));
    assert(sent[0].includes(profile.noticeUrl));
    assert(sent[0].includes("14세"));
    store.ingestBatch([earlyConsent]);
    assert.equal(person.state, "WAITING_CONSENT");
    now += 60000;
    send("ordinary again");
    await sender.tick(new AbortController().signal);
    assert.equal(sent.length, 1);
    assert.equal(store.snapshot().messages.length, 0);
    send("!동의");
    assert.equal(person.state, "ACTIVE");
    assert.equal(person.age, "self_declared_14_plus");
    send("new permitted text");
    assert.equal(store.snapshot().messages.length, 1);
    send("!철회");
    assert.equal(person.state, "WITHDRAWN");
    assert.equal(store.snapshot().messages.length, 0);
    now += 60000;
    send("ordinary after withdrawal");
    await sender.tick(new AbortController().signal);
    assert.equal(sent.length, 1);
  });
}
test("single-step testing is explicit, versioned and keeps known age restrictions", () => {
  const before = approvedProfile(),
    after = approvedProfile();
  after.singleStepTest = true;
  assert(profileIssues(after).length > 0);
  after.testReview = {
    reference: "Test review",
    checkedAt: "2026-10-05T00:00:00Z",
  };
  assert.deepEqual(profileIssues(after), []);
  assert.throws(() => assertProfileUpdate(before, after));
  after.noticeVersion = "single-test-2";
  assert.doesNotThrow(() => assertProfileUpdate(before, after));
  const p = new Participation(after, "session"),
    store = new Store(":memory:", p);
  try {
    store.ingestBatch([privacyMessage("u", "hello", Date.now() + 1)]);
    const person = p.get("youtube", "fixture", "u")!;
    p.blockAge(person.id);
    store.ingestBatch([privacyMessage("u", "!동의", Date.now() + 2)]);
    assert.equal(person.age, "blocked");
    assert.equal(person.state, "WITHDRAWN");
  } finally {
    store.close();
  }
});
