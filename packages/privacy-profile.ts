import type { PrivacyProfile } from "./contracts/privacy-profile.ts";
export {
  privacyProfileSchema,
  type PrivacyProfile,
} from "./contracts/privacy-profile.ts";
import { createHash } from "node:crypto";
export class PrivacyActionError extends Error {}
export class SessionProfileMismatchError extends Error {
  constructor() {
    super(
      "Saved broadcast consent does not match config.yaml privacy settings. Restore the previous profile, end that broadcast, then apply the new profile.",
    );
  }
}
export function profileFingerprint(p: PrivacyProfile) {
  return createHash("sha256").update(JSON.stringify(p)).digest("hex");
}
export function profileIssues(p: PrivacyProfile): string[] {
  const issues: string[] = [];
  for (const key of [
    "operator",
    "officer",
    "contact",
    "policyVersion",
    "noticeVersion",
    "collectionNotice",
    "publicationNotice",
    "overseasNotice",
  ] as const)
    if (!p[key]) issues.push(`${key} 미설정`);
  for (const key of ["policyUrl", "noticeUrl"] as const)
    if (!/^https:\/\//.test(p[key])) issues.push(`${key} 공개 HTTPS 주소 필요`);
  if (!p.testReview && p.overseasBasis === "unconfirmed")
    issues.push("국외 처리 A/B 미확정");
  const a = p.processing;
  for (const key of ["model", "endpoint"] as const)
    if (!a[key]) issues.push(`AI ${key} 미설정`);
  if (!p.testReview)
    for (const key of [
      "subprocessors",
      "retention",
      "evidenceUrl",
      "checkedAt",
    ] as const)
      if (!a[key]) issues.push(`AI ${key} 미설정`);
  if (
    !p.testReview &&
    (!a.countries.length ||
      !a.accountSettingsVerified ||
      !a.dataSharingDisabled ||
      !a.noticeMatchesConfiguration)
  )
    issues.push("AI 국가·계약·보존·안내 일치 확인 필요");
  if (
    (a.provider === "openai_api" && a.contract !== "API") ||
    (a.provider === "chatgpt_subscription" &&
      a.contract !== "ChatGPT subscription")
  )
    issues.push("AI 제공자와 계약 서비스 불일치");
  if (
    a.endpoint &&
    (a.provider === "chatgpt_subscription"
      ? a.endpoint !== "https://api.openai.com/v1"
      : !/^https:\/\/(?:api|[a-z]{2}\.api)\.openai\.com\/v1$/.test(a.endpoint))
  )
    issues.push("선택한 OpenAI 서비스의 확인된 endpoint 필요");
  if (
    !p.testReview &&
    (!p.publications.length ||
      p.publications.some((x) => !x.reviewed || !x.noticeMatches))
  )
    issues.push("영상 공개 플랫폼·채널·보관·국외 처리 확인 필요");
  return issues;
}

// Processing changes need a new viewer-facing notice version, not merely a changed link.
export function assertProfileUpdate(
  previous: PrivacyProfile,
  next: PrivacyProfile,
) {
  const scope = (p: PrivacyProfile) =>
    JSON.stringify({
      testReview: p.testReview,
      operator: p.operator,
      collection: p.collectionNotice,
      publication: p.publicationNotice,
      overseas: p.overseasNotice,
      thirdParty: p.thirdPartyNotice,
      overseasBasis: p.overseasBasis,
      processing: {
        provider: p.processing.provider,
        contract: p.processing.contract,
        model: p.processing.model,
        endpoint: p.processing.endpoint,
        countries: p.processing.countries,
        subprocessors: p.processing.subprocessors,
        retention: p.processing.retention,
      },
      publications: p.publications.map(
        ({ platform, channel, url, retention, countries }) => ({
          platform,
          channel,
          url,
          retention,
          countries,
        }),
      ),
    });
  if (
    previous.noticeVersion &&
    scope(previous) !== scope(next) &&
    (!next.noticeVersion || next.noticeVersion === previous.noticeVersion)
  )
    throw new PrivacyActionError(
      "처리 조건 변경 시 안내 내용을 수정하고 새로운 noticeVersion을 지정해 주세요.",
    );
}
