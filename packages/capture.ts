import { readFrameEvent } from "./infrastructure/inputs/worker-events.ts";
import { InputWorkerSession } from "./infrastructure/inputs/worker-session.ts";
export { workerEnv } from "./infrastructure/inputs/worker-session.ts";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import type { Config } from "./config.ts";
import {
  ScreenContext,
  type ScreenFrame,
  type ScreenSample,
} from "./application/inputs/screen-context.ts";
export type Frame = ScreenFrame<Buffer>;
export class Capture {
  allowProcessing: () => boolean = () => true;
  private readonly context = new ScreenContext<Buffer>({
    now: () => Date.now(),
    id: randomUUID,
    digest: (bytes) => createHash("sha256").update(bytes).digest("hex"),
  });
  get frames() {
    return this.context.frames;
  }
  get dimensions() {
    return this.context.dimensions;
  }
  clearContext() {
    this.context.invalidate();
  }
  state = "stopped";
  private readonly worker = new InputWorkerSession(
    new URL("../workers/capture.mjs", import.meta.url),
  );
  get child() {
    return this.worker.child;
  }
  timer?: NodeJS.Timeout;
  failures = 0;
  generation = 0;
  lastError = "";
  constructor(
    public config: Config["capture"],
    public demo = false,
  ) {}
  start() {
    if (!this.allowProcessing()) {
      this.state = "privacy_blocked";
      return;
    }
    if (
      !this.demo &&
      !(this.config.backend === "rtmp" ? this.config.url : this.config.device)
    ) {
      this.state = "config_required";
      this.lastError = "Configure a capture source in config.yaml.";
      return;
    }
    if (this.child || this.timer) return;
    this.worker.cancelRetry();
    this.context.begin();
    const generation = ++this.generation;
    if (this.demo) {
      this.state = "demo";
      let n = 0;
      const tick = async () => {
        const color = n++ % 2 ? "#52d6bd" : "#f4b56a";
        const svg = `<svg width="960" height="540"><rect width="960" height="540" fill="#10242d"/><circle cx="${200 + (n % 4) * 140}" cy="270" r="75" fill="${color}"/><text x="40" y="60" fill="white" font-size="26">DEMO · artificial frame ${n}</text></svg>`;
        const bytes = await sharp(Buffer.from(svg)).jpeg().toBuffer();
        if (generation === this.generation)
          this.add(
            { capturedAt: Date.now(), width: 960, height: 540, bytes },
            "demo",
          );
      };
      void tick();
      this.timer = setInterval(() => void tick(), 3000);
      return;
    }
    this.lastError = "";
    this.state = "connecting";
    this.worker.start(
      { type: "start", config: this.config },
      {
        message: (value) => {
          if (generation !== this.generation) return;
          const sample = readFrameEvent(value);
          if (sample) this.add(sample, "obs_program");
        },
        error: () => {
          this.state = "failed";
          this.context.discard();
          this.lastError = `Could not start FFmpeg (${this.config.ffmpeg}). Check the binary path and capture device/RTMP URL.`;
        },
        exit: (code, signal) => {
          this.state = "failed";
          this.context.discard();
          this.lastError = `FFmpeg capture process exited (code ${code ?? "unknown"}, signal ${signal ?? "none"}). Check OBS Program output, capture device/RTMP URL, and FFmpeg availability.`;
          if (++this.failures <= 5) {
            this.state = "reconnecting";
            this.worker.retry(Math.min(30000, 1000 * 2 ** this.failures), () =>
              this.start(),
            );
          }
        },
      },
    );
  }
  add(sample: ScreenSample<Buffer>, source: Frame["source"]) {
    if (!this.allowProcessing()) return;
    const maskVersion = createHash("sha256")
      .update(JSON.stringify(this.config.masks))
      .digest("hex");
    if (!this.context.accept(sample, source, maskVersion)) return;
    this.failures = 0;
    this.lastError = "";
    this.state = this.demo ? "demo" : "receiving";
  }
  recent() {
    return this.context.recent();
  }
  latest() {
    return this.context.latest();
  }
  has(id: string) {
    return this.context.has(id);
  }
  stop() {
    this.generation++;
    this.worker.cancelRetry();
    clearInterval(this.timer);
    this.timer = undefined;
    this.worker.stop();
    this.context.discard();
    this.state = "stopped";
    this.lastError = "";
  }
}
