import type {
  ModelTool,
  ModelToolCall,
  ModelContinuationItem,
  ViewerMemory,
} from "../../contracts/model-tools.ts";
import type { ChatSummary } from "../../domain/conversation/summary.ts";
import type { ScreenFrame } from "../inputs/screen-context.ts";
import type { Transcript } from "../../contracts/transcript.ts";
import type { Decision } from "../../contracts/decision.ts";

export interface ModelInput<Bytes extends Uint8Array = Uint8Array> {
  frames: ScreenFrame<Bytes>[];
  transcripts?: Transcript[];
  newTranscripts?: Transcript[];
  messages: { id: string; speaker: string; text: string }[];
  newMessages?: { id: string; speaker: string; text: string }[];
  privacyRevision?: number;
  chatSummary?: ChatSummary;
  reviewDraft?: string;
  /** Service-owned instructions; omitted for the shared standard prompt profile. */
  instructions?: string;
  tools?: ModelTool[];
  continuation?: ModelContinuationItem[];
  contextKey?: string;
  viewerState?: ViewerMemory;
  persona: { name: string; style: string };
  description: string;
}
export interface ModelResult {
  decision?: Decision;
  toolCalls?: ModelToolCall[];
  continuation?: ModelContinuationItem[];
  cachedInputTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}
export type Model<Bytes extends Uint8Array = Uint8Array> = (
  input: ModelInput<Bytes>,
  signal: AbortSignal,
) => Promise<ModelResult>;

export interface ModelLimits {
  maxInputTokens: number;
  maxOutputTokens: number;
}
