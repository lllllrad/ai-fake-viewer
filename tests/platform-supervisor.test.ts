import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Supervisor } from "../packages/infrastructure/inputs/platform-supervisor.ts";
import { Store } from "../packages/storage.ts";
import { Participation } from "../packages/infrastructure/participation/runtime.ts";
import { configSchema } from "../packages/config.ts";
import type { ChzzkAuth } from "../packages/infrastructure/accounts/chzzk-auth.ts";
import { approvedProfile } from "./privacy-fixtures.ts";

function fixture(t: TestContext, selected = true) {
  const config = configSchema.parse({
    privacy: approvedProfile(),
    youtube: { enabled: selected },
    chzzk: { enabled: selected },
    soop: { mode: selected ? "official" : "disabled", streamerId: "fixture" },
  });
  const participation = new Participation(config.privacy, "");
  const store = new Store(":memory:", participation);
  const supervisor = new Supervisor(config, store, {} as ChzzkAuth);
  t.after(async () => {
    await supervisor.stop();
    store.close();
  });
  const launched: string[] = [];
  t.mock.method(supervisor, "launch", (platform: string) => {
    launched.push(platform);
    return true;
  });
  return { config, store, participation, supervisor, launched };
}

test("restarting configured inputs preserves an active official SOOP browser connection", (t) => {
  const f = fixture(t);
  f.supervisor.start();
  assert.equal(f.supervisor.states.soop.state, "awaiting_browser");
  for (const state of ["connecting", "subscribed"]) {
    f.supervisor.status("soop", state);
    f.supervisor.start();
    assert.equal(f.supervisor.states.soop.state, state);
  }
});

test("a previous profile block cannot prevent starting currently permitted receivers", (t) => {
  const f = fixture(t);
  let available = false;
  t.mock.method(f.participation, "available", () => available);
  f.supervisor.start();
  assert.deepEqual(f.launched, []);
  for (const platform of ["youtube", "chzzk", "soop"])
    assert.equal(f.supervisor.states[platform].state, "privacy_blocked");
  available = true;
  f.supervisor.start();
  assert.deepEqual(f.launched, ["youtube", "chzzk"]);
  assert.equal(f.supervisor.states.soop.state, "awaiting_browser");
});

test("unselected platforms remain disabled instead of becoming profile errors", (t) => {
  const f = fixture(t, false);
  t.mock.method(f.participation, "available", () => false);
  f.supervisor.start();
  assert.deepEqual(f.launched, []);
  for (const platform of ["youtube", "chzzk", "soop"])
    assert.equal(f.supervisor.states[platform].state, "disabled");
});

test("a closed broadcast cannot restart platform input composition", (t) => {
  const f = fixture(t);
  f.store.lifetime.end();
  f.supervisor.start();
  assert.deepEqual(f.launched, []);
  assert.equal(f.supervisor.states.soop.state, "disabled");
});

test("live participation never selects the reference SOOP library", (t) => {
  const f = fixture(t, false);
  f.config.soop.mode = "experimental_library";
  f.config.soop.experimentalConsent = true;
  t.mock.method(f.supervisor, "soop", async () =>
    assert.fail("Reference receiver must not run live"),
  );
  f.supervisor.start();
  assert.deepEqual(f.launched, []);
});
