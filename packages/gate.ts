import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { Config } from "./config.ts";
import type { ModelInput } from "./model.ts";

const promptText = (name: string) =>
  readFileSync(resolve(process.cwd(), "prompts", name), "utf8").trim();
const jevTimingPrompt = promptText("jev_timing.md");
const jevTrueCriterion = promptText("jev_criteria_true.md");
const jevFalseCriterion = promptText("jev_criteria_false.md");

const gateResponse = z.object({
  answers: z.object({
    bad_timing: z.object({
      type: z.literal("noul"),
      noul: z.number().min(0).max(1),
    }),
  }),
});

export class DecisionGate {
  state = "idle";
  requests = 0;
  filtered = 0;
  errors = 0;
  probability: number | null = null;
  constructor(
    public config: Config["ai"]["gate"],
    public request: typeof fetch = fetch,
  ) {}

  async allow(input: ModelInput, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    this.probability = null;
    if (this.requests >= this.config.maxRequests) {
      this.state = "budget_exhausted";
      return false;
    }
    const key = process.env.TYPESAFE_API_KEY;
    if (!key) throw Error("TypeSafe credentials missing");
    // Select text fields explicitly; never serialize frames or raw audio.
    const body = JSON.stringify({
      model: this.config.model,
      state: {
        description: input.description,
        persona: input.persona,
        new_transcripts: (input.newTranscripts ?? []).slice(-12).map((t) => ({
          text: t.text.slice(0, 1000),
        })),
        new_messages: (input.newMessages ?? []).slice(-12).map((m) => ({
          speaker: m.speaker.slice(0, 80),
          text: m.text.slice(0, 1000),
        })),
        recent_context: {
          transcripts: (input.transcripts ?? []).slice(-12).map((t) => ({
            text: t.text.slice(0, 1000),
          })),
          messages: input.messages.slice(-30).map((m) => ({
            speaker: m.speaker.slice(0, 80),
            text: m.text.slice(0, 1000),
          })),
        },
      },
      questions: {
        bad_timing: {
          type: "noul",
          instructions: jevTimingPrompt,
          criteria: {
            true: jevTrueCriterion,
            false: jevFalseCriterion,
          },
        },
      },
    });
    this.requests++;
    this.state = "evaluating";
    const requestSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.config.timeoutMs),
    ]);
    try {
      const result = await this.request(
        "https://api.typesafe.ai/v1/systemone",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body,
          signal: requestSignal,
        },
      );
      if (!result.ok) throw Error("TypeSafe gate request failed");
      const raw = await result.text();
      if (raw.length > 8192) throw Error("TypeSafe gate response too large");
      const probability = gateResponse.parse(JSON.parse(raw)).answers.bad_timing
        .noul;
      requestSignal.throwIfAborted();
      this.probability = probability;
      const suppress = probability >= this.config.threshold;
      this.state = suppress ? "suppressed_bad_timing" : "passed";
      if (suppress) this.filtered++;
      return !suppress;
    } catch {
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
