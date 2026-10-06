import { test } from "node:test";
import assert from "node:assert/strict";
import { ProfileUpdate } from "../packages/application/participation/profile-update.ts";
import { approvedProfile } from "./privacy-fixtures.ts";
function fixture() {
  let current = approvedProfile();
  const events: string[] = [];
  const ports = {
    current: () => current,
    reconfigure: async (apply: () => void) => {
      events.push("stop");
      apply();
      return true;
    },
    clearSpeech: () => {
      events.push("clear");
    },
    install: (profile: typeof current) => {
      events.push("install");
      current = profile;
    },
  };
  return { service: new ProfileUpdate(ports), ports, events };
}
test("profile update validates before stopping and installs only through the lifecycle barrier", async () => {
  const f = fixture(),
    next = { ...f.ports.current(), contact: "new@example.test" };
  const result = await f.service.update(next);
  assert.deepEqual(f.events, ["stop", "clear", "install"]);
  assert.equal(result.profile.contact, next.contact);
});
test("database relocation and processing changes without a new notice are rejected before effects", async () => {
  const f = fixture();
  await assert.rejects(
    f.service.update({ ...f.ports.current(), rightsDatabase: "new.sqlite" }),
  );
  await assert.rejects(
    f.service.update({ ...f.ports.current(), operator: "changed" }),
  );
  await assert.rejects(f.service.update({ contact: false }));
  assert.deepEqual(f.events, []);
});
test("a superseded profile command neither clears speech nor installs settings", async () => {
  const f = fixture();
  f.ports.reconfigure = async () => false;
  await assert.rejects(f.service.update(f.ports.current()), /취소/);
  assert.deepEqual(f.events, []);
});
test("failed speech erasure prevents installing a profile", async () => {
  const f = fixture();
  f.ports.clearSpeech = () => {
    throw new Error("storage failed");
  };
  await assert.rejects(f.service.update(f.ports.current()), /storage failed/);
  assert.deepEqual(f.events, ["stop"]);
});
