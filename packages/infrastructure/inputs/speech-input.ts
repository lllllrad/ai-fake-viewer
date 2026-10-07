import { readAudioEvent } from "./worker-events.ts";
import { randomUUID } from "node:crypto";
import type { Config } from "../../config.ts";
import { InputWorkerSession } from "./worker-session.ts";

import {
  transcribeSpeech,
  type Transcript,
} from "../../application/inputs/transcribe-speech.ts";
import { providerSpeech, speechApiKey } from "./speech-provider.ts";
export type { Transcript } from "../../application/inputs/transcribe-speech.ts";
export { wavFromPcm } from "./speech-provider.ts";

export class Transcriber {
  allowProcessing: () => boolean = () => true;
  state = "stopped";
  private readonly worker = new InputWorkerSession(
    new URL("../../../workers/audio.mjs", import.meta.url),
  );
  get child() {
    return this.worker.child;
  }
  private active?: AbortController;
  get controller() {
    return this.active;
  }
  get busy() {
    return this.active !== undefined;
  }
  generation = 0;
  contextRevision = 0;
  failures = 0;
  requests = 0;
  onRequest?: (count: number) => void;
  transcripts: Transcript[] = [];
  constructor(
    public config: Config["audio"] & { url?: string },
    public request: typeof fetch = fetch,
    public onTranscript?: (entry: Transcript) => boolean,
  ) {}
  /** Browser PCM uses the same admission, budgets, cancellation and publication as FFmpeg input. */
  startPcm() {
    if (!this.allowProcessing()) {
      this.state = "session_closed";
      return;
    }
    if (!speechApiKey(this.config.provider)) {
      this.state = "config_required";
      return;
    }
    if (this.requests >= this.config.maxRequests) {
      this.state = "budget_exhausted";
      return;
    }
    this.state = "listening";
  }
  start() {
    if (!this.allowProcessing()) {
      this.state = "session_closed";
      return;
    }
    if (this.child) return;
    if (!this.config.url) {
      this.state = "config_required";
      return;
    }
    if (!speechApiKey(this.config.provider)) {
      this.state = "config_required";
      return;
    }
    if (this.requests >= this.config.maxRequests) {
      this.state = "budget_exhausted";
      return;
    }
    this.worker.cancelRetry();
    const generation = ++this.generation;
    this.state = "connecting";
    this.cancelRequest();
    this.worker.start(
      { type: "start", config: this.config },
      {
        message: (value) => {
          if (generation !== this.generation) return;
          const message = readAudioEvent(value, this.config.chunkSeconds);
          if (!message) return;
          if (message.type === "activity") {
            if (this.state === "connecting") this.state = "listening";
            return;
          }
          void this.transcribe(message.pcm, message.capturedAt);
        },
        error: () => {
          this.state = "failed";
        },
        exit: () => {
          this.state = "reconnecting";
          this.failures++;
          this.worker.retry(
            Math.min(30000, 1000 * 2 ** Math.min(this.failures, 5)),
            () => this.start(),
          );
        },
      },
    );
  }
  async transcribe(pcm: Buffer, capturedAt = Date.now()) {
    if (!this.allowProcessing() || this.busy || this.state === "stopped")
      return;
    if (this.requests >= this.config.maxRequests) {
      this.state = "budget_exhausted";
      this.worker.stop();
      return;
    }
    const key = speechApiKey(this.config.provider);
    if (!key) return;
    const generation = this.generation;
    const contextRevision = this.contextRevision;
    const controller = new AbortController();
    this.active = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(20000),
    ]);
    const current = () =>
      this.active === controller &&
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
          providerSpeech({
            provider: this.config.provider,
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
      if (this.active === controller) {
        this.active = undefined;
        if (
          generation === this.generation &&
          contextRevision === this.contextRevision &&
          this.requests >= this.config.maxRequests
        ) {
          if (this.state !== "storage_error") this.state = "budget_exhausted";
          this.worker.stop();
        }
      }
    }
  }
  clearContext() {
    this.contextRevision++;
    this.transcripts = [];
    this.cancelRequest();
    if (this.state !== "stopped" && this.requests >= this.config.maxRequests) {
      if (this.state !== "storage_error") this.state = "budget_exhausted";
      this.worker.stop();
    }
  }
  private cancelRequest() {
    const controller = this.active;
    this.active = undefined;
    controller?.abort();
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
    this.state = "stopped";
    this.transcripts = [];
    this.cancelRequest();
    this.worker.cancelRetry();
    this.worker.stop();
  }
}
