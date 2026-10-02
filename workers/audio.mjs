import { spawn } from "node:child_process";

let ffmpeg;
let buffer = Buffer.alloc(0);
const sampleRate = 16000;
const bytesPerSample = 2;

process.on("message", (message) => {
  if (message.type === "stop") {
    ffmpeg?.kill();
    process.exit(0);
  }
  if (message.type !== "start" || ffmpeg) return;
  const { ffmpeg: executable, url, chunkSeconds } = message.config;
  const chunkBytes = sampleRate * bytesPerSample * chunkSeconds;
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
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= chunkBytes) {
      const chunk = buffer.subarray(0, chunkBytes);
      buffer = buffer.subarray(chunkBytes);
      let energy = 0;
      for (let i = 0; i < chunk.length; i += 2) {
        const sample = chunk.readInt16LE(i);
        energy += sample * sample;
      }
      const rms = Math.sqrt(energy / (chunkBytes / 2));
      process.send?.({ type: "activity", capturedAt: Date.now() });
      if (rms > 140)
        process.send?.({
          type: "audio",
          capturedAt: Date.now(),
          pcm: chunk.toString("base64"),
        });
    }
    if (buffer.length > chunkBytes * 2) buffer = buffer.subarray(-chunkBytes);
  });
});
process.on("disconnect", () => {
  ffmpeg?.kill();
  process.exit(0);
});
