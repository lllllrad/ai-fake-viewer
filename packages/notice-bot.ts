import { randomUUID } from "node:crypto";
import { FixedNoticeDelivery } from "./application/participation/fixed-notice-delivery.ts";
import type { ParticipationService } from "./application/participation/service.ts";

// Compatibility constructor for reference callers; production composes the application owner.
export class NoticeBot extends FixedNoticeDelivery {
  constructor(
    participation: ParticipationService,
    broadcaster: string,
    platform: "soop" | "youtube" | "chzzk" = "soop",
  ) {
    super(participation, broadcaster, platform, {
      now: () => Date.now(),
      id: randomUUID,
    });
  }
}
