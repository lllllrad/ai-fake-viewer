import { test } from "node:test";
import assert from "node:assert/strict";
import { FixedNoticeDelivery } from "../packages/application/participation/fixed-notice-delivery.ts";
import { ParticipationService } from "../packages/application/participation/service.ts";
import { approvedProfile } from "./privacy-fixtures.ts";

function fixture(platform: "soop" | "youtube" = "soop") {
  let now = 100000;
  let sequence = 0;
  const runtime = {
    now: () => now,
    id: () => String(++sequence).padStart(8, "0"),
    fingerprint: () => "profile",
  };
  const participation = new ParticipationService(
    approvedProfile(),
    "broadcast",
    runtime,
  );
  const delivery = new FixedNoticeDelivery(
    participation,
    "fixture",
    platform,
    runtime,
  );
  const message = (author: string, text = "hello") => {
    now++;
    participation.handle({
      platform,
      channel: "fixture",
      author,
      text,
      publishedAt: now,
      sourceId: runtime.id(),
    });
    return participation.get(platform, "fixture", author)!;
  };
  return {
    participation,
    delivery,
    message,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

test("fixed notice receipt cannot reuse a target already covered by another delivery", () => {
  const f = fixture();
  const first = f.message("first");
  const old = f.delivery.next(true)!;
  f.participation.noticeDelivered("soop", "fixture", f.now(), first.id);
  const newcomer = f.message("newcomer");
  assert.equal(f.delivery.valid(old.id), false);
  assert.equal(f.delivery.echo("fixture", old.text), true);
  assert.equal(newcomer.deliveredAt, null);
  assert.equal(f.delivery.state, "delivery_unconfirmed");
});

test("already covered notice leases release the queue without waiting for receipt timeout", () => {
  const f = fixture("youtube");
  const first = f.message("first");
  const old = f.delivery.next(true)!;
  f.participation.noticeDelivered("youtube", "fixture", f.now(), first.id);
  const newcomer = f.message("newcomer");
  const next = f.delivery.next(true)!;
  assert(next);
  assert.notEqual(next.id, old.id);
  assert.equal(f.delivery.valid(old.id), false);
  assert.equal(f.delivery.valid(next.id), true);
  assert.equal(newcomer.deliveredAt, null);
  assert(f.delivery.echo("fixture", next.text));
  assert.notEqual(newcomer.deliveredAt, null);
});

test("fixed notice receipt and send use identical consent binding checks", () => {
  for (const invalidate of [
    (f: ReturnType<typeof fixture>) => {
      f.participation.ended = true;
    },
    (f: ReturnType<typeof fixture>) => {
      f.participation.sessionId = "next";
    },
    (f: ReturnType<typeof fixture>) => {
      f.participation.fingerprint = "next-profile";
    },
    (f: ReturnType<typeof fixture>) => {
      f.participation.get("soop", "fixture", "first")!.epoch++;
    },
    (f: ReturnType<typeof fixture>) => {
      f.participation.get("soop", "fixture", "first")!.stage++;
    },
    (f: ReturnType<typeof fixture>) => {
      f.participation.get("soop", "fixture", "first")!.state = "ACTIVE";
    },
  ]) {
    const f = fixture();
    const first = f.message("first");
    const job = f.delivery.next(true)!;
    invalidate(f);
    assert.equal(f.delivery.valid(job.id), false);
    assert(f.delivery.echo("fixture", job.text));
    assert.equal(first.deliveredAt, null);
  }
});

test("fixed notice deadlines use injected time and reject receipt at exact expiry", () => {
  for (const [platform, lifetime] of [
    ["soop", 15000],
    ["youtube", 900000],
  ] as const) {
    const f = fixture(platform);
    const first = f.message("first");
    const job = f.delivery.next(true)!;
    assert.equal(job.expiresAt, f.now() + lifetime);
    assert.equal(job.text.includes("[안내 "), platform === "soop");
    f.advance(lifetime);
    assert.equal(f.delivery.valid(job.id), false);
    assert(f.delivery.echo("fixture", job.text));
    assert.equal(first.deliveredAt, null);
  }
});

test("fixed notice reset invalidates receipts without refunding the send budget", () => {
  const f = fixture();
  f.participation.profile.notices.globalPerMinute = 1;
  f.message("first");
  const job = f.delivery.next(true)!;
  f.delivery.reset();
  f.message("second");
  assert.equal(f.delivery.echo("fixture", job.text), false);
  assert.equal(f.delivery.next(true), null);
  f.advance(60001);
  assert(f.delivery.next(true));
});

test("fixed notice wrong echoes leave the valid job available for its authenticated receipt", () => {
  const f = fixture();
  const first = f.message("first");
  const job = f.delivery.next(true)!;
  assert.equal(f.delivery.echo("viewer", job.text), false);
  assert.equal(f.delivery.echo("fixture", "different"), false);
  assert.equal(f.delivery.valid(job.id), true);
  assert.equal(f.delivery.echo("fixture", job.text), true);
  assert.notEqual(first.deliveredAt, null);
  assert.equal(first.state, "WAITING_CONSENT");
});
