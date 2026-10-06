import {
  privacyProfileSchema,
  type PrivacyProfile,
} from "../../contracts/privacy-profile.ts";
import { PrivacyActionError } from "./errors.ts";
import { assertProfileUpdate, profileIssues } from "./profile.ts";
export class ProfileUpdate {
  constructor(
    private readonly ports: {
      current(): PrivacyProfile;
      reconfigure(apply: () => void): Promise<boolean>;
      clearSpeech(): void;
      install(profile: PrivacyProfile): void;
    },
  ) {}
  private validate(profile: PrivacyProfile) {
    const current = this.ports.current();
    if (profile.rightsDatabase !== current.rightsDatabase)
      throw new PrivacyActionError(
        "권리행사 저장소 변경은 재시작이 필요합니다.",
      );
    assertProfileUpdate(current, profile);
  }
  async update(input: unknown) {
    const profile = privacyProfileSchema.parse(input);
    this.validate(profile);
    const applied = await this.ports.reconfigure(() => {
      this.validate(profile);
      this.ports.clearSpeech();
      this.ports.install(profile);
    });
    if (!applied)
      throw new PrivacyActionError(
        "다른 방송 명령으로 설정 변경이 취소됐습니다. 현재 상태를 확인한 뒤 다시 시도해 주세요.",
      );
    return { profile, issues: profileIssues(profile) };
  }
}
