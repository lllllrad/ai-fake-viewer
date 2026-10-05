import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.ts";
import { workerEnv } from "./capture.ts";

export interface Transcript {
  id: string;
  capturedAt: number;
  text: string;
}

export function wavFromPcm(pcm: Buffer) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const response = z.object({ text: z.string().max(4000) });
export class Transcriber {
  state = "stopped";
  child?: ChildProcess;
  retryTimer?: NodeJS.Timeout;
  controller?: AbortController;
  generation = 0;
  failures = 0;
  requests = 0;
  busy = false;
  transcripts: Transcript[] = [];
  constructor(
    public config: Config["audio"],
    public request: typeof fetch = fetch,
    public onTranscript?: (entry: Transcript) => boolean,
  ) {}
  start() {
    if (this.child) return;
    if (!this.config.url) {
      this.state = "config_required";
      return;
    }
    if (!process.env.GROQ_API_KEY) {
      this.state = "config_required";
      return;
    }
    if (this.requests >= this.config.maxRequests) {
      this.state = "budget_exhausted";
      return;
    }
    clearTimeout(this.retryTimer);
    const generation = ++this.generation;
    this.state = "connecting";
    this.child = fork(new URL("../workers/audio.mjs", import.meta.url), [], {
      env: workerEnv(),
      execArgv: [],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    this.child.on("message", (message: any) => {
      if (generation !== this.generation) return;
      if (message?.type === "activity") {
        if (this.state === "connecting") this.state = "listening";
        return;
      }
      if (message?.type !== "audio") return;
      if (
        typeof message.pcm !== "string" ||
        message.pcm.length > this.config.chunkSeconds * 16000 * 4
      )
        return;
      const pcm = Buffer.from(message.pcm, "base64");
      if (pcm.length !== this.config.chunkSeconds * 16000 * 2) return;
      void this.transcribe(pcm, message.capturedAt);
    });
    this.child.on("error", () => {
      this.state = "failed";
    });
    this.child.on("exit", () => {
      if (generation !== this.generation) return;
      this.child = undefined;
      this.state = "reconnecting";
      this.failures++;
      this.retryTimer = setTimeout(
        () => this.start(),
        Math.min(30000, 1000 * 2 ** Math.min(this.failures, 5)),
      );
    });
    this.child.send({ type: "start", config: this.config });
  }
  async transcribe(pcm: Buffer, capturedAt = Date.now()) {
    if (this.busy || this.state === "stopped") return;
    if (this.requests >= this.config.maxRequests) {
      this.state = "budget_exhausted";
      this.child?.kill();
      return;
    }
    const key = process.env.GROQ_API_KEY;
    if (!key) return;
    this.busy = true;
    this.requests++;
    const generation = this.generation;
    this.controller = new AbortController();
    const signal = AbortSignal.any([
      this.controller.signal,
      AbortSignal.timeout(20000),
    ]);
    const body = new FormData();
    body.set("model", "whisper-large-v3-turbo");
    body.set("response_format", "json");
    if (this.config.language) body.set("language", this.config.language);
    body.set(
      "file",
      new Blob([new Uint8Array(wavFromPcm(pcm))], { type: "audio/wav" }),
      "audio.wav",
    );
    try {
      const result = await this.request(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body,
          signal,
        },
      );
      if (!result.ok) throw Error("Groq transcription request failed");
      const raw = await result.text();
      if (raw.length > 8192) throw Error("Groq transcription too large");
      const text = response.parse(JSON.parse(raw)).text.trim().slice(0, 1000);
      if (generation === this.generation && text) {
        const entry = { id: randomUUID(), capturedAt, text };
        try {
          if (this.onTranscript && !this.onTranscript(entry)) return;
        } catch {
          this.state = "storage_error";
          return;
        }
        this.transcripts.push(entry);
        this.transcripts = this.recent();
        this.state = "receiving";
        this.failures = 0;
      }
    } catch {
      if (generation === this.generation) this.state = "provider_error";
    } finally {
      this.busy = false;
      if (
        generation === this.generation &&
        this.requests >= this.config.maxRequests
      ) {
        this.state = "budget_exhausted";
        this.child?.kill();
      }
    }
  }
  recent() {
    return this.transcripts
      .filter((t) => t.capturedAt > Date.now() - 120000)
      .slice(-12);
  }
  has(id: string) {
    return this.recent().some((t) => t.id === id);
  }
  stop() {
    this.generation++;
    this.controller?.abort();
    clearTimeout(this.retryTimer);
    this.child?.send({ type: "stop" });
    this.child?.kill();
    this.child = undefined;
    this.transcripts = [];
    this.state = "stopped";
  }
}
