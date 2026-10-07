import type { Config } from "../../config.ts";

/** Resolve one dedicated media input and isolate it from historical viewer chat. */
export function applyInputMode(source: Config, demo = false): Config {
  const config = structuredClone(source);
  if (demo) {
    config.input.mode = "broadcast";
    return config;
  }
  if (config.input.mode !== "ai_stream") return config;
  config.capture = {
    ...config.capture,
    backend: "rtmp",
    device: "",
    url: config.input.streamUrl,
  };
  config.audio = { ...config.audio, url: config.input.streamUrl };
  config.youtube.enabled = false;
  config.chzzk.enabled = false;
  config.soop.mode = "disabled";
  for (const platform of ["youtube", "chzzk", "soop"] as const)
    config[platform].consentNoticeEnabled = false;
  if (config.database !== ":memory:") config.database += ".ai-stream";
  return config;
}
