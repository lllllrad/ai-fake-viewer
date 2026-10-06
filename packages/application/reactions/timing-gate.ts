import type { ChatSummary } from "../../domain/conversation/summary.ts";
export interface TimingGateInput {
  description: string;
  persona: { name: string; style: string };
  chatSummary?: ChatSummary;
  transcripts?: Array<{ text: string }>;
  messages: Array<{ speaker: string; text: string }>;
}
export interface TimingGateConfig {
  model: string;
  timeoutMs: number;
  maxRequests: number;
  threshold: number;
}
export interface TimingGateProvider {
  ensureReady(): void;
  evaluate(
    input: TimingGateInput,
    config: TimingGateConfig,
    signal: AbortSignal,
  ): Promise<number>;
}
/** Owns the separate timing budget and only publishes the newest evaluation's state. */
export class TimingGate {
  state = "idle";
  requests = 0;
  filtered = 0;
  errors = 0;
  probability: number | null = null;
  private revision = 0;
  constructor(
    public config: TimingGateConfig,
    private readonly provider: TimingGateProvider,
  ) {}
  async allow(input: TimingGateInput, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const revision = ++this.revision;
    const config = { ...this.config };
    this.probability = null;
    if (this.requests >= config.maxRequests) {
      this.state = "budget_exhausted";
      return false;
    }
    this.provider.ensureReady();
    this.requests++;
    this.state = "evaluating";
    try {
      const probability = await this.provider.evaluate(input, config, signal);
      if (revision !== this.revision) return false;
      signal.throwIfAborted();
      if (!Number.isFinite(probability) || probability < 0 || probability > 1)
        throw Error("Invalid timing probability");
      this.probability = probability;
      const suppress = probability >= config.threshold;
      this.state = suppress ? "suppressed_bad_timing" : "passed";
      if (suppress) this.filtered++;
      return !suppress;
    } catch {
      if (revision !== this.revision) return false;
      if (signal.aborted) {
        this.state = "cancelled";
        return false;
      }
      this.errors++;
      this.state = "provider_error";
      return false;
    }
  }
}
