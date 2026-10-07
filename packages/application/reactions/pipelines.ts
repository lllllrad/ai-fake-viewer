import { initialViewerStateSchema } from "../../contracts/model-tools.ts";
import type { ViewerInspection } from "../../contracts/reaction-inspection.ts";
import type { ModelInput } from "./model-port.ts";
import type { Decision } from "../../contracts/decision.ts";
import type { GenerationIssueStatus } from "./recovery.ts";
import type { ReactionProgram } from "./program.ts";
/** Explicit host lifecycle contract, independent of any AI algorithm class. */
export interface ReactionEngine<
  Bytes extends Uint8Array = Uint8Array,
  Handle = unknown,
> {
  store: import("./coordinator-ports.ts").ReactionStore;
  capture: import("./coordinator-ports.ts").ReactionScreen<Bytes>;
  config: import("./coordinator-ports.ts").ReactionConfig;
  transcriber: import("./coordinator-ports.ts").ReactionSpeech | undefined;
  model: import("./model-port.ts").Model<Bytes>;
  providerReady(): boolean;
  random(): number;
  readyCheck?: () => string[];
  preparePersonas?: () => void;
  state: string;
  phase: string;
  readonly busy: boolean;
  readonly lastIssue: GenerationIssueStatus | undefined;
  reviews: number;
  skips: number;
  rejects: number;
  lastInput: {
    newTranscripts: number;
    contextTranscripts: number;
    newMessages: number;
    contextMessages: number;
    frames: number;
  };
  diagnostics: Array<{
    at: number;
    event: string;
    phase: string;
    details: Record<string, string | number>;
  }>;
  onDiagnostic?: (
    entry: ReactionEngine<Bytes, Handle>["diagnostics"][number],
  ) => void;
  pending?: {
    decision: Decision;
    input: ModelInput<Bytes>;
    persona: number;
    expires: number;
    sessionId: string;
    generation: number;
    personaSessionId?: string;
    memberId?: string;
    sessionEpoch?: number;
    memberEpoch?: number;
    definitionHash?: string;
    attemptId?: string;
    notBefore?: number;
  };
  synchronizeViewerStates(): void;
  start(): void;
  stop(reason?: string, preserveDesired?: boolean): void;
  tick(now?: number): Promise<void>;
  approve(): void;
  reject(): void;
  invalidateChatContext(): void;
}
export type PipelineArguments<Bytes extends Uint8Array, Handle> = [
  store: import("./coordinator-ports.ts").ReactionStore,
  capture: import("./coordinator-ports.ts").ReactionScreen<Bytes>,
  config: import("./coordinator-ports.ts").ReactionConfig,
  model: import("./model-port.ts").Model<Bytes>,
  demo: boolean,
  providerReady: () => boolean,
  transcriber: import("./coordinator-ports.ts").ReactionSpeech | undefined,
  random: () => number,
  runtime: import("./coordinator-ports.ts").ReactionRuntime<Handle>,
];
export interface ReactionPipeline {
  readonly initialState: import("../../contracts/model-tools.ts").ViewerState;
  id: string;
  revision: number;
  label: string;
  description: string;
  create<Bytes extends Uint8Array, Handle>(
    ...args: PipelineArguments<Bytes, Handle>
  ): ReactionEngine<Bytes, Handle>;
  /** Optional, synchronous, read-only inspection. Must not make model calls. */
  inspect?<Bytes extends Uint8Array, Handle>(
    engine: ReactionEngine<Bytes, Handle>,
  ): ViewerInspection[];
  refreshInspection?<Bytes extends Uint8Array, Handle>(
    engine: ReactionEngine<Bytes, Handle>,
  ): Promise<void>;
  /** Isolated draft experiments must use the same implementation's draft path. */
  draft: ReactionProgram["draft"];
}
export class ReactionPipelineRegistry {
  private readonly entries = new Map<string, ReactionPipeline>();
  constructor(pipelines: readonly ReactionPipeline[] = []) {
    for (const pipeline of pipelines) this.register(pipeline);
  }
  register(pipeline: ReactionPipeline) {
    initialViewerStateSchema.parse(pipeline.initialState);
    if (
      !/^[a-z][a-z0-9_-]{0,63}$/.test(pipeline.id) ||
      !Number.isSafeInteger(pipeline.revision) ||
      pipeline.revision < 1 ||
      !pipeline.label.trim() ||
      this.entries.has(pipeline.id)
    )
      throw Error("Invalid or duplicate AI pipeline type");
    this.entries.set(pipeline.id, Object.freeze({ ...pipeline }));
  }
  get(id: string): ReactionPipeline {
    const pipeline = this.entries.get(id);
    if (!pipeline) throw Error(`Unknown AI pipeline type: ${id}`);
    return pipeline;
  }
  list() {
    return [...this.entries.values()].map(
      ({ id, revision, label, description }) => ({
        id,
        revision,
        label,
        description,
      }),
    );
  }
  create<Bytes extends Uint8Array, Handle>(
    id: string,
    ...args: PipelineArguments<Bytes, Handle>
  ) {
    return this.get(id).create(...args);
  }
}
export const reactionPipelines = new ReactionPipelineRegistry();
