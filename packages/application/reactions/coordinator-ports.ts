import type { ConversationMessage } from "../../contracts/conversation.ts";
import type { CastRuntime } from "../../contracts/cast-runtime.ts";
import type { Transcript } from "../../contracts/transcript.ts";
import type { ChatSummary } from "../../domain/conversation/summary.ts";
import type { ContextMessage } from "../../domain/reactions/evidence.ts";
import type { ScreenFrame } from "../inputs/screen-context.ts";
import type { ReactionAttempts } from "./attempts.ts";
import type { CastDispatch } from "./dispatch.ts";
import type { ModelCallPolicy, ModelUsagePort } from "./model-call.ts";
import type { LocalPublication } from "./publication-service.ts";
import type { GenerationIssue } from "./recovery.ts";
import type { ReactionClock } from "./scheduling.ts";

export interface ReactionConfig {
  ai: ModelCallPolicy & {
    pipelineType?: string;
    visualMode: "continuous" | "on_request";
    contextWindowSeconds: number;
    transcriptLimit?: number;
    pacing: { minSeconds: number; maxSeconds: number };
    personas: Array<{ name: string; style: string }>;
    description: string;
    reviewDraft: boolean;
    manualApproval: boolean;
  };
}
export interface ReactionStore extends ModelUsagePort {
  readonly sessionId: string;
  readonly viewerMemory?: import("./viewer-memory.ts").ViewerMemoryStore;
  readonly attempts: ReactionAttempts;
  readonly dispatch: CastDispatch;
  on(event: "context_invalidated" | "reset", listener: () => void): unknown;
  closed(): boolean;
  setAiDesiredRunning(value: boolean): void;
  audit(event: string): unknown;
  cancelChatContextAttempts(): void;
  snapshot(): { messages: Array<ConversationMessage | null> };
  context(allowed: string[]): ContextMessage[];
  personaRuntime(): CastRuntime | null;
  chatSummary(): ChatSummary;
  lastSeq(): number;
  usage(): { calls: number };
  publicMessage(id: string): ConversationMessage | null;
  publishPersona(input: {
    attemptId: string;
    memberId: string;
    name: string;
    text: string;
    replyToId: string | null;
    sourceMessageIds?: string[];
  }): string | null;
  publishSynthetic(input: LocalPublication): string | null;
}
export interface ReactionScreen<Bytes extends Uint8Array> {
  recent(): ScreenFrame<Bytes>[];
  has(id: string): boolean;
}
export interface ReactionSpeech {
  recent(): Transcript[];
  has(id: string): boolean;
}
export interface ReactionRuntime<Handle> {
  now(): number;
  id(): string;
  hash(value: string): string;
  clock: ReactionClock<Handle>;
  issue(error: unknown): {
    issue: GenerationIssue;
    details: Record<string, number>;
  };
}
