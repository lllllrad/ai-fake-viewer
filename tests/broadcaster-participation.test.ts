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
  test(`${platform} broadcaster can receive guidance, consent, publish chat and withdraw`, (t) => {
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    const p = new Participation(approvedProfile(), "session");
    const store = new Store(":memory:", p);
    t.after(() => store.close());
    const send = (text: string) =>
      store.ingestBatch([privacyMessage("fixture", text, ++now, { platform })]);
    send("Before consent");
    const person = p.get(platform, "fixture", "fixture")!;
    assert(person);
    assert.equal(person.state, "WAITING_CONSENT");
    assert.equal(store.snapshot().messages.length, 0);
    const delivery = new FixedNoticeDelivery(p, "fixture", platform, {
      now: () => now,
      id: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const notice = delivery.next(true);
    assert(notice);
    assert(delivery.echo("fixture", notice.text));
    send("!동의");
    assert.equal(person.state, "ACTIVE");
    send("My own live chat");
    assert.equal(store.snapshot().messages.filter(Boolean).length, 1);
    assert.equal(store.context([platform])[0].text, "My own live chat");
    const ownNotice =
      platform === "soop"
        ? notice.text
        : fixedNoticeText(
            consentNoticeText(p.profile),
            platform === "chzzk" ? 88 : 170,
          );
    send(ownNotice);
    assert.equal(store.context([platform]).length, 1);
    send("!철회");
    assert.equal(person.state, "WITHDRAWN");
    assert.equal(store.context([platform]).length, 0);
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
