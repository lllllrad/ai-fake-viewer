import type { Participant } from "./model.ts";
export interface ConsentContext {
  now: number;
  startedAt: number;
  fingerprint: string;
  available: boolean;
  observationId: string;
}
export interface ParticipantMessage {
  text: string;
  publishedAt?: number | null;
  sourceId?: string | null;
}
export interface ParticipationTransition {
  participant: Participant;
  revisionDelta: number;
  withdrawn: boolean;
  result: { allow: boolean; withdraw: boolean; epoch: number };
}
function copy(participant: Participant): Participant {
  return {
    ...participant,
    accepted: [...participant.accepted],
    eventIds: new Set(participant.eventIds),
    requestIds: [...participant.requestIds],
    observed: participant.observed ? { ...participant.observed } : undefined,
  };
}
function accept(
  participant: Participant,
  at: number,
  fingerprint: string,
): number {
  if (participant.state !== "WAITING_CONSENT") {
    participant.epoch++;
    participant.state = "WAITING_CONSENT";
    participant.stage = 0;
    participant.accepted = [];
    participant.age = "unknown";
    participant.deliveredAt = null;
    participant.version = fingerprint;
    return 1;
  }
  if (participant.deliveredAt === null || at <= participant.deliveredAt)
    return 0;
  participant.accepted.push("combined");
  participant.age = "self_declared_14_plus";
  participant.stage = 1;
  participant.deliveredAt = null;
  participant.observed = undefined;
  participant.epoch++;
  participant.state = "ACTIVE";
  participant.activeAfter = at;
  return 1;
}

/** Caller excludes the broadcaster and bots before obtaining participant state. */
export function receiveParticipantMessage(
  current: Participant,
  message: ParticipantMessage,
  context: ConsentContext,
): ParticipationTransition {
  const participant = copy(current),
    command = message.text.trim(),
    at = message.publishedAt;
  const transition: ParticipationTransition = {
    participant,
    revisionDelta: 0,
    withdrawn: false,
    result: { allow: false, withdraw: false, epoch: participant.epoch },
  };
  const finish = () => {
    transition.result.epoch = participant.epoch;
    return transition;
  };
  if (at != null && at >= context.startedAt && at <= context.now + 5000)
    participant.lastSeenAt = Math.max(participant.lastSeenAt, at);
  if (command === "!철회") {
    if (participant.state !== "WITHDRAWN") {
      participant.epoch++;
      transition.revisionDelta = 1;
      participant.state = "WITHDRAWN";
      participant.accepted = [];
      if (participant.age !== "blocked") participant.age = "unknown";
      participant.deliveredAt = null;
      participant.observed = undefined;
      participant.lastEventAt = Math.max(
        participant.lastEventAt,
        at ?? context.now,
      );
      transition.withdrawn = true;
    }
    transition.result.withdraw = true;
    return finish();
  }
  if (command === "!참여상태") {
    participant.observed = {
      id: context.observationId,
      receivedAt: context.now,
      command,
    };
    return finish();
  }
  if (command === "!동의") {
    if (
      participant.state === "ACTIVE" ||
      !context.available ||
      participant.age === "blocked"
    )
      return finish();
    if (message.sourceId && participant.eventIds.has(message.sourceId))
      return finish();
    if (message.sourceId) participant.eventIds.add(message.sourceId);
    if (
      at != null &&
      (at <= participant.lastEventAt ||
        at < context.startedAt ||
        at > context.now + 5000)
    )
      return finish();
    if (!message.sourceId || at == null) {
      participant.observed = {
        id: context.observationId,
        receivedAt: context.now,
        command,
      };
      return finish();
    }
    participant.lastEventAt = at;
    transition.revisionDelta = accept(participant, at, context.fingerprint);
    return finish();
  }
  const fresh =
    at != null && at > participant.activeAfter && at >= context.startedAt;
  const liveWithoutTimestamp =
    at == null && participant.accepted.includes("manual_live_order");
  transition.result.allow =
    (fresh || liveWithoutTimestamp) &&
    context.available &&
    participant.state === "ACTIVE" &&
    participant.version === context.fingerprint &&
    participant.age === "self_declared_14_plus";
  if (transition.result.allow) participant.published = true;
  else if (participant.state === "UNCONSENTED" && !participant.introDelivered)
    participant.introPending = true;
  return finish();
}

/** Verifies one particular recently observed unordered command, never arbitrary activation. */
export function confirmObservedConsent(
  current: Participant,
  observationId: string,
  context: ConsentContext,
): ParticipationTransition | undefined {
  if (
    !context.available ||
    !current.observed ||
    current.observed.id !== observationId ||
    current.observed.command !== "!동의" ||
    context.now - current.observed.receivedAt > 60000 ||
    current.age === "blocked"
  )
    return;
  const participant = copy(current),
    at = participant.observed!.receivedAt;
  participant.observed = undefined;
  const revisionDelta = accept(participant, at, context.fingerprint);
  if (participant.state === "ACTIVE")
    participant.accepted.push("manual_live_order");
  return {
    participant,
    revisionDelta,
    withdrawn: false,
    result: { allow: false, withdraw: false, epoch: participant.epoch },
  };
}
