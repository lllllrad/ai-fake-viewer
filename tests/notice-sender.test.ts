import { test } from "node:test";
import assert from "node:assert/strict";
import { NoticeSender } from "../packages/application/participation/notice-sender.ts";
import { ParticipationService } from "../packages/application/participation/service.ts";
import type {
  NoticeTransport,
  NoticeSendResult,
} from "../packages/application/participation/notice-transport.ts";
import { approvedProfile } from "./privacy-fixtures.ts";
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  let now = 100000,
    id = 0;
  const runtime = {
    now: () => now,
    id: () => String(++id),
    fingerprint: () => "profile",
  };
  const p = new ParticipationService(approvedProfile(), "broadcast", runtime);
  const sent: string[] = [];
  let response: () => Promise<NoticeSendResult> = async () => ({
    status: "delivered",
  });
  const transport: NoticeTransport = {
    availability: () => "ready",
    send: async (notice, _signal, eligibility) => {
      assert(eligibility.valid());
      eligibility.sending();
      sent.push(notice.text);
      return response();
    },
  };
  const sender = new NoticeSender(p, "youtube", transport, runtime);
  sender.resolve("chat", "fixture");
  sender.connected = true;
  now++;
  p.handle({
    platform: "youtube",
    channel: "fixture",
    author: "viewer",
    text: "hello",
    publishedAt: now,
    sourceId: runtime.id(),
  });
  const person = p.get("youtube", "fixture", "viewer")!;
  const signal = new AbortController().signal;
  return {
    sender,
    p,
    person,
    sent,
    transport,
    signal,
    advance: (ms: number) => {
      now += ms;
    },
    respond: (fn: typeof response) => {
      response = fn;
    },
  };
}

test("notice sender permits only one insertion and does not repeat confirmed guidance", async () => {
  const f = fixture(),
    pending = deferred<NoticeSendResult>();
  f.respond(() => pending.promise);
  const sending = f.sender.tick(f.signal);
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 1);
  pending.resolve({ status: "delivered" });
  await sending;
  assert.notEqual(f.person.deliveredAt, null);
  assert.equal(f.person.state, "WAITING_CONSENT");
  f.advance(60001);
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 1);
});

test("notice sender does not reserve attempts when account authorization is unavailable", async () => {
  const f = fixture();
  f.transport.availability = () => "auth_required";
  await f.sender.tick(f.signal);
  assert.equal(f.person.lastNoticeAt, 0);
  assert.equal(f.sent.length, 0);
  assert.equal(f.sender.state, "auth_required");
});

test("notice sender preserves scoped provider failure and waits its full retry delay", async () => {
  const f = fixture();
  const failure = {
    api: "fixture insertion",
    operation: "send" as const,
    state: "quota_blocked",
  };
  f.respond(async () => ({ status: "rejected", failure, retryAfterMs: 60000 }));
  await f.sender.tick(f.signal);
  assert.deepEqual(f.sender.failure, failure);
  assert.equal(f.sender.state, "quota_blocked");
  f.advance(59999);
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 1);
  f.advance(1);
  f.respond(async () => ({ status: "delivered" }));
  await f.sender.tick(f.signal);
  assert.equal(f.sent.length, 2);
  assert.equal(f.sender.failure, undefined);
});

test("notice sender reset discards both late success and late exceptions", async () => {
  for (const reject of [true, false]) {
    const f = fixture(),
      pending = deferred<NoticeSendResult>();
    f.respond(() => pending.promise);
    const sending = f.sender.tick(f.signal);
    f.sender.reset();
    if (reject) pending.reject(Error("old request"));
    else pending.resolve({ status: "delivered" });
    await sending;
    assert.equal(f.sender.state, "waiting_connection");
    assert.equal(f.person.deliveredAt, null);
    assert.equal(f.sender.failure, undefined);
  }
});

test("notice sender rechecks transport receipt ownership before confirming delivery", async () => {
  const f = fixture();
  f.respond(async () => ({ status: "delivered", current: () => false }));
  await f.sender.tick(f.signal);
  assert.equal(f.person.deliveredAt, null);
});

test("notice sender can resume a pre-insertion connection pause without granting early consent", async () => {
  const f = fixture();
  f.respond(async () => ({ status: "waiting_connection" }));
  await f.sender.tick(f.signal);
  assert.equal(f.person.deliveredAt, null);
  assert.equal(f.sender.state, "waiting_connection");
  f.advance(60001);
  f.respond(async () => ({ status: "delivered" }));
  await f.sender.tick(f.signal);
  assert.notEqual(f.person.deliveredAt, null);
  assert.equal(f.person.stage, 0);
});
