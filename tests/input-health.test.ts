import { test } from "node:test";
import assert from "node:assert/strict";
import { inputHealth } from "../apps/web/src/input-health.ts";
test("media health distinguishes receiving, connecting, stopped, closed and failed", () => {
  assert.equal(inputHealth("receiving").label, "정상");
  assert.equal(inputHealth("connecting").label, "준비 중");
  assert.equal(inputHealth("stopped").label, "중지됨");
  assert.match(inputHealth("session_closed").hint!, /방송이 종료/);
  assert.match(
    inputHealth("quota_blocked", "transcription").hint!,
    /음성 인식/,
  );
  assert.equal(inputHealth("failed").label, "확인 필요");
  assert.equal(inputHealth(undefined).label, "확인 불가");
});
