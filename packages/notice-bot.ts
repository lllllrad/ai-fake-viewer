import { randomUUID } from "node:crypto";
import type { Participation } from "./participation.ts";

// Only reviewed fixed notices cross this interface. No caller-supplied text or recipient nickname.
export class NoticeBot {
  private pending?: {
    id: string;
    participant: string;
    epoch: number;
    stage: number;
    revision: number;
    session: string;
    kind: "intro" | "stage";
    expiresAt: number;
    text: string;
  };
  private attempts: number[] = [];
  state = "waiting_connection";
  constructor(
    private participation: Participation,
    private broadcaster: string,
  ) {}
  reset() {
    this.pending = undefined;
    this.state = "waiting_connection";
  }
  next(connected: boolean) {
    const p = this.participation;
    if (!connected || p.ended) {
      this.reset();
      return null;
    }
    if (
      !p.available("soop", this.broadcaster) ||
      !p.approval("soop", this.broadcaster)?.fixedNotices ||
      !p.profile.notices.approvedLimitConfirmed
    ) {
      this.pending = undefined;
      this.state = "approval_required";
      return null;
    }
    if (this.pending) {
      if (this.pending.expiresAt > Date.now()) return null;
      this.pending = undefined;
      this.state = "delivery_unconfirmed";
    }
    this.attempts = this.attempts.filter((at) => at > Date.now() - 60000);
    if (this.attempts.length >= p.profile.notices.globalPerMinute) return null;
    for (const person of [...p.participants.values()].sort(
      (a, b) => a.lastNoticeAt - b.lastNoticeAt,
    )) {
      if (
        person.platform !== "soop" ||
        person.broadcaster !== this.broadcaster ||
        person.author === this.broadcaster ||
        p.profile.notices.botUserIds.includes(person.author) ||
        person.age === "blocked"
      )
        continue;
      const kind =
        person.state === "UNCONSENTED" && person.introPending
          ? "intro"
          : person.state === "WAITING_CONSENT" && person.deliveredAt === null
            ? "stage"
            : undefined;
      if (!kind) continue;
      try {
        p.reserveNotice(person.id);
        this.attempts.push(Date.now());
      } catch {
        continue;
      }
      const id = randomUUID();
      const text =
        kind === "intro"
          ? "[참여 안내] 동의 절차를 완료하지 않은 채팅은 이 앱의 방송 화면에 표시되거나 AI 입력으로 사용되지 않습니다. 참여 안내를 받으려면 !동의를 입력해 주세요. 철회: !철회 / 상태 확인: !참여상태."
          : p.notice(person.id).text;
      this.pending = {
        id,
        participant: person.id,
        epoch: person.epoch,
        stage: person.stage,
        revision: p.revision,
        session: p.sessionId,
        kind,
        expiresAt: Date.now() + 15000,
        text: `${text} [안내 ${id.slice(0, 8)}]`,
      };
      this.state = "awaiting_echo";
      return { id, text: this.pending.text, expiresAt: this.pending.expiresAt };
    }
    if (this.state !== "delivery_unconfirmed") this.state = "ready";
    return null;
  }
  // Only exact MESSAGE echoes from the authenticated broadcaster acknowledge sending.
  echo(author: string, text: string) {
    const job = this.pending;
    if (!job || author !== this.broadcaster || text !== job.text) return false;
    this.pending = undefined;
    const p = this.participation;
    const person = [...p.participants.values()].find(
      (x) => x.id === job.participant,
    );
    if (
      !person ||
      job.expiresAt <= Date.now() ||
      p.ended ||
      p.sessionId !== job.session ||
      p.revision !== job.revision ||
      person.epoch !== job.epoch ||
      !p.available("soop", this.broadcaster) ||
      !p.approval("soop", this.broadcaster)?.fixedNotices ||
      !p.profile.notices.approvedLimitConfirmed
    ) {
      this.state = "delivery_unconfirmed";
      return true;
    }
    if (job.kind === "intro" && person.state === "UNCONSENTED")
      person.introPending = false;
    if (
      job.kind === "stage" &&
      person.state === "WAITING_CONSENT" &&
      person.stage === job.stage
    )
      person.deliveredAt = Date.now();
    this.state = "ready";
    return true;
  }
  failed(id: string) {
    if (this.pending?.id === id) {
      this.pending = undefined;
      this.state = "delivery_unconfirmed";
    }
  }
}
