import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SoopAutoConnection,
  type SoopAutoInput,
} from "../apps/web/src/features/soop/auto-connection.ts";
import type { SoopConnectionState } from "../apps/web/src/features/soop/controller.ts";
function fixture() {
  let now = 0,
    starts = 0,
    disposals = 0;
  let phase: SoopConnectionState["phase"] = "idle";
  const automatic = new SoopAutoConnection(
    {
      snapshot: () => ({ phase, message: "" }),
      connect: async () => {
        starts++;
        phase = "connecting";
      },
      disconnect: async () => {
        phase = "idle";
      },
      dispose: () => {
        disposals++;
        phase = "idle";
      },
    },
    () => now,
  );
  const input: SoopAutoInput = {
    sessionId: "first",
    enabled: true,
    stale: false,
    closed: false,
    state: "auth_ready",
  };
  return {
    automatic,
    input,
    advance: (ms: number) => {
      now += ms;
    },
    fail: () => {
      phase = "failed";
    },
    get starts() {
      return starts;
    },
    get disposals() {
      return disposals;
    },
  };
}
test("authorized open broadcasts automatically connect once and throttle retries", () => {
  const f = fixture();
  f.automatic.sync(f.input);
  f.automatic.sync(f.input);
  assert.equal(f.starts, 1);
  f.fail();
  f.automatic.sync(f.input);
  assert.equal(f.starts, 1);
  f.advance(30000);
  f.automatic.sync(f.input);
  assert.equal(f.starts, 2);
});
test("disabled, stale, closed and server-stopped inputs do not auto-connect", () => {
  for (const patch of [
    { enabled: false },
    { stale: true },
    { closed: true },
    ...[
      "stopped",
      "disabled",
      "privacy_blocked",
      "auth_required",
      "config_required",
      "permission_blocked",
    ].map((state) => ({ state })),
  ]) {
    const f = fixture();
    f.automatic.sync({ ...f.input, ...patch });
    assert.equal(f.starts, 0);
  }
});
test("manual disconnect remains stopped until reconnect or a new broadcast", async () => {
  const f = fixture();
  f.automatic.sync(f.input);
  await f.automatic.disconnect();
  f.advance(60000);
  f.automatic.sync(f.input);
  assert.equal(f.starts, 1);
  await f.automatic.connect();
  assert.equal(f.starts, 2);
  await f.automatic.disconnect();
  f.automatic.sync({ ...f.input, sessionId: "second" });
  assert.equal(f.starts, 3);
  assert.equal(f.disposals, 1);
});
test("closing a broadcast retires the browser connection", () => {
  const f = fixture();
  f.automatic.sync(f.input);
  f.automatic.sync({ ...f.input, closed: true });
  assert.equal(f.disposals, 1);
  assert.equal(f.starts, 1);
});
