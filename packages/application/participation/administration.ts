import {
  participationStatusSchema,
  type ParticipationStatus,
} from "../../contracts/participation.ts";
import type { PrivacyProfile } from "../../contracts/privacy-profile.ts";
import type { ParticipationService } from "./service.ts";
import type { RightsService } from "../rights/service.ts";
import { PrivacyActionError } from "./errors.ts";
import { profileIssues } from "./profile.ts";

type ParticipationControls = Pick<
  ParticipationService,
  | "participants"
  | "byId"
  | "notice"
  | "delivered"
  | "confirmLiveCommand"
  | "blockAge"
>;
export class ParticipationAdministration {
  constructor(
    private readonly ports: {
      participation?: ParticipationControls;
      profile(): PrivacyProfile;
      rights: Pick<RightsService, "list" | "videos">;
      followups: { flush(): void; readonly pendingCount: number };
      notices(): Pick<
        ParticipationStatus,
        "noticeBot" | "youtubeNoticeBot" | "chzzkNoticeBot"
      >;
      now(): number;
    },
  ) {}
  status(): ParticipationStatus {
    this.ports.followups.flush();
    const participation = this.ports.participation;
    const profile = this.ports.profile();
    return participationStatusSchema.parse({
      generatedAt: this.ports.now(),
      pendingFollowups: this.ports.followups.pendingCount,
      ...this.ports.notices(),
      profile,
      issues: profileIssues(profile),
      participants: participation
        ? [...participation.participants.values()].map((p) => ({
            id: p.id,
            platform: p.platform,
            broadcaster: p.broadcaster,
            account: p.author,
            state: p.state,
            age: p.age,
            stage: p.stage,
            deliveredAt: p.deliveredAt,
            epoch: p.epoch,
            observed: p.observed,
            notice:
              p.state === "WAITING_CONSENT" ? participation.notice(p.id) : null,
          }))
        : [],
      rights: this.ports.rights.list(),
      videos: this.ports.rights.videos(),
    });
  }
  private controls() {
    if (!this.ports.participation)
      throw new PrivacyActionError("Live 참여 상태가 없습니다.");
    return this.ports.participation;
  }
  confirmNotice(id: string) {
    const participation = this.controls();
    if (["soop", "youtube", "chzzk"].includes(participation.byId(id).platform))
      throw new PrivacyActionError(
        "SOOP·YouTube·치지직 안내는 자동 발송 응답으로 확인합니다.",
      );
    participation.delivered(id);
  }
  confirmCommand(id: string, observationId: string) {
    this.controls().confirmLiveCommand(id, observationId);
  }
  blockAge(id: string) {
    this.controls().blockAge(id);
  }
}
