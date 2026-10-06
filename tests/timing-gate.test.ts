import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TimingGate,
  type TimingGateProvider,
} from "../packages/application/reactions/timing-gate.ts";
const input = {
  description: "Synthetic broadcast",
  persona: { name: "Synthetic", style: "Brief" },
  messages: [],
};
function fixture(maxRequests = 10) {
  const pending: Array<{
    resolve: (value: number) => void;
    reject: (reason: Error) => void;
  }> = [];
  const provider: TimingGateProvider = {
    ensureReady: () => {},
    evaluate: () =>
      new Promise<number>((resolve, reject) =>
        pending.push({ resolve, reject }),
      ),
  };
  const gate = new TimingGate(
    { model: "fixture", timeoutMs: 1000, maxRequests, threshold: 0.8 },
    provider,
  );
  return { gate, pending };
}
for (const outcome of ["success", "error", "aborted"] as const)
  test(`superseded ${outcome} cannot overwrite a successful current timing evaluation`, async () => {
    const { gate, pending } = fixture();
    const controller = new AbortController();
    const old = gate.allow(input, controller.signal);
    const current = gate.allow(input, new AbortController().signal);
    pending[1].resolve(0.1);
    assert.equal(await current, true);
    if (outcome === "aborted") controller.abort();
    if (outcome === "error") pending[0].reject(Error("fixture old failure"));
    else pending[0].resolve(0.9);
    assert.equal(await old, false);
    assert.equal(gate.state, "passed");
    assert.equal(gate.probability, 0.1);
    assert.equal(gate.requests, 2);
    assert.equal(gate.errors, 0);
    assert.equal(gate.filtered, 0);
  });
test("an earlier response cannot override the exhausted request budget", async () => {
  const { gate, pending } = fixture(1);
  const old = gate.allow(input, new AbortController().signal);
  assert.equal(await gate.allow(input, new AbortController().signal), false);
  pending[0].resolve(0.1);
  assert.equal(await old, false);
  assert.equal(gate.state, "budget_exhausted");
  assert.equal(gate.probability, null);
  assert.equal(gate.requests, 1);
});
test("each timing evaluation retains the threshold it started with", async () => {
  const { gate, pending } = fixture();
  const result = gate.allow(input, new AbortController().signal);
  gate.config.threshold = 0.1;
  pending[0].resolve(0.5);
  assert.equal(await result, true);
  assert.equal(gate.state, "passed");
});
test("invalid provider probabilities cannot allow generation", async () => {
  for (const probability of [NaN, Infinity, -1, 2]) {
    const { gate, pending } = fixture();
    const result = gate.allow(input, new AbortController().signal);
    pending[0].resolve(probability);
    assert.equal(await result, false);
    assert.equal(gate.state, "provider_error");
    assert.equal(gate.errors, 1);
    assert.equal(gate.probability, null);
  }
});
test("an aborted current evaluation is canceled without counting a provider failure", async () => {
  const { gate, pending } = fixture();
  const controller = new AbortController();
  const result = gate.allow(input, controller.signal);
  controller.abort();
  pending[0].resolve(0.1);
  assert.equal(await result, false);
  assert.equal(gate.state, "cancelled");
  assert.equal(gate.errors, 0);
});
