import { spawn } from "node:child_process";

let ffmpeg;
import {
  PcmChunks,
  speechSampleRate,
} from "../packages/domain/inputs/pcm-chunks.ts";
const sampleRate = speechSampleRate;

process.on("message", (message) => {
  if (message.type === "stop") {
    ffmpeg?.kill();
    process.exit(0);
  }
  if (message.type !== "start" || ffmpeg) return;
  const { ffmpeg: executable, url, chunkSeconds } = message.config;
  const chunks = new PcmChunks(chunkSeconds);
  ffmpeg = spawn(
    executable,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-i",
      url,
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-acodec",
      "pcm_s16le",
      "-f",
      "s16le",
      "pipe:1",
    ],
    { shell: false, stdio: ["ignore", "pipe", "ignore"] },
  );
  ffmpeg.on("error", () => process.exit(1));
  ffmpeg.on("exit", () => process.exit(1));
  ffmpeg.stdout.on("data", (data) => {
    for (const chunk of chunks.push(data)) {
      const capturedAt = Date.now();
      process.send?.({ type: "activity", capturedAt });
      if (chunk.speech)
        process.send?.({
          type: "audio",
          capturedAt,
          pcm: Buffer.from(chunk.pcm).toString("base64"),
        });
    }
  });
});
process.on("disconnect", () => {
  ffmpeg?.kill();
  process.exit(0);
});
