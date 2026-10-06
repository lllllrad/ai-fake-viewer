import {
  PrivacyActionError,
  SessionProfileMismatchError,
} from "./privacy-profile.ts";
import { randomUUID } from "node:crypto";
import type { Incoming } from "./contracts.ts";
import {
  assertProfileUpdate,
  profileFingerprint,
  profileIssues,
  type PrivacyProfile,
} from "./privacy-profile.ts";
import type {
  Participant,
  ConsentStage,
} from "./domain/participation/model.ts";
export type {
  Participant,
  ConsentStage,
  ParticipationState,
} from "./domain/participation/model.ts";
import {
  receiveParticipantMessage,
  confirmObservedConsent,
} from "./domain/participation/consent.ts";
export class Participation {
  participants = new Map<string, Participant>();
  revision = 0;
  ended = false;
  private sent: number[] = [];
  startedAt = Date.now();
  fingerprint: string;
  onWithdraw?: (p: Participant) => void;
  constructor(
    public profile: PrivacyProfile,
    public sessionId: string,
  ) {
    this.fingerprint = profileFingerprint(profile);
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
        id: randomUUID(),
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
    try {
      return this.handleMessage(m);
    } finally {
      this.changed();
    }
  }
  private handleMessage(m: Incoming): {
    allow: boolean;
    withdraw: boolean;
    epoch: number;
  } {
    if (
      this.ended ||
      m.author === m.channel ||
      this.profile.notices.botUserIds.includes(m.author)
    )
      return { allow: false, withdraw: false, epoch: 0 };
    const participant = this.obtain(m);
    const transition = receiveParticipantMessage(participant, m, {
      now: Date.now(),
      startedAt: this.startedAt,
      fingerprint: this.fingerprint,
      available: this.available(m.platform, m.channel),
      observationId: randomUUID(),
    });
    Object.assign(participant, transition.participant);
    this.revision += transition.revisionDelta;
    if (transition.withdrawn) this.onWithdraw?.(structuredClone(participant));
    return transition.result;
  }
  confirmLiveCommand(id: string, observationId: string) {
    const participant = this.byId(id);
    const transition = confirmObservedConsent(participant, observationId, {
      now: Date.now(),
      startedAt: this.startedAt,
      fingerprint: this.fingerprint,
      available: this.available(participant.platform, participant.broadcaster),
      observationId,
    });
    if (!transition)
      throw new PrivacyActionError("새로운 실제 동의 명령 확인이 필요합니다.");
    Object.assign(participant, transition.participant);
    this.revision += transition.revisionDelta;
    this.changed();
    return participant;
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
      text: `14세 이상 수집·AI·국외처리·방송공개${profile.thirdPartyNotice ? "·제3자제공" : ""} !동의/철회 !철회. 미동의 제외 ${profile.noticeUrl}`,
    };
  }

  reserveNotice(id: string) {
    const p = this.byId(id),
      a = this.approval(p.platform, p.broadcaster),
      now = Date.now();
    this.sent = this.sent.filter((t) => t > now - 60000);
    if (
      !["UNCONSENTED", "WAITING_CONSENT"].includes(p.state) ||
      !this.available(p.platform, p.broadcaster) ||
      !a?.fixedNotices ||
      !(
        this.profile.notices.approvedLimitConfirmed || this.profile.testReview
      ) ||
      now - p.lastNoticeAt < this.profile.notices.perAccountIntervalMs ||
      this.sent.length >= this.profile.notices.globalPerMinute
    )
      throw new PrivacyActionError("안내 권한·단계·발송 제한을 확인해 주세요.");
    p.lastNoticeAt = now;
    this.sent.push(now);
    this.changed();
    return p;
  }
  delivered(id: string) {
    const p = this.byId(id);
    if (p.state !== "WAITING_CONSENT")
      throw new PrivacyActionError("안내 단계를 확인해 주세요.");
    this.reserveNotice(id);
    this.noticeDelivered(p.platform, p.broadcaster, Date.now(), p.id);
    return p;
  }
  blockAge(id: string) {
    const p = this.byId(id);
    p.age = "blocked";
    p.state = "WITHDRAWN";
    p.epoch++;
    this.revision++;
    p.deliveredAt = null;
    this.onWithdraw?.(structuredClone(p));
    this.changed();
    return p;
  }
  connectionLost(platform: string) {
    for (const p of this.participants.values())
      if (p.platform === platform && p.accepted.includes("manual_live_order")) {
        p.state = "WITHDRAWN";
        p.epoch++;
        p.accepted = [];
        this.revision++;
        this.onWithdraw?.(structuredClone(p));
      }
    this.changed();
  }
  invalidateAll() {
    for (const p of this.participants.values()) {
      p.state = "WITHDRAWN";
      p.epoch++;
      p.accepted = [];
      p.deliveredAt = null;
      p.observed = undefined;
      this.onWithdraw?.(structuredClone(p));
    }
    this.revision++;
    this.changed();
  }
  replaceProfile(profile: PrivacyProfile) {
    if (profileFingerprint(profile) === this.fingerprint) return;
    assertProfileUpdate(this.profile, profile);
    this.invalidateAll();
    this.profile = profile;
    this.fingerprint = profileFingerprint(profile);
    this.revision++;
    this.changed();
  }
  // Delivery covers recently observed viewers in this room, never unknown future arrivals.
  noticeDelivered(
    platform: string,
    broadcaster: string,
    at: number,
    target: string,
  ) {
    for (const p of this.participants.values()) {
      if (
        p.platform !== platform ||
        p.broadcaster !== broadcaster ||
        p.age === "blocked" ||
        p.state !== "WAITING_CONSENT" ||
        p.deliveredAt !== null
      )
        continue;
      if (
        p.id !== target &&
        (p.lastSeenAt < at - 5 * 60_000 || p.lastSeenAt > at)
      )
        continue;
      p.deliveredAt = at;
      p.introPending = false;
      p.introDelivered = true;
    }
    this.changed();
  }
  onChange?: () => void;
  changed() {
    this.onChange?.();
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
  restore(snapshot: ReturnType<Participation["snapshot"]>) {
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
    this.ended = true;
    this.revision++;
    this.participants.clear();
    this.sent = [];
    this.changed();
  }
}
