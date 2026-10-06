export interface BeginReactionAttempt {
  id: string;
  sessionId: string;
  memberId: string;
  eventIds: string[];
  cutoff: number;
  contextKey?: string;
  sessionEpoch: number;
  memberEpoch: number;
  definitionHash: string;
  configRevision: number;
}
export type AttemptOutcome =
  | "skipped"
  | "suppressed"
  | "expired"
  | "canceled"
  | "failed"
  | "candidate"
  | "published";
/** Durable context reservation and monotonic completion for the current cast. */
export interface ReactionAttempts {
  begin(input: BeginReactionAttempt): boolean;
  finish(
    id: string,
    state: AttemptOutcome,
    reason: string | null,
    result?: unknown,
    manifest?: unknown,
  ): boolean;
}
