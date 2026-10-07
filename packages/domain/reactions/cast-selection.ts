import type {
  ContextMessage,
  ObservedMessage,
  SpeechEvidence,
  TimedEvidence,
} from "./evidence.ts";

export interface PresenceInterval {
  joined_after_seq: number;
  left_after_seq: number | null;
  joined_at: number;
  left_at: number | null;
}
export interface ReactionMember {
  displayName: string;
  attention: number;
  focusTags: string[];
  lastPublishedAt: number | null;
  consecutiveMessages: number;
  presence: PresenceInterval[];
  snapshot: {
    core: { interests: string[]; observation_focus: string[] };
    participation: { base_propensity: number; topic_sensitivity: number };
  };
}
export interface ReactionPolicy {
  rolling_window_ms?: number;
  global_hard_cap_messages_per_window?: number;
  minimum_global_gap_ms?: number;
  max_observation_age_ms?: number;
  model_timeout_ms?: number;
  persona_cooldown_ms?: number;
  max_consecutive_messages_from_one_persona?: number;
}
export function castPacingBlocked(input: {
  recent: ObservedMessage[];
  speechTimes: readonly number[];
  now: number;
  lastSpoke: number;
  policy: ReactionPolicy;
}) {
  const { recent, speechTimes, now, lastSpoke, policy } = input;
  const window = policy.rolling_window_ms ?? 60000;
  const cap = policy.global_hard_cap_messages_per_window ?? 6;
  return (
    recent.filter(
      (message) =>
        message.attribution === "experiment" &&
        message.displayTime >= now - window,
    ).length >= cap ||
    speechTimes.filter((at) => at > now - window).length >= cap ||
    now - lastSpoke < (policy.minimum_global_gap_ms ?? 5000)
  );
}
export interface MemberObservation<
  T extends SpeechEvidence,
  F extends TimedEvidence,
> {
  messages: ContextMessage[];
  transcripts: T[];
  frames: F[];
  newMessages: ContextMessage[];
  newTranscripts: T[];
}
