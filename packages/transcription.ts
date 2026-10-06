import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.ts";
import { workerEnv } from "./capture.ts";

import {
  transcribeSpeech,
  type Transcript,
} from "./application/inputs/transcribe-speech.ts";
import { groqSpeech } from "./infrastructure/inputs/groq-speech.ts";
export type { Transcript } from "./application/inputs/transcribe-speech.ts";
export { wavFromPcm } from "./infrastructure/inputs/groq-speech.ts";

export class Transcriber {
  allowProcessing: () => boolean = () => true;
  state = "stopped";
  child?: ChildProcess;
  retryTimer?: NodeJS.Timeout;
  controller?: AbortController;
  generation = 0;
  contextRevision = 0;
  failures = 0;
  requests = 0;
  onRequest?: (count: number) => void;
  busy = false;
  transcripts: Transcript[] = [];
  constructor(
    public config: Config["audio"],
    public request: typeof fetch = fetch,
    public onTranscript?: (entry: Transcript) => boolean,
  ) {}
  start() {
    if (!this.allowProcessing()) {
      this.state = "privacy_blocked";
      return;
    }
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
    if (!this.allowProcessing() || this.busy || this.state === "stopped")
      return;
    if (this.requests >= this.config.maxRequests) {
      this.state = "budget_exhausted";
      this.child?.kill();
      return;
    }
    const key = process.env.GROQ_API_KEY;
    if (!key) return;
    this.busy = true;
    const generation = this.generation;
    const contextRevision = this.contextRevision;
    this.controller = new AbortController();
    const signal = AbortSignal.any([
      this.controller.signal,
      AbortSignal.timeout(20000),
    ]);
    const current = () =>
      generation === this.generation &&
      contextRevision === this.contextRevision &&
      this.allowProcessing();
    try {
      const outcome = await transcribeSpeech({
        capturedAt,
        current,
        reserve: () => {
          this.requests++;
          this.onRequest?.(this.requests);
        },
        request: () =>
          groqSpeech({
            pcm,
            language: this.config.language,
            key,
            signal,
            request: this.request,
          }),
        publish: (entry) => this.onTranscript?.(entry) ?? true,
        id: randomUUID,
      });
      // A stop or context reset can occur between use-case completion and resumption.
      if (!current()) return;
      if (outcome.kind === "failed") this.state = outcome.state;
      else if (outcome.kind === "published") {
        this.transcripts.push(outcome.entry);
        this.transcripts = this.recent();
        this.state = "receiving";
        this.failures = 0;
      }
    } finally {
      this.busy = false;
      if (
        generation === this.generation &&
        this.requests >= this.config.maxRequests
      ) {
        if (this.state !== "storage_error") this.state = "budget_exhausted";
        this.child?.kill();
      }
    }
  }
  clearContext() {
    this.contextRevision++;
    this.controller?.abort();
    this.transcripts = [];
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
