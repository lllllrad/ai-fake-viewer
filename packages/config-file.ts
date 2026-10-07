import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseDocument } from "yaml";
import { configSchema } from "./config.ts";
import {
  displayChatSettingsSchema,
  type DisplayChatSettings,
} from "./contracts/display-chat.ts";

function documentAt(path: string) {
  const document = parseDocument(
    existsSync(path) ? readFileSync(path, "utf8") : "{}\n",
  );
  if (document.errors.length) throw Error("Invalid YAML configuration");
  return document;
}

function writeDocument(path: string, document: ReturnType<typeof documentAt>) {
  configSchema.parse(document.toJS());
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temporary, document.toString(), { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Read current configuration without writing or consulting an override store. */
export function loadConfig(path = "config.yaml") {
  return configSchema.parse(documentAt(path).toJS());
}

/** One-time startup migration: preserve the previously effective platform targets. */
export function prepareConfigFile(path = "config.yaml") {
  const document = documentAt(path);
  let changed = false;
  for (const keys of [
    ["ai", "maxCalls"],
    ["capture", "programConfirmed"],
    ["capture", "backend"],
    ["capture", "device"],
    ["capture", "url"],
    ["audio", "url"],
  ]) {
    if (document.hasIn(keys)) {
      document.deleteIn(keys);
      changed = true;
    }
  }
  const config = configSchema.parse(document.toJS());
  const legacy = join(dirname(config.database), "display-chat.settings.json");
  if (config.database !== ":memory:" && existsSync(legacy)) {
    const settings = displayChatSettingsSchema.parse(
      JSON.parse(readFileSync(legacy, "utf8")),
    );
    document.set("displayChat", settings);
    changed = true;
  }
  if (changed) writeDocument(path, document);
  // Never remove the previous source before its validated replacement is on disk.
  if (config.database !== ":memory:" && existsSync(legacy)) rmSync(legacy);
  return configSchema.parse(document.toJS());
}

export function saveDisplayChatSettings(
  settings: DisplayChatSettings,
  path = "config.yaml",
) {
  const document = documentAt(path);
  const next = displayChatSettingsSchema.parse(settings);
  // Read afresh so an unrelated manual configuration edit is not overwritten.
  for (const platform of ["youtube", "chzzk", "soop"] as const) {
    for (const [key, value] of Object.entries(next[platform]))
      document.setIn(["displayChat", platform, key], value);
  }
  writeDocument(path, document);
}
