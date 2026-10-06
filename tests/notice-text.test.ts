import { test } from "node:test";
import assert from "node:assert/strict";
import { fixedNoticeText } from "../packages/domain/participation/notice-text.ts";

test("one notice normalizes spacing and has no multipart counter", () => {
  assert.equal(
    fixedNoticeText("  안내\n https://example.test/policy  "),
    "[안내] 안내 https://example.test/policy",
  );
});

test("notice body budgets reject complete oversized content instead of splitting or truncating", () => {
  for (const budget of [88, 170]) {
    const exact = "a".repeat(budget);
    assert.equal(fixedNoticeText(exact, budget), `[안내] ${exact}`);
    assert.throws(() => fixedNoticeText(`${exact} b`, budget), {
      message: "notice_too_long",
    });
    assert.throws(
      () => fixedNoticeText(`https://example.test/${exact}`, budget),
      { message: "notice_too_long" },
    );
  }
});

test("empty notices and invalid budgets cannot produce sendable text", () => {
  assert.throws(() => fixedNoticeText(" \n "), { message: "notice_too_long" });
  for (const budget of [0, -1, 1.5, NaN, Infinity])
    assert.throws(() => fixedNoticeText("notice", budget), {
      message: "notice_too_long",
    });
});
