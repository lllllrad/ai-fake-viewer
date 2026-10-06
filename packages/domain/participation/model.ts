export type ParticipationState =
  "UNCONSENTED" | "WAITING_CONSENT" | "ACTIVE" | "WITHDRAWN" | "ENDED";
export type ConsentStage = "combined";
export type Participant = {
  id: string;
  platform: string;
  broadcaster: string;
  author: string;
  state: ParticipationState;
  epoch: number;
  stage: number;
  age: "unknown" | "self_declared_14_plus" | "blocked";
  version: string;
  accepted: string[];
  activeAfter: number;
  lastEventAt: number;
  lastSeenAt: number;
  lastNoticeAt: number;
  deliveredAt: number | null;
  observed?: { id: string; receivedAt: number; command: string };
  eventIds: Set<string>;
  introPending: boolean;
  introDelivered: boolean;
  published: boolean;
  requestIds: string[];
};
