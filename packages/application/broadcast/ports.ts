/** Broadcast-scoped storage. Credentials are deliberately absent. */
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

export type BroadcastInput = "screen" | "speech";

/** Adapter starts are idempotent. */
export interface BroadcastInputs {
  startScreen(): void;
  startSpeech(): void;
  start(): void;
  prepareForAi(): void;
  stopScreen(): void;
  stopSpeech(): void;
}

export interface BroadcastDependencies {
  repository: BroadcastRepository;
  ai: AiExecution;
  cast: CastControl;
  inputs: BroadcastInputs;
}
