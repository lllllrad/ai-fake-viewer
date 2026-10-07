import type { Config } from "../../config.ts";

/** Resolve one dedicated media input and isolate it from historical viewer chat. */
export function applyInputMode(source: Config, demo = false): Config {
  const config = structuredClone(source);
  if (demo) return config;
  if (config.database !== ":memory:") config.database += ".ai-stream";
  return config;
}
