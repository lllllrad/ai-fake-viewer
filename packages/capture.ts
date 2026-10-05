import { fork, type ChildProcess } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import type { Config } from "./config.ts";
export interface Frame {
  id: string;
  capturedAt: number;
  width: number;
  height: number;
  bytes: Buffer;
  hash: string;
  source: "obs_program" | "demo";
  maskConfigVersion: string;
}
export function workerEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) =>
        [
          "PATH",
          "SystemRoot",
          "WINDIR",
          "TEMP",
          "TMP",
          "HOME",
          "USERPROFILE",
        ].includes(k) && v,
    ),
  ) as NodeJS.ProcessEnv;
}
export class Capture {
  frames: Frame[] = [];
  state = "stopped";
  child?: ChildProcess;
  timer?: NodeJS.Timeout;
  retryTimer?: NodeJS.Timeout;
  failures = 0;
  generation = 0;
  dimensions = "";
  lastError = "";
  constructor(
    public config: Config["capture"],
    public demo = false,
  ) {}
  start() {
    if (this.child || this.timer) return;
    clearTimeout(this.retryTimer);
    this.frames = [];
    this.dimensions = "";
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
    this.child = fork(new URL("../workers/capture.mjs", import.meta.url), [], {
      env: workerEnv(),
      execArgv: [],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    this.child.on("message", (m: any) => {
      if (
        m.type === "frame" &&
        typeof m.bytes === "string" &&
        m.bytes.length < 4 * 1024 * 1024 &&
        generation === this.generation
      )
        this.add(
          { ...m, bytes: Buffer.from(m.bytes, "base64") },
          "obs_program",
        );
    });
    this.child.on("error", () => {
      this.state = "failed";
      this.frames = [];
      this.lastError = `Could not start FFmpeg (${this.config.ffmpeg}). Check the binary path and capture device/RTMP URL.`;
    });
    this.child.on("exit", (code, signal) => {
      if (generation === this.generation) {
        this.child = undefined;
        this.state = "failed";
        this.frames = [];
        this.lastError = `FFmpeg capture process exited (code ${code ?? "unknown"}, signal ${signal ?? "none"}). Check OBS Program output, capture device/RTMP URL, and FFmpeg availability.`;
        if (++this.failures <= 5) {
          this.state = "reconnecting";
          this.retryTimer = setTimeout(
            () => this.start(),
            Math.min(30000, 1000 * 2 ** this.failures),
          );
        }
      }
    });
    this.child.send({ type: "start", config: this.config });
  }
  add(
    m: {
      capturedAt: number;
      width: number;
      height: number;
      bytes: Buffer;
      sourceWidth?: number;
      sourceHeight?: number;
    },
    source: Frame["source"],
  ) {
    this.failures = 0;
    this.lastError = "";
    const dims = `${m.sourceWidth ?? m.width}x${m.sourceHeight ?? m.height}`;
    if (this.dimensions && dims !== this.dimensions) {
      this.frames = [];
    }
    this.state = this.demo ? "demo" : "receiving";
    this.dimensions = dims;
    this.frames.push({
      ...m,
      id: randomUUID(),
      source,
      hash: createHash("sha256").update(m.bytes).digest("hex"),
      maskConfigVersion: createHash("sha256")
        .update(JSON.stringify(this.config.masks))
        .digest("hex"),
    });
    this.frames = this.frames
      .filter((f) => f.capturedAt > Date.now() - 30000)
      .slice(-10);
  }
  recent() {
    return this.frames
      .filter((f) => f.capturedAt > Date.now() - 10000)
      .slice(-3);
  }
  latest() {
    return this.frames.at(-1);
  }
  has(id: string) {
    return this.frames.some(
      (frame) => frame.id === id && frame.capturedAt > Date.now() - 10000,
    );
  }
  stop() {
    this.generation++;
    clearTimeout(this.retryTimer);
    clearInterval(this.timer);
    this.timer = undefined;
    this.child?.send({ type: "stop" });
    this.child?.kill();
    this.child = undefined;
    this.frames = [];
    this.state = "stopped";
    this.lastError = "";
  }
}
