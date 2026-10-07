import { test } from "node:test";
import assert from "node:assert/strict";
import { chatHealth, inputHealth } from "../apps/web/src/input-health.ts";

test("healthy input transports share one nontechnical status", () => {
  for (const state of [
    "subscribed:grpc",
    "subscribed:rest",
    "subscribed:unofficial",
    "listening",
    "receiving",
    "demo_fixture",
  ])
    assert.deepEqual(inputHealth(state), { label: "정상" });
  assert.deepEqual(chatHealth(["subscribed:grpc", "disabled", "subscribed"]), {
    label: "정상",
  });
});

test("preparing, inactive and unknown inputs are never reported as healthy", () => {
  assert.equal(
    chatHealth(["subscribed", "connecting", "disabled"]).label,
    "준비 중",
  );
  assert.equal(
    chatHealth(["disabled", "disabled", "disabled"]).label,
    "사용 안 함",
  );
  assert.equal(chatHealth(["stopped", "stopped", "disabled"]).label, "중지됨");
  assert.equal(chatHealth([]).label, "확인 불가");
  assert.equal(chatHealth(["subscribed", undefined]).label, "확인 불가");
  assert.equal(chatHealth(["subscribed", "stopped"]).label, "확인 필요");
});

test("a failing platform takes priority and exposes a useful action instead of a raw state", () => {
  const problem = chatHealth([
    "subscribed:grpc",
    "connecting",
    "permission_blocked",
  ]);
  assert.equal(problem.label, "확인 필요");
  assert.match(problem.hint!, /권한/);
  const unknown = inputHealth("unexpected_transport_error:internal-details");
  assert.equal(unknown.label, "확인 필요");
  assert.ok(!JSON.stringify(unknown).includes("unexpected_transport_error"));
});

test("missing platform approval is an actionable problem, not an unused input", () => {
  const health = inputHealth("privacy_blocked");
  assert.equal(health.label, "확인 필요");
  assert.match(health.hint!, /privacy.approvals/);
  assert.equal(
    chatHealth(["subscribed", "privacy_blocked"]).label,
    "확인 필요",
  );
});

test("authenticated SOOP waiting for browser chat connection names the next action", () => {
  const health = inputHealth("auth_ready", "chat_read");
  assert.match(health.hint!, /계정 인증이 완료/);
  assert.match(health.hint!, /SOOP 채팅 연결/);
  assert.match(inputHealth("awaiting_browser").hint!, /SOOP 채팅 연결/);
});
