import { spawn } from "node:child_process";
import sharp from "sharp";
let child,
  buffer = Buffer.alloc(0),
  busy = false;
process.on("message", (m) => {
  if (m.type === "stop") {
    child?.kill();
    process.exit(0);
  }
  if (m.type !== "start" || child) return;
  const c = m.config;
  const input =
    c.backend === "rtmp"
      ? ["-i", c.url]
      : c.backend === "dshow"
        ? ["-f", "dshow", "-i", `video=${c.device}`]
        : c.backend === "v4l2"
          ? ["-f", "v4l2", "-i", c.device]
          : ["-f", "avfoundation", "-i", c.device];
  child = spawn(
    c.ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      ...input,
      "-an",
      "-vf",
      `fps=1000/${c.intervalMs}`,
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ],
    { shell: false, stdio: ["ignore", "pipe", "ignore"] },
  );
  child.on("error", () => process.exit(1));
  child.on("exit", () => process.exit(1));
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 8 * 1024 * 1024) {
      buffer = Buffer.alloc(0);
      return;
    }
    for (;;) {
      const start = buffer.indexOf(Buffer.from([255, 216]));
      if (start < 0) return;
      const end = buffer.indexOf(Buffer.from([255, 217]), start + 2);
      if (end < 0) return;
      const jpeg = buffer.subarray(start, end + 2);
      buffer = buffer.subarray(end + 2);
      if (busy) continue;
      busy = true;
      (async () => {
        const meta = await sharp(jpeg, {
          limitInputPixels: 16777216,
        }).metadata();
        const width = meta.width,
          height = meta.height;
        const masks = c.masks.map((r) => {
          const left = Math.floor(r.x * width),
            top = Math.floor(r.y * height);
          const w = Math.min(width - left, Math.ceil(r.width * width)),
            h = Math.min(height - top, Math.ceil(r.height * height));
          return {
            input: {
              create: { width: w, height: h, channels: 3, background: "#000" },
            },
            left,
            top,
          };
        });
        const masked = await sharp(jpeg).composite(masks).toBuffer();
        const result = await sharp(masked)
          .resize({
            width: 1280,
            height: 1280,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 75 })
          .toBuffer({ resolveWithObject: true });
        const bytes = result.data;
        process.send?.({
          type: "frame",
          capturedAt: Date.now(),
          sourceWidth: width,
          sourceHeight: height,
          width: result.info.width,
          height: result.info.height,
          bytes: bytes.toString("base64"),
        });
      })()
        .catch(() => {})
        .finally(() => (busy = false));
    }
  });
});
process.on("disconnect", () => {
  child?.kill();
  process.exit(0);
});
