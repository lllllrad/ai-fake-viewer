import type { Participant } from "./model.ts";
export interface NoticePermission {
  participationAvailable: boolean;
  fixedNoticesApproved: boolean;
  limitsConfirmed: boolean;
  perAccountIntervalMs: number;
  globalPerMinute: number;
}
export type NoticeReservation =
  | { allowed: true; history: number[]; reservedAt: number }
  | {
      allowed: false;
      history: number[];
      reason: "stage" | "authorization" | "account_interval" | "global_limit";
    };

/** Reserving a send spends a rate slot; it never proves delivery or grants consent. */
export function reserveGuidance(
  participant: Participant,
  history: readonly number[],
  permission: NoticePermission,
  now: number,
): NoticeReservation {
  const recent = history.filter((at) => at > now - 60000);
  if (
    !["UNCONSENTED", "WAITING_CONSENT"].includes(participant.state) ||
    participant.age === "blocked" ||
    participant.deliveredAt !== null
  )
    return { allowed: false, history: recent, reason: "stage" };
  if (
    !permission.participationAvailable ||
    !permission.fixedNoticesApproved ||
    !permission.limitsConfirmed
  )
    return { allowed: false, history: recent, reason: "authorization" };
  if (now - participant.lastNoticeAt < permission.perAccountIntervalMs)
    return { allowed: false, history: recent, reason: "account_interval" };
  if (recent.length >= permission.globalPerMinute)
    return { allowed: false, history: recent, reason: "global_limit" };
  return { allowed: true, history: [...recent, now], reservedAt: now };
}
export interface GuidanceDelivery {
  platform: string;
  broadcaster: string;
  at: number;
  targetId: string;
}

/** A delivery opportunity belongs to one room and never implies individual consent. */
export function applyGuidanceDelivery(
  participant: Participant,
  delivery: GuidanceDelivery,
): Participant {
  if (
    !Number.isFinite(delivery.at) ||
    delivery.at < 0 ||
    participant.platform !== delivery.platform ||
    participant.broadcaster !== delivery.broadcaster ||
    participant.age === "blocked" ||
    participant.state !== "WAITING_CONSENT" ||
    participant.deliveredAt !== null
  )
    return participant;
  if (
    participant.id !== delivery.targetId &&
    (participant.lastSeenAt <= 0 ||
      participant.lastSeenAt < delivery.at - 5 * 60000 ||
      participant.lastSeenAt > delivery.at)
  )
    return participant;
  return {
    ...participant,
    deliveredAt: delivery.at,
    introPending: false,
    introDelivered: true,
  };
}
