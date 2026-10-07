import { platformAccountId } from "../packages/domain/participation/platform-identity.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Participation } from "../packages/infrastructure/participation/runtime.ts";
import { FixedNoticeDelivery } from "../packages/application/participation/fixed-notice-delivery.ts";
import { Store } from "../packages/storage.ts";
import { approvedProfile, privacyMessage } from "./privacy-fixtures.ts";
import {
  consentNoticeText,
  fixedNoticeText,
  isOwnFixedNotice,
} from "../packages/domain/participation/notice-text.ts";

for (const platform of ["youtube", "chzzk", "soop"] as const) {
  test(`${platform} broadcaster is admitted automatically without guidance and can withdraw`, (t) => {
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    const p = new Participation(approvedProfile(), "session");
    const store = new Store(":memory:", p);
    t.after(() => store.close());
    const send = (text: string) =>
      store.ingestBatch([privacyMessage("fixture", text, ++now, { platform })]);
    send("My own live chat");
    const person = p.get(platform, "fixture", "fixture")!;
    assert.equal(person.state, "ACTIVE");
    assert.deepEqual(person.accepted, ["broadcaster_auto"]);
    assert.equal(person.age, "unknown");
    assert(p.allowed(platform, "fixture", "fixture", person.epoch));
    const delivery = new FixedNoticeDelivery(p, "fixture", platform, {
      now: () => now,
      id: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    assert.equal(delivery.next(true), null);
    assert.equal(store.snapshot().messages.length, 1);
    assert.equal(store.context([platform])[0].text, "My own live chat");
    const ownNotice =
      platform === "soop"
        ? consentNoticeText(p.profile) + " [안내 aaaaaaaa]"
        : fixedNoticeText(
            consentNoticeText(p.profile),
            platform === "chzzk" ? 88 : 170,
          );
    send(ownNotice);
    assert.equal(store.context([platform]).length, 1);
    send("!철회");
    assert.equal(person.state, "WITHDRAWN");
    assert.equal(store.context([platform]).length, 0);
    send("After withdrawal");
    assert.equal(store.context([platform]).length, 0);
    send("!동의");
    send("Rejoined");
    assert.equal(store.context([platform]).length, 1);
    const restored = new Participation(approvedProfile(), "session");
    restored.restore(p.snapshot());
    assert(restored.allowed(platform, "fixture", "fixture", person.epoch));
    const viewer = privacyMessage("viewer", "ordinary viewer", ++now, {
      platform,
    });
    assert.equal(p.handle(viewer).allow, false);
  });
}
test("notice echoes do not create participants or additional guidance targets", () => {
  const p = new Participation(approvedProfile(), "session");
  for (const platform of ["youtube", "chzzk", "soop"] as const) {
    const text =
      platform === "soop"
        ? `${consentNoticeText(p.profile)} [안내 1234abcd]`
        : fixedNoticeText(
            consentNoticeText(p.profile),
            platform === "chzzk" ? 88 : 170,
          );
    const message = privacyMessage("fixture", text, Date.now(), { platform });
    assert(
      isOwnFixedNotice(
        { ...message, platform, channel: "fixture", author: "fixture", text },
        p.profile,
      ),
    );
    assert.equal(p.handle(message).allow, false);
    assert.equal(p.get(platform, "fixture", "fixture"), undefined);
    assert.equal(
      isOwnFixedNotice(
        { ...message, platform, channel: "fixture", author: "other", text },
        p.profile,
      ),
      false,
    );
  }
});

test("owner auto-admission accepts untimestamped live input but preserves availability and age blocks", () => {
  const profile = approvedProfile();
  const p = new Participation(profile, "session");
  const message = privacyMessage("fixture", "live", Date.now(), {
    platform: "soop",
    publishedAt: null,
    sourceId: null,
  });
  assert.equal(p.handle(message).allow, true);
  p.connectionLost("soop");
  assert.equal(p.get("soop", "fixture", "fixture")?.state, "ACTIVE");
  p.blockAge(p.get("soop", "fixture", "fixture")!.id);
  assert.equal(p.handle(message).allow, false);
  const unavailable = new Participation(
    { ...profile, approvals: [] },
    "session",
  );
  assert.equal(unavailable.handle(message).allow, false);
  const stale = new Participation(profile, "session");
  assert.equal(
    stale.handle({ ...message, publishedAt: stale.startedAt - 1 }).allow,
    false,
  );
  assert.equal(
    stale.get("soop", "fixture", "fixture")?.state,
    "WAITING_CONSENT",
  );
  stale.end();
  assert.equal(stale.handle(message).allow, false);
});

test("SOOP connection suffixes share owner admission and fixed-notice exclusion", (t) => {
  const p = new Participation(approvedProfile(), "session");
  const store = new Store(":memory:", p);
  t.after(() => store.close());
  const send = (author: string, text: string) =>
    store.ingestBatch([
      privacyMessage(author, text, Date.now(), {
        platform: "soop",
        publishedAt: null,
        sourceId: null,
      }),
    ]);
  send("fixture(5)", consentNoticeText(p.profile) + " [안내 ed4639e1]");
  assert.equal(p.participants.size, 0);
  send("fixture(2)", "owner chat");
  assert.equal(p.get("soop", "fixture", "fixture")?.state, "ACTIVE");
  assert.equal(p.participants.size, 1);
  assert.equal(store.context(["soop"]).length, 1);
  send("fixture(5)", "!철회");
  assert.equal(store.context(["soop"]).length, 0);
});

test("account normalization is platform-specific and does not merge lookalike identifiers", () => {
  assert.equal(platformAccountId("soop", "viewer(2)"), "viewer");
  for (const id of [
    "viewer-other(2)",
    "viewer(2)extra",
    "viewer(admin)",
    "viewer",
  ])
    assert.equal(platformAccountId("soop", id), id);
  for (const platform of ["youtube", "chzzk"])
    assert.equal(platformAccountId(platform, "viewer(2)"), "viewer(2)");
});
