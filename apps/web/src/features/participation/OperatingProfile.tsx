import type { PrivacyProfile } from "../../../../../packages/contracts/privacy-profile.ts";
import { platformName } from "./labels.ts";
export function OperatingProfile({
  profile,
  issues,
}: {
  profile: PrivacyProfile;
  issues: string[];
}) {
  return (
    <details className="participation-section">
      <summary>운영 프로필·공개 범위 확인</summary>
      {!!issues.length && (
        <p role="status">운영 프로필 확인 필요: {issues.join(" · ")}</p>
      )}
      {profile.testReview && (
        <p className="hint">
          운영자 확인에 따라 상세 문구 확인을 유예한 상태입니다. 시청자의 개별
          동의와 안내 발송 제한은 적용됩니다.
        </p>
      )}
      <dl className="participation-facts">
        <dt>운영자 / 담당자</dt>
        <dd>
          {profile.operator || "미설정"} / {profile.officer || "미설정"}
        </dd>
        <dt>문의</dt>
        <dd>{profile.contact || "미설정"}</dd>
        <dt>개인정보처리방침</dt>
        <dd>
          {profile.policyUrl || "미설정"} ·{" "}
          {profile.policyVersion || "버전 미설정"}
        </dd>
        <dt>동의 안내</dt>
        <dd>
          {profile.noticeUrl || "미설정"} ·{" "}
          {profile.noticeVersion || "버전 미설정"}
        </dd>
        <dt>AI 처리</dt>
        <dd>
          {profile.processing.provider === "chatgpt_subscription"
            ? "Sign in with ChatGPT"
            : "Responses API"}{" "}
          · {profile.processing.model || "모델 미설정"}
        </dd>
        <dt>처리 국가</dt>
        <dd>{profile.processing.countries.join(", ") || "미확정"}</dd>
        <dt>제공자 보존</dt>
        <dd>
          {profile.processing.retention || "미확정"} · 확인일{" "}
          {profile.processing.checkedAt || "미확정"}
        </dd>
        <dt>영상 공개</dt>
        <dd>
          {profile.publications
            .map(
              (p) =>
                `${platformName(p.platform)} ${p.channel} (${p.retention})`,
            )
            .join(" · ") || "미설정"}
        </dd>
      </dl>
      <p className="hint">
        동의 안내와 운영자 정보는 config.yaml의 privacy에서 관리합니다.
        영상·음성 입력 상태는 방송 화면에서 확인할 수 있습니다.
      </p>
    </details>
  );
}
