import {
  consentNoticeText,
  isOwnFixedNotice,
} from "../../domain/participation/notice-text.ts";
import type { PrivacyProfile } from "../../contracts/privacy-profile.ts";
import type {
  ParticipationPersistence,
  ParticipationRuntime,
} from "./ports.ts";
import type { ParticipantMessage } from "../../domain/participation/consent.ts";
interface Incoming extends ParticipantMessage {
  platform: string;
  channel: string;
  author: string;
}
import {
  reserveGuidance,
  applyGuidanceDelivery,
} from "../../domain/participation/notices.ts";
import { PrivacyActionError, SessionProfileMismatchError } from "./errors.ts";
import { assertProfileUpdate, profileIssues } from "./profile.ts";
import type {
  Participant,
  ConsentStage,
} from "../../domain/participation/model.ts";
export type {
  Participant,
  ConsentStage,
  ParticipationState,
} from "../../domain/participation/model.ts";
import {
  receiveParticipantMessage,
  confirmObservedConsent,
} from "../../domain/participation/consent.ts";
export class ParticipationService {
  participants = new Map<string, Participant>();
  revision = 0;
  ended = false;
  private sent: number[] = [];
  startedAt: number;
  fingerprint: string;
  onWithdraw?: (p: Participant) => void;
  constructor(
    public profile: PrivacyProfile,
    public sessionId: string,
    private readonly runtime: ParticipationRuntime,
  ) {
    this.startedAt = runtime.now();
    this.fingerprint = runtime.fingerprint(profile);
  }
  key(platform: string, broadcaster: string, author: string) {
    return JSON.stringify([platform, broadcaster, this.sessionId, author]);
  }
  stages(): ConsentStage[] {
    return ["combined"];
  }
  approval(platform: string, broadcaster: string) {
    return this.profile.approvals.find(
      (x) => x.platform === platform && x.broadcaster === broadcaster,
    );
  }
  available(platform: string, broadcaster: string) {
    const a = this.approval(platform, broadcaster);
    return (
      !this.ended &&
      !profileIssues(this.profile).length &&
      !!a?.receive &&
      !!a.screenPublication &&
      !!a.externalAi &&
      !!a.contractReference &&
      !!a.checkedAt
    );
  }
  get(platform: string, broadcaster: string, author: string) {
    return this.participants.get(this.key(platform, broadcaster, author));
  }
  private obtain(m: Incoming) {
    const key = this.key(m.platform, m.channel, m.author);
    let p = this.participants.get(key);
    if (!p) {
      p = {
        id: this.runtime.id(),
        platform: m.platform,
        broadcaster: m.channel,
        author: m.author,
        state: "WAITING_CONSENT",
        epoch: 0,
        stage: 0,
        age: "unknown",
        version: this.fingerprint,
        accepted: [],
        activeAfter: 0,
        lastEventAt: this.startedAt,
        lastSeenAt: 0,
        lastNoticeAt: 0,
        deliveredAt: null,
        eventIds: new Set(),
        introPending: false,
        introDelivered: false,
        published: false,
        requestIds: [],
      };
      this.participants.set(key, p);
    }
    return p;
  }
  allowed(
    platform: string,
    broadcaster: string,
    author: string,
    epoch: number,
  ) {
    const p = this.get(platform, broadcaster, author);
    return (
      this.available(platform, broadcaster) &&
      p?.state === "ACTIVE" &&
      p.epoch === epoch &&
      p.version === this.fingerprint &&
      p.age === "self_declared_14_plus"
    );
  }
  handle(m: Incoming) {
    return this.mutate(() => this.handleMessage(m));
  }
  private handleMessage(m: Incoming): {
    allow: boolean;
    withdraw: boolean;
    epoch: number;
  } {
    if (
      this.ended ||
      isOwnFixedNotice(m, this.profile) ||
      this.profile.notices.botUserIds.includes(m.author)
    )
      return { allow: false, withdraw: false, epoch: 0 };
    const participant = this.obtain(m);
    const transition = receiveParticipantMessage(participant, m, {
      now: this.runtime.now(),
      startedAt: this.startedAt,
      fingerprint: this.fingerprint,
      available: this.available(m.platform, m.channel),
      observationId: this.runtime.id(),
    });
    Object.assign(participant, transition.participant);
    this.revision += transition.revisionDelta;
    if (transition.result.withdraw)
      this.withdraw(participant, transition.withdrawn);
    return transition.result;
  }
  confirmLiveCommand(id: string, observationId: string) {
    return this.mutate(() => {
      const participant = this.byId(id);
      const transition = confirmObservedConsent(participant, observationId, {
        now: this.runtime.now(),
        startedAt: this.startedAt,
        fingerprint: this.fingerprint,
        available: this.available(
          participant.platform,
          participant.broadcaster,
        ),
        observationId,
      });
      if (!transition)
        throw new PrivacyActionError(
          "새로운 실제 동의 명령 확인이 필요합니다.",
        );
      Object.assign(participant, transition.participant);
      this.revision += transition.revisionDelta;
      return participant;
    });
  }
  byId(id: string) {
    const p = [...this.participants.values()].find((p) => p.id === id);
    if (!p) throw new PrivacyActionError("참여자를 찾을 수 없습니다.");
    return p;
  }
  notice(id: string) {
    const p = this.byId(id);
    const stage = this.stages()[p.stage];
    const profile = this.profile;
    return {
      stage,
      text: consentNoticeText(profile),
    };
  }

  reserveNotice(id: string) {
    return this.mutate(() => {
      const p = this.byId(id),
        a = this.approval(p.platform, p.broadcaster),
        now = this.runtime.now();
      const reservation = reserveGuidance(
        p,
        this.sent,
        {
          participationAvailable: this.available(p.platform, p.broadcaster),
          fixedNoticesApproved: !!a?.fixedNotices,
          limitsConfirmed:
            this.profile.notices.approvedLimitConfirmed ||
            !!this.profile.testReview,
          perAccountIntervalMs: this.profile.notices.perAccountIntervalMs,
          globalPerMinute: this.profile.notices.globalPerMinute,
        },
        now,
      );
      this.sent = reservation.history;
      if (!reservation.allowed)
        throw new PrivacyActionError(
          "안내 권한·단계·발송 제한을 확인해 주세요.",
        );
      p.lastNoticeAt = reservation.reservedAt;
      return p;
    });
  }
  delivered(id: string) {
    return this.mutate(() => {
      const p = this.byId(id);
      if (p.state !== "WAITING_CONSENT")
        throw new PrivacyActionError("안내 단계를 확인해 주세요.");
      this.reserveNotice(id);
      this.noticeDelivered(p.platform, p.broadcaster, this.runtime.now(), p.id);
      return p;
    });
  }
  blockAge(id: string) {
    return this.mutate(() => {
      const p = this.byId(id);
      p.age = "blocked";
      p.state = "WITHDRAWN";
      p.epoch++;
      this.revision++;
      p.deliveredAt = null;
      p.accepted = [];
      p.observed = undefined;
      this.withdraw(p);
      return p;
    });
  }
  connectionLost(platform: string) {
    return this.mutate(() => {
      for (const p of this.participants.values())
        if (
          p.platform === platform &&
          p.accepted.includes("manual_live_order")
        ) {
          p.state = "WITHDRAWN";
          p.epoch++;
          p.accepted = [];
          this.revision++;
          this.withdraw(p);
        }
    });
  }
  invalidateAll() {
    return this.mutate(() => {
      for (const p of this.participants.values()) {
        p.state = "WITHDRAWN";
        p.epoch++;
        p.accepted = [];
        p.deliveredAt = null;
        p.observed = undefined;
        this.withdraw(p);
      }
      this.revision++;
    });
  }
  replaceProfile(profile: PrivacyProfile) {
    return this.mutate(() => {
      if (this.runtime.fingerprint(profile) === this.fingerprint) return;
      assertProfileUpdate(this.profile, profile);
      this.invalidateAll();
      this.profile = profile;
      this.fingerprint = this.runtime.fingerprint(profile);
      this.revision++;
    });
  }
  // Delivery covers recently observed viewers in this room, never unknown future arrivals.
  noticeDelivered(
    platform: string,
    broadcaster: string,
    at: number,
    target: string,
  ) {
    return this.mutate(() => {
      const delivery = { platform, broadcaster, at, targetId: target };
      for (const participant of this.participants.values()) {
        const next = applyGuidanceDelivery(participant, delivery);
        if (next !== participant) Object.assign(participant, next);
      }
    });
  }
  recordRequest(participantId: string, requestId: string) {
    return this.mutate(() => {
      const participant = [...this.participants.values()].find(
        (p) => p.id === participantId,
      );
      if (!participant) return false;
      participant.requestIds = [
        ...new Set([...participant.requestIds, requestId]),
      ].slice(-100);
      return true;
    });
  }
  private persistence?: ParticipationPersistence;
  bindPersistence(persistence: ParticipationPersistence | undefined) {
    this.persistence = persistence;
  }
  private mutate<T>(work: () => T): T {
    const change = () => {
      const result = work();
      this.changed();
      return result;
    };
    return this.persistence ? this.persistence.run(change) : change();
  }
  private withdraw(participant: Participant, notify = true) {
    const copy = structuredClone(participant);
    if (notify) {
      const effect = () => this.onWithdraw?.(copy);
      if (this.persistence) this.persistence.afterCommit(effect);
      else effect();
    }
    this.persistence?.eraseContext(copy, notify);
  }
  private changed() {
    this.persistence?.save();
  }
  /** Transaction rollback restores live references, including unconfirmed observations. */
  checkpoint() {
    const participants = [...this.participants.entries()].map(
      ([key, participant]) => ({
        key,
        participant,
        value: structuredClone(participant),
      }),
    );
    const state = {
      profile: this.profile,
      sessionId: this.sessionId,
      fingerprint: this.fingerprint,
      startedAt: this.startedAt,
      revision: this.revision,
      ended: this.ended,
      sent: [...this.sent],
    };
    return () => {
      Object.assign(this, state);
      this.participants = new Map(
        participants.map(({ key, participant, value }) => {
          Object.assign(participant, value);
          return [key, participant];
        }),
      );
    };
  }
  snapshot() {
    return {
      fingerprint: this.fingerprint,
      startedAt: this.startedAt,
      revision: this.revision,
      ended: this.ended,
      sent: this.sent,
      participants: [...this.participants.values()].map((p) => ({
        ...p,
        eventIds: [...p.eventIds],
      })),
    };
  }
  restore(snapshot: ReturnType<ParticipationService["snapshot"]>) {
    if (!snapshot.ended && snapshot.fingerprint !== this.fingerprint)
      throw new SessionProfileMismatchError();
    this.startedAt = snapshot.startedAt;
    this.revision = snapshot.revision;
    this.ended = snapshot.ended;
    this.sent = snapshot.sent;
    this.participants = new Map(
      snapshot.participants.map((p) => [
        this.key(p.platform, p.broadcaster, p.author),
        { ...p, observed: undefined, eventIds: new Set(p.eventIds) },
      ]),
    );
  }
  end() {
    return this.mutate(() => {
      this.ended = true;
      this.revision++;
      this.participants.clear();
      this.sent = [];
    });
  }
}
