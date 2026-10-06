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
  upstream_activity_bands?: Array<{
    min_messages: number;
    max_messages: number | null;
    ai_cap_messages_per_window: number;
  }>;
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
  const count = (synthetic: boolean) =>
    recent.filter(
      (message) =>
        (message.attribution === "experiment") === synthetic &&
        message.displayTime >= now - window,
    ).length;
  const upstream = count(false);
  const band = (policy.upstream_activity_bands ?? []).find(
    (band) =>
      upstream >= band.min_messages &&
      (band.max_messages === null || upstream <= band.max_messages),
  );
  const cap = Math.min(
    policy.global_hard_cap_messages_per_window ?? 6,
    band?.ai_cap_messages_per_window ?? 6,
  );
  return (
    count(true) >= cap ||
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
export function chooseCastMember<
  M extends ReactionMember,
  T extends SpeechEvidence,
  F extends TimedEvidence,
>(input: {
  members: M[];
  recent: ObservedMessage[];
  observation: MemberObservation<T, F>;
  now: number;
  contextWindowMs: number;
  minimumPacingMs: number;
  maximumPacingMs: number;
  policy: ReactionPolicy;
  random(): number;
}) {
  const { observation, now, policy } = input;
  const messageById = new Map(
    input.recent.map((message) => [message.id, message]),
  );
  const observationAge = Math.min(
    input.contextWindowMs,
    Math.max(
      policy.max_observation_age_ms ?? 12000,
      input.maximumPacingMs + (policy.model_timeout_ms ?? 30000),
    ),
  );
  const eligible = input.members.flatMap((member, index) => {
    if (
      !member.presence.length ||
      member.snapshot.participation.base_propensity <= 0
    )
      return [];
    const during = (at: number) =>
      member.presence.some(
        (p) => at >= p.joined_at && (p.left_at === null || at <= p.left_at),
      );
    const messages = observation.messages.filter((message) => {
      const event = messageById.get(message.id);
      return (
        !!event &&
        member.presence.some(
          (p) =>
            event.seq > p.joined_after_seq &&
            (p.left_after_seq === null || event.seq <= p.left_after_seq) &&
            event.displayTime >= p.joined_at &&
            (p.left_at === null || event.displayTime <= p.left_at),
        )
      );
    });
    const transcripts = observation.transcripts.filter((t) =>
      during(t.capturedAt),
    );
    const frames = observation.frames.filter((frame) =>
      during(frame.capturedAt),
    );
    const ids = new Set(messages.map((message) => message.id));
    const transcriptIds = new Set(transcripts.map((t) => t.id));
    const newMessages = observation.newMessages.filter((message) => {
      const event = messageById.get(message.id);
      return (
        !!event &&
        event.displayTime >= now - observationAge &&
        ids.has(message.id)
      );
    });
    const newTranscripts = observation.newTranscripts.filter(
      (t) => t.capturedAt >= now - observationAge && transcriptIds.has(t.id),
    );
    if (
      !newMessages.length &&
      !newTranscripts.length &&
      !frames.some((frame) => frame.capturedAt >= now - observationAge)
    )
      return [];
    if (
      member.lastPublishedAt !== null &&
      now - member.lastPublishedAt <
        Math.max(input.minimumPacingMs, policy.persona_cooldown_ms ?? 0)
    )
      return [];
    if (
      member.consecutiveMessages >=
      (policy.max_consecutive_messages_from_one_persona ?? 2)
    )
      return [];
    const latest = [
      ...messages.map((message) => message.text),
      ...transcripts.map((t) => t.text),
    ]
      .slice(-5)
      .join(" ")
      .toLocaleLowerCase();
    const definition = member.snapshot;
    const tags = [
      ...definition.core.interests,
      ...definition.core.observation_focus,
      ...member.focusTags,
    ];
    const tagHits = tags.filter(
      (tag) => tag.length > 2 && latest.includes(tag.toLocaleLowerCase()),
    ).length;
    const mention = messages.some((message) =>
      message.text
        .normalize("NFKC")
        .toLocaleLowerCase()
        .includes(member.displayName.normalize("NFKC").toLocaleLowerCase()),
    );
    const topical =
      0.7 +
      Math.min(1, tagHits * 0.2) * definition.participation.topic_sensitivity;
    const recency =
      member.lastPublishedAt !== null && now - member.lastPublishedAt < 120000
        ? 0.55
        : 1;
    const score =
      Math.max(0.01, definition.participation.base_propensity) *
      topical *
      (0.5 + Math.min(1, member.attention)) *
      (mention ? 1.5 : 1) *
      recency *
      (0.8 + input.random() * 0.4);
    return [
      {
        member,
        index,
        score,
        observation: {
          messages,
          transcripts,
          frames,
          newMessages,
          newTranscripts,
        },
      },
    ];
  });
  const chance = Math.max(
    0,
    ...eligible.map(
      (candidate) => candidate.member.snapshot.participation.base_propensity,
    ),
  );
  if (!eligible.length || chance <= 0 || input.random() >= chance)
    return undefined;
  let choice =
    input.random() *
    eligible.reduce((sum, candidate) => sum + candidate.score, 0);
  return (
    eligible.find((candidate) => (choice -= candidate.score) <= 0) ??
    eligible.at(-1)
  );
}
