import type { ModelInput, ModelResult } from "./model-port.ts";
import type {
  MemberObservation,
  ReactionPolicy,
} from "../../domain/reactions/cast-selection.ts";
import type { CastRuntime } from "../../contracts/cast-runtime.ts";
import type { ObservedMessage } from "../../domain/reactions/evidence.ts";
import type { Decision } from "../../contracts/decision.ts";
import type { ScreenFrame } from "../inputs/screen-context.ts";
import type { Transcript } from "../../contracts/transcript.ts";

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
export interface DraftOptions<Bytes extends Uint8Array> {
  input: ModelInput<Bytes>;
  signal: AbortSignal;
  isCurrent(): boolean;
  inspectAllowed: boolean;
  review: boolean;
  latestFrames(): ScreenFrame<Bytes>[];
  hasTranscript(id: string): boolean;
  model(input: ModelInput<Bytes>, signal: AbortSignal): Promise<ModelResult>;
  updateState?(
    values: import("../../contracts/model-tools.ts").ViewerState,
  ): Promise<import("../../contracts/model-tools.ts").ViewerMemory>;
  active(input: ModelInput<Bytes>): void;
  phase(phase: DraftPhase): void;
  trace(event: string, details: Record<string, string | number>): void;
}
export interface SelectionInput<Bytes extends Uint8Array> {
  members: CastRuntime["members"];
  recent: ObservedMessage[];
  observation: MemberObservation<Transcript, ScreenFrame<Bytes>>;
  now: number;
  contextWindowMs: number;
  minimumPacingMs: number;
  maximumPacingMs: number;
  policy: ReactionPolicy;
  /** Randomness belongs to the caller's live or deterministic replay clock. */
  randomValues: number[];
}
export interface SelectionResult<Bytes extends Uint8Array> {
  member: CastRuntime["members"][number];
  index: number;
  observation: MemberObservation<Transcript, ScreenFrame<Bytes>>;
}
/** AI algorithms run behind this asynchronous boundary. Host owns credentials and publication. */
export interface ReactionProgram {
  readonly initialState: import("../../contracts/model-tools.ts").ViewerState;
  select<Bytes extends Uint8Array>(
    input: SelectionInput<Bytes>,
    signal: AbortSignal,
  ): Promise<SelectionResult<Bytes> | undefined>;
  draft<Bytes extends Uint8Array>(
    options: DraftOptions<Bytes>,
  ): Promise<DraftOutcome<ModelInput<Bytes>>>;
}

const programs = new Map<string, () => ReactionProgram>();
export function registerReactionProgram(
  id: string,
  create: () => ReactionProgram,
) {
  programs.set(id, create);
}
export function createReactionProgram(id: string) {
  const create = programs.get(id);
  if (!create) throw Error(`AI service pipeline is not connected: ${id}`);
  return create();
}
