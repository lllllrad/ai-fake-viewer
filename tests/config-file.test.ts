import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import {
  loadConfig,
  prepareConfigFile,
  saveDisplayChatSettings,
} from "../packages/config-file.ts";
import { configSchema } from "../packages/config.ts";
import { displayChatSettingsSchema } from "../packages/contracts/display-chat.ts";
import { DisplayChatConnections } from "../packages/infrastructure/platforms/display-chat.ts";

test("platform UI saves round-trip through YAML, preserving unrelated edits and comments", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "config-file-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "config.yaml");
  writeFileSync(
    path,
    "# Operator comment\nport: 3219\nai:\n  description: Synthetic topic\n",
  );
  const gateway = new DisplayChatConnections(
    loadConfig(path).displayChat,
    "e".repeat(64),
    {
      session: () => "fixture",
      closed: () => false,
      receive: () => true,
      port: 3219,
      demo: true,
      directory: dir,
      persist: (settings) => saveDisplayChatSettings(settings, path),
    },
  );
  t.after(() => gateway.close());
  const settings = displayChatSettingsSchema.parse({
    youtube: { channelId: "synthetic-channel", video: "synthetic-video" },
    soop: { streamerId: "synthetic-streamer", enabled: false },
  });
  await gateway.save(settings);
  assert.deepEqual(loadConfig(path).displayChat, settings);
  assert.equal(loadConfig(path).ai.description, "Synthetic topic");
  assert.equal(loadConfig(path).port, 3219);
  assert.match(readFileSync(path, "utf8"), /# Operator comment/);
  assert.equal(existsSync(join(dir, "display-chat.settings.json")), false);
  const original = gateway.settings;
  writeFileSync(path, "broken: [");
  await assert.rejects(
    gateway.save(displayChatSettingsSchema.parse({})),
    /Invalid YAML/,
  );
  assert.deepEqual(gateway.settings, original);
  assert.equal(readFileSync(path, "utf8"), "broken: [");
});

test("startup migrates obsolete settings once without losing effective platform IDs or opt-outs", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "config-migration-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "config.yaml"),
    legacy = join(dir, "display-chat.settings.json");
  writeFileSync(
    path,
    stringify({
      database: join(dir, "broadcast.sqlite"),
      input: { streamUrl: "rtmp://127.0.0.1/live/ai" },
      ai: { maxCalls: 1, manualApproval: true },
      capture: {
        backend: "dshow",
        device: "obsolete",
        url: "obsolete",
        programConfirmed: false,
      },
      audio: { url: "obsolete" },
    }),
  );
  const settings = displayChatSettingsSchema.parse({
    soop: { streamerId: "synthetic-streamer" },
    youtube: { enabled: false, channelId: "synthetic-owner" },
  });
  writeFileSync(legacy, JSON.stringify(settings));
  const migrated = prepareConfigFile(path);
  assert.deepEqual(migrated.displayChat, settings);
  assert.equal(migrated.ai.manualApproval, true);
  assert.equal(migrated.input.streamUrl, "rtmp://127.0.0.1/live/ai");
  assert.equal(existsSync(legacy), false);
  assert.doesNotMatch(
    readFileSync(path, "utf8"),
    /maxCalls|programConfirmed|obsolete/,
  );
  const written = readFileSync(path, "utf8");
  assert.deepEqual(prepareConfigFile(path), migrated);
  assert.equal(readFileSync(path, "utf8"), written);
});

test("malformed legacy data leaves both configuration sources untouched", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "config-failure-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "config.yaml"),
    legacy = join(dir, "display-chat.settings.json");
  const original = stringify({
    database: join(dir, "broadcast.sqlite"),
    ai: { maxCalls: 1 },
  });
  writeFileSync(path, original);
  writeFileSync(legacy, "invalid json");
  assert.throws(() => prepareConfigFile(path));
  assert.equal(readFileSync(path, "utf8"), original);
  assert.equal(readFileSync(legacy, "utf8"), "invalid json");
});

test("current configuration rejects removed camera and call-limit fields", () => {
  for (const value of [
    { ai: { maxCalls: 1 } },
    { capture: { backend: "dshow" } },
    { capture: { programConfirmed: true } },
    { audio: { url: "rtmp://127.0.0.1/unused" } },
  ])
    assert.equal(configSchema.safeParse(value).success, false);
});
