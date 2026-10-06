import { test } from "node:test";
import assert from "node:assert/strict";
import { ScreenContext } from "../packages/application/inputs/screen-context.ts";
import {
  readFrameEvent,
  readAudioEvent,
} from "../packages/infrastructure/inputs/worker-events.ts";

function fixture() {
  let now = 100000,
    id = 0;
  const context = new ScreenContext({
    now: () => now,
    id: () => String(++id),
    digest: (bytes: Uint8Array) => Array.from(bytes).join(","),
  });
  const add = (capturedAt = now, width = 640) =>
    context.accept(
      {
        capturedAt,
        width,
        height: 360,
        bytes: new Uint8Array([1, 2]),
      },
      "obs_program",
      "mask",
    );
  return {
    context,
    add,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test("screen evidence has separate preview and authorization expiry windows", () => {
  const f = fixture();
  f.add();
  const frame = f.context.latest()!;
  assert.equal(frame.hash, "1,2");
  f.advance(10000);
  assert.deepEqual(f.context.recent(), []);
  assert.equal(f.context.has(frame.id), true);
  f.advance(20000);
  assert.equal(f.context.has(frame.id), false);
  f.add();
  assert.equal(f.context.frames.length, 1);
});
test("screen windows retain ten frames and expose only three recent ones", () => {
  const f = fixture();
  for (let i = 0; i < 15; i++) {
    f.add();
    f.advance(1);
  }
  assert.equal(f.context.frames.length, 10);
  assert.deepEqual(
    f.context.recent().map((x) => x.id),
    ["13", "14", "15"],
  );
});
test("context invalidation rejects old and same-time frames after a restart", () => {
  const f = fixture();
  f.add();
  f.context.invalidate();
  f.context.begin();
  assert.equal(f.add(99999), false);
  assert.equal(f.add(100000), false);
  assert.equal(f.context.frames.length, 0);
  f.advance(1);
  assert.equal(f.add(), true);
});
test("source resolution changes invalidate prior frames without confusing resized output", () => {
  const f = fixture();
  const sample = {
    capturedAt: 100000,
    width: 640,
    height: 360,
    bytes: new Uint8Array([1]),
    sourceWidth: 1920,
    sourceHeight: 1080,
  };
  f.context.accept(sample, "obs_program", "mask");
  f.context.accept(
    { ...sample, sourceWidth: 1280, sourceHeight: 720 },
    "obs_program",
    "mask",
  );
  assert.equal(f.context.frames.length, 1);
  assert.equal(f.context.dimensions, "1280x720");
  f.context.begin();
  assert.equal(f.context.dimensions, "");
});
test("invalid timestamps cannot become permanent screen evidence", () => {
  const f = fixture();
  for (const time of [NaN, Infinity, -1, 1.5]) assert.equal(f.add(time), false);
  assert.equal(f.context.frames.length, 0);
});
test("frame IPC validates shape and canonical encoding and strips unknown fields", () => {
  const valid = {
    type: "frame",
    capturedAt: 100,
    width: 640,
    height: 360,
    bytes: "AQI=",
    unwanted: "private",
  };
  assert.deepEqual(readFrameEvent(valid), {
    capturedAt: 100,
    width: 640,
    height: 360,
    bytes: Buffer.from([1, 2]),
  });
  for (const value of [
    null,
    {},
    { ...valid, capturedAt: NaN },
    { ...valid, width: 0 },
    { ...valid, width: 1281 },
    { ...valid, bytes: "A!QI=" },
    { ...valid, bytes: "AQI" },
    { ...valid, bytes: "A".repeat(4 * 1024 * 1024) },
  ])
    assert.equal(readFrameEvent(value), undefined);
});
test("audio IPC accepts exactly the configured PCM chunk and a separate activity event", () => {
  const pcm = Buffer.alloc(32000, 1);
  const valid = { type: "audio", capturedAt: 100, pcm: pcm.toString("base64") };
  assert.deepEqual(readAudioEvent(valid, 1), {
    type: "audio",
    capturedAt: 100,
    pcm,
  });
  assert.deepEqual(readAudioEvent({ type: "activity", capturedAt: 100 }, 1), {
    type: "activity",
    capturedAt: 100,
  });
  for (const value of [
    null,
    {},
    { ...valid, capturedAt: -1 },
    { ...valid, pcm: valid.pcm.slice(1) },
    { ...valid, pcm: "!" + valid.pcm.slice(1) },
    { type: "activity" },
  ])
    assert.equal(readAudioEvent(value, 1), undefined);
  assert.equal(readAudioEvent(valid, 2), undefined);
  assert.equal(readAudioEvent(valid, Infinity), undefined);
});
