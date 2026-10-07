import { decisionSchema } from "../../contracts/decision.ts";

export interface ModelUsagePort {
  reserve(maxUsd: number | null, reserved: number | null): string | null;
  settle(
    id: string,
    input: number | undefined,
    output: number | undefined,
    cost: number | null,
  ): void;
}
export interface ModelCallPolicy {
  provider: string;
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  priceCheckedAt?: string | null;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxUsd: number | null;
}
interface RequestEvidence {
  frames: readonly unknown[];
  newMessages?: readonly unknown[];
  newTranscripts?: readonly { capturedAt: number }[];
  reviewDraft?: unknown;
}
interface UsageResult {
  decision: unknown;
  inputTokens?: number;
  outputTokens?: number;
}
/** Reserve before sending; an ambiguous provider failure retains its reservation. */
export async function callMeteredModel<
  I extends RequestEvidence,
  R extends UsageResult,
>(options: {
  input: I;
  signal: AbortSignal;
  policy: ModelCallPolicy;
  model(input: I, signal: AbortSignal): Promise<R>;
  usage: ModelUsagePort;
  now(): number;
  trace(event: string, details: Record<string, string | number>): void;
}): Promise<R> {
  const { input, signal, policy: c, usage, now, trace } = options;
  signal.throwIfAborted();
  const started = now();
  const stage = input.reviewDraft ? "review" : "generation";
  trace("model_request", {
    stage,
    newMessages: input.newMessages?.length ?? 0,
    newTranscripts: input.newTranscripts?.length ?? 0,
    frames: input.frames.length,
    latestSpeechAt: Math.max(
      0,
      ...(input.newTranscripts ?? []).map((t) => t.capturedAt),
    ),
  });
  const priced =
    c.provider === "openai_api" &&
    c.inputUsdPerMillion !== null &&
    c.outputUsdPerMillion !== null &&
    !!c.priceCheckedAt;
  const price = (inputTokens: number, outputTokens: number) =>
    (inputTokens * c.inputUsdPerMillion! +
      outputTokens * c.outputUsdPerMillion!) /
    1e6;
  const reservation = usage.reserve(
    c.maxUsd,
    priced ? price(c.maxInputTokens, c.maxOutputTokens) : null,
  );
  if (!reservation) throw new Error("budget_exhausted");
  const result = await options.model(input, signal);
  const parsed = decisionSchema.safeParse(result.decision);
  trace("model_result", {
    stage,
    action: parsed.success ? parsed.data.action : "invalid",
    elapsedMs: now() - started,
  });
  const validTokens = (value: number | undefined) =>
    value !== undefined && Number.isSafeInteger(value) && value >= 0
      ? value
      : undefined;
  const inputTokens = validTokens(result.inputTokens),
    outputTokens = validTokens(result.outputTokens);
  const cost =
    priced && inputTokens !== undefined && outputTokens !== undefined
      ? price(inputTokens, outputTokens)
      : null;
  usage.settle(reservation, inputTokens, outputTokens, cost);
  return result;
}
