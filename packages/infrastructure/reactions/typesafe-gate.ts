import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type {
  TimingGateInput,
  TimingGateProvider,
  TimingGateConfig,
} from "../../application/reactions/timing-gate.ts";
const promptText = (name: string) =>
  readFileSync(resolve(process.cwd(), "prompts", name), "utf8").trim();
const jevTimingPrompt = promptText("jev_timing.md");
const jevTrueCriterion = promptText("jev_criteria_true.md");
const jevFalseCriterion = promptText("jev_criteria_false.md");

const gateResponse = z.object({
  answers: z.object({
    should_respond: z.object({
      type: z.literal("noul"),
      noul: z.number().min(0).max(1),
    }),
  }),
});

export class TypeSafeTimingGate implements TimingGateProvider {
  constructor(private readonly request: typeof fetch = fetch) {}
  ensureReady() {
    if (!process.env.TYPESAFE_API_KEY)
      throw Error("TypeSafe credentials missing");
  }
  async evaluate(
    input: TimingGateInput,
    config: TimingGateConfig,
    signal: AbortSignal,
  ): Promise<number> {
    const key = process.env.TYPESAFE_API_KEY;
    // Select text fields explicitly; never serialize frames or raw audio.
    const body = JSON.stringify({
      model: config.model,
      state: {
        description: input.description,
        persona: input.persona,
        anonymousChatSummary: input.chatSummary ?? null,
        transcripts: (input.transcripts ?? []).slice(-12).map((t) => ({
          text: t.text.slice(0, 1000),
        })),
        messages: input.messages.slice(-30).map((m) => ({
          speaker: m.speaker.slice(0, 80),
          text: m.text.slice(0, 1000),
        })),
      },
      questions: {
        should_respond: {
          type: "noul",
          instructions: jevTimingPrompt,
          criteria: {
            true: jevTrueCriterion,
            false: jevFalseCriterion,
          },
        },
      },
    });
    const requestSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(config.timeoutMs),
    ]);
    const result = await this.request("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body,
      signal: requestSignal,
    });
    if (!result.ok) throw Error("TypeSafe gate request failed");
    const raw = await result.text();
    if (raw.length > 8192) throw Error("TypeSafe gate response too large");
    const probability = gateResponse.parse(JSON.parse(raw)).answers
      .should_respond.noul;
    requestSignal.throwIfAborted();
    return probability;
  }
}
