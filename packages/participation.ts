import { PrivacyActionError } from "./privacy-profile.ts";
import { randomUUID } from "node:crypto";
import type { Incoming } from "./contracts.ts";
import {
  assertProfileUpdate,
  profileFingerprint,
  profileIssues,
  type PrivacyProfile,
} from "./privacy-profile.ts";
export type ParticipationState =
  "UNCONSENTED" | "WAITING_CONSENT" | "ACTIVE" | "WITHDRAWN" | "ENDED";
export type ConsentStage =
  "age" | "collection" | "publication" | "overseas" | "thirdParty" | "combined";
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
  lastNoticeAt: number;
  deliveredAt: number | null;
  observed?: { id: string; receivedAt: number; command: string };
  eventIds: Set<string>;
  introPending: boolean;
  introDelivered: boolean;
  published: boolean;
  requestIds: string[];
};
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
    if (this.profile.singleStepTest) return ["combined"];
    return [
      "age",
      "collection",
      "publication",
      "overseas",
      ...(this.profile.thirdPartyNotice ? ["thirdParty" as const] : []),
    ];
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
        state: this.profile.singleStepTest ? "WAITING_CONSENT" : "UNCONSENTED",
        epoch: 0,
        stage: 0,
        age: "unknown",
        version: this.fingerprint,
        accepted: [],
        activeAfter: 0,
        lastEventAt: this.startedAt,
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
  handle(m: Incoming): { allow: boolean; withdraw: boolean; epoch: number } {
    if (this.ended || this.profile.notices.botUserIds.includes(m.author))
      return { allow: false, withdraw: false, epoch: 0 };
    const command = m.text.trim();
    const p = this.obtain(m);
    if (command === "!철회") {
      if (p.state !== "WITHDRAWN") {
        p.epoch++;
        this.revision++;
        p.state = "WITHDRAWN";
        p.accepted = [];
        if (p.age !== "blocked") p.age = "unknown";
        p.deliveredAt = null;
        p.observed = undefined;
        p.lastEventAt = Math.max(p.lastEventAt, m.publishedAt ?? Date.now());
        this.onWithdraw?.(structuredClone(p));
      }
      return { allow: false, withdraw: true, epoch: p.epoch };
    }
    if (command === "!참여상태") {
      p.observed = { id: randomUUID(), receivedAt: Date.now(), command };
      return { allow: false, withdraw: false, epoch: p.epoch };
    }
    if (command === "!동의") {
      if (p.state === "ACTIVE")
        return { allow: false, withdraw: false, epoch: p.epoch };
      if (!this.available(m.platform, m.channel) || p.age === "blocked")
        return { allow: false, withdraw: false, epoch: p.epoch };
      if (m.sourceId && p.eventIds.has(m.sourceId))
        return { allow: false, withdraw: false, epoch: p.epoch };
      if (m.sourceId) p.eventIds.add(m.sourceId);
      if (
        m.publishedAt != null &&
        (m.publishedAt <= p.lastEventAt ||
          m.publishedAt < this.startedAt ||
          m.publishedAt > Date.now() + 5000)
      )
        return { allow: false, withdraw: false, epoch: p.epoch };
      // Unknown ordering never grants consent. Operator may verify this exact observed command as live.
      const ordered =
        !!m.sourceId &&
        m.publishedAt != null &&
        m.publishedAt > p.lastEventAt &&
        m.publishedAt >= this.startedAt &&
        m.publishedAt <= Date.now() + 5000;
      if (!ordered) {
        p.observed = { id: randomUUID(), receivedAt: Date.now(), command };
        return { allow: false, withdraw: false, epoch: p.epoch };
      }
      p.lastEventAt = m.publishedAt!;
      this.acceptCommand(p, m.publishedAt!);
      return { allow: false, withdraw: false, epoch: p.epoch };
    }
    const fresh =
      m.publishedAt != null &&
      m.publishedAt > p.activeAfter &&
      m.publishedAt >= this.startedAt;
    // SDKs without source timestamps require an operator-verified live connection; see confirmLiveCommand.
    const liveWithoutTimestamp =
      m.publishedAt == null && p.accepted.includes("manual_live_order");
    const allow =
      (fresh || liveWithoutTimestamp) &&
      this.allowed(m.platform, m.channel, m.author, p.epoch);
    if (allow) p.published = true;
    else if (p.state === "UNCONSENTED" && !p.introDelivered)
      p.introPending = true;
    return { allow, withdraw: false, epoch: p.epoch };
  }
  private acceptCommand(p: Participant, at: number) {
    if (p.state !== "WAITING_CONSENT") {
      p.epoch++;
      this.revision++;
      p.state = "WAITING_CONSENT";
      p.stage = 0;
      p.accepted = [];
      p.age = "unknown";
      p.deliveredAt = null;
      p.version = this.fingerprint;
      return;
    }
    if (p.deliveredAt === null || at <= p.deliveredAt) return;
    const stage = this.stages()[p.stage];
    p.accepted.push(stage);
    if (stage === "age" || stage === "combined")
      p.age = "self_declared_14_plus";
    p.stage++;
    p.deliveredAt = null;
    p.observed = undefined;
    if (p.stage === this.stages().length) {
      p.epoch++;
      this.revision++;
      p.state = "ACTIVE";
      p.activeAfter = at;
    }
  }
  confirmLiveCommand(id: string, observationId: string) {
    const p = this.byId(id);
    if (
      !this.available(p.platform, p.broadcaster) ||
      !p.observed ||
      p.observed.id !== observationId ||
      p.observed.command !== "!동의" ||
      Date.now() - p.observed.receivedAt > 60000 ||
      p.age === "blocked"
    )
      throw new PrivacyActionError("새로운 실제 동의 명령 확인이 필요합니다.");
    const at = p.observed.receivedAt;
    p.observed = undefined;
    this.acceptCommand(p, at);
    if (p.state === "ACTIVE") p.accepted.push("manual_live_order");
    return p;
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
    if (profile.singleStepTest)
      return {
        stage,
        text: `테스트: 14세 이상·수집이용·방송공개·국외처리${profile.audioEnabled ? "·음성" : ""}${profile.videoEnabled ? "·화면" : ""}${profile.thirdPartyNotice ? "·제3자제공" : ""} 동의 !동의 / 철회 !철회 ${profile.noticeUrl}`,
      };
    const text =
      stage === "age"
        ? "이 앱은 만 14세 이상이라고 자기신고한 이용자를 대상으로 운영합니다. 본인이 만 14세 이상이면 새로운 !동의를 입력해 주세요. 이 명령은 실제 연령 검증이 아닙니다. 만 14세 미만으로 확인되면 참여를 중단하며, 법정대리인 동의 확인 절차가 마련되기 전에는 참여할 수 없습니다."
        : stage === "collection"
          ? profile.collectionNotice
          : stage === "publication"
            ? profile.publicationNotice
            : stage === "overseas"
              ? profile.overseasNotice
              : profile.thirdPartyNotice;
    return {
      stage,
      text: `[참여 안내 ${stage}] ${text} 이 단계에 동의하면 새로운 !동의를 입력해 주세요. 동의하지 않으면 이 앱에 참여하지 않습니다. 철회: !철회 / 상태 확인: !참여상태. 방침: ${profile.policyUrl} 안내(${profile.noticeVersion}): ${profile.noticeUrl}`,
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
    return p;
  }
  delivered(id: string) {
    const p = this.byId(id);
    if (p.state !== "WAITING_CONSENT")
      throw new PrivacyActionError("안내 단계를 확인해 주세요.");
    this.reserveNotice(id);
    p.deliveredAt = Date.now();
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
  }
  replaceProfile(profile: PrivacyProfile) {
    if (profileFingerprint(profile) === this.fingerprint) return;
    assertProfileUpdate(this.profile, profile);
    this.invalidateAll();
    this.profile = profile;
    this.fingerprint = profileFingerprint(profile);
    this.revision++;
  }
  end() {
    this.ended = true;
    this.revision++;
    this.participants.clear();
    this.sent = [];
  }
}
