import { randomUUID, createHash } from "node:crypto";
import { ParticipationService } from "../../application/participation/service.ts";
import type { PrivacyProfile } from "../../contracts/privacy-profile.ts";
export type {
  Participant,
  ConsentStage,
  ParticipationState,
} from "../../domain/participation/model.ts";

/** Default process dependencies; application tests can inject deterministic equivalents. */
export class Participation extends ParticipationService {
  constructor(profile: PrivacyProfile, sessionId: string) {
    super(profile, sessionId, {
      now: () => Date.now(),
      id: randomUUID,
      fingerprint: (value) =>
        createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    });
  }
}
