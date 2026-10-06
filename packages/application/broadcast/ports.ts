/** Broadcast-scoped storage. Credentials and rights records are deliberately absent. */
export interface BroadcastRepository {
  closed(): boolean;
  aiRequested(): boolean;
  end(): void;
  createNext(): void;
  erase(): void;
  disclose(): void;
}

export interface AiExecution {
  running(): boolean;
  /** Validate current readiness before mutating execution or enabled intent. */
  start(): void;
  stop(reason: string, preserveIntent: boolean): void;
  waitForRecovery(): void;
}

export interface CastControl {
  disarm(reason: string): void;
  cancelJobs(): void;
}

export type BroadcastInput = "screen" | "speech" | "chat";

/** Adapter starts are idempotent; stopping chat resolves after callbacks have drained. */
export interface BroadcastInputs {
  startScreen(): void;
  startSpeech(): void;
  startChat(): void;
  start(): void;
  prepareForAi(): void;
  stopScreen(): void;
  stopSpeech(): void;
  stopChat(): Promise<void>;
}

export interface BroadcastDependencies {
  repository: BroadcastRepository;
  ai: AiExecution;
  cast: CastControl;
  inputs: BroadcastInputs;
}
