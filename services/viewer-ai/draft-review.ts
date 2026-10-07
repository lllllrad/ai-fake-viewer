import type { Decision } from "../../packages/contracts/decision.ts";
import { prepareReview } from "../../packages/domain/reactions/publication.ts";
import { validateDecision } from "../../packages/application/reactions/validate-decision.ts";
import { StaleModelContextError } from "../../packages/application/reactions/errors.ts";

interface DraftInput {
  frames: Array<{ id: string }>;
  messages: Array<{ id: string }>;
  transcripts?: Array<{ id: string; text: string; capturedAt: number }>;
  newTranscripts?: Array<{ id: string; text: string; capturedAt: number }>;
  reviewDraft?: string;
}
export type DraftPhase =
  "generating_draft" | "generating_draft_with_frame" | "ai_review";
export type DraftOutcome<I> =
  | { kind: "canceled" }
  | {
      kind: "skipped";
      reason:
        | "inspection_unavailable"
        | "repeated_inspection"
        | "model_skip"
        | "review_rejected";
      decision: Decision;
    }
  | { kind: "candidate"; input: I; decision: Decision };

/** One generation, at most one visual inspection, and optional independent review. */
export async function generateReviewedDraft<I extends DraftInput>(options: {
  input: I;
  signal: AbortSignal;
  isCurrent(): boolean;
  inspectAllowed: boolean;
  review: boolean;
  latestFrames(): I["frames"];
  hasTranscript(id: string): boolean;
  model(input: I, signal: AbortSignal): Promise<{ decision: unknown }>;
  active(input: I): void;
  phase(phase: DraftPhase): void;
  trace(event: string, details: Record<string, string | number>): void;
}): Promise<DraftOutcome<I>> {
  let input = options.input;
  const canceled = () => options.signal.aborted || !options.isCurrent();
  const invoke = async (request: I, phase: DraftPhase) => {
    options.active(request);
    options.phase(phase);
    return options.model(request, options.signal);
  };
  if (canceled()) return { kind: "canceled" };
  let result = await invoke(input, "generating_draft");
  if (canceled()) return { kind: "canceled" };
  let decision = validateDecision(result.decision, input);
  if (decision.action === "inspect") {
    const frames = options.inspectAllowed
      ? options.latestFrames().slice(-1)
      : [];
    if (!frames.length)
      return { kind: "skipped", reason: "inspection_unavailable", decision };
    input = { ...input, frames };
    result = await invoke(input, "generating_draft_with_frame");
    if (canceled()) return { kind: "canceled" };
    decision = validateDecision(result.decision, input);
  }
  if (decision.action === "inspect")
    return { kind: "skipped", reason: "repeated_inspection", decision };
  if (decision.action === "skip")
    return { kind: "skipped", reason: "model_skip", decision };
  if (options.review) {
    const active = new Set(
      (input.transcripts ?? [])
        .filter((t) => options.hasTranscript(t.id))
        .map((t) => t.id),
    );
    const reviewInput = prepareReview(input, decision, active);
    if (!reviewInput) throw new StaleModelContextError();
    options.trace("review_context", {
      removedTranscripts:
        (input.transcripts?.length ?? 0) -
        (reviewInput.transcripts?.length ?? 0),
    });
    result = await invoke(reviewInput, "ai_review");
    if (canceled()) return { kind: "canceled" };
    decision = validateDecision(result.decision, reviewInput);
    if (decision.action !== "say") {
      options.trace("review_rejected", { action: decision.action });
      return { kind: "skipped", reason: "review_rejected", decision };
    }
  }
  return { kind: "candidate", input, decision };
}
