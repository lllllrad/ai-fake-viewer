import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectReadiness,
  type ReadinessFacts,
} from "../packages/application/status/readiness.ts";
const facts: ReadinessFacts = {
  demo: false,
  streamConfigured: true,
  modelReady: true,
  screenRecent: false,
  speechState: "stopped",
};
test("optional unavailable inputs remain visible without blocking AI start", () => {
  const result = projectReadiness(facts);
  assert.equal(result.ready, true);
  assert.deepEqual(
    result.checks.filter((check) => !check.ready).map((check) => check.id),
    ["capture", "audio"],
  );
  assert(
    result.checks
      .filter((check) => !check.ready)
      .every((check) => check.optional),
  );
});
for (const field of ["streamConfigured", "modelReady"] as const)
  test(`${field} is required in the same readiness result used for AI start`, () => {
    const result = projectReadiness({ ...facts, [field]: false });
    assert.equal(result.ready, false);
    assert.equal(
      result.checks.filter((check) => !check.optional && !check.ready).length,
      1,
    );
  });
test("demo readiness is independent of live accounts and inputs", () => {
  assert.equal(
    projectReadiness({
      ...facts,
      demo: true,
      streamConfigured: false,
      modelReady: false,
    }).ready,
    true,
  );
});
test("configured media sources are reported consistently", () => {
  const result = projectReadiness({
    ...facts,
    screenRecent: true,
    speechState: "listening",
  });
  assert(result.checks.every((check) => check.ready));
});
