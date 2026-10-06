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
  persona: { name: string; style: string };
  description: string;
}
export interface ModelResult {
  decision: Decision;
  inputTokens?: number;
  outputTokens?: number;
}
export type Model<Bytes extends Uint8Array = Uint8Array> = (
  input: ModelInput<Bytes>,
  signal: AbortSignal,
) => Promise<ModelResult>;
