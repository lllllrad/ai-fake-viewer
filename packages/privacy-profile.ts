import { z } from "zod";
import { createHash } from "node:crypto";
export class PrivacyActionError extends Error {}
const text = z.string().trim().max(2000).default("");
export const privacyProfileSchema = z
  .object({
    // Explicit operator-reviewed testing may defer descriptive policy metadata.
    // It never substitutes for viewer consent, authentication or channel approval.
    testReview: z
      .object({
        reference: z.string().trim().min(1).max(2000),
        checkedAt: z.string().datetime(),
      })
      .strict()
      .optional(),
    audioEnabled: z.boolean().default(false),
    operator: text,
    officer: text,
    contact: text,
    policyUrl: text,
    noticeUrl: text,
    policyVersion: text,
    noticeVersion: text,
    overseasBasis: z.enum(["unconfirmed", "A", "B"]).default("unconfirmed"),
    collectionNotice: text,
    publicationNotice: text,
    overseasNotice: text,
    thirdPartyNotice: text,
    processing: z
      .object({
        provider: z
          .enum(["openai_api", "chatgpt_subscription"])
          .default("openai_api"),
        contract: z.enum(["API", "ChatGPT subscription"]).default("API"),
        model: text,
        endpoint: text,
        countries: z.array(z.string().min(1)).default([]),
        subprocessors: text,
        retention: text,
        evidenceUrl: text,
        checkedAt: text,
        accountSettingsVerified: z.boolean().default(false),
        dataSharingDisabled: z.boolean().default(false),
        noticeMatchesConfiguration: z.boolean().default(false),
      })
      .strict()
      .default(() => ({
        provider: "openai_api" as const,
        contract: "API" as const,
        model: "",
        endpoint: "",
        countries: [],
        subprocessors: "",
        retention: "",
        evidenceUrl: "",
        checkedAt: "",
        accountSettingsVerified: false,
        dataSharingDisabled: false,
        noticeMatchesConfiguration: false,
      })),
    publications: z
      .array(
        z
          .object({
            platform: z.enum(["youtube", "chzzk", "soop"]),
            channel: z.string().min(1),
            url: z.string().url(),
            retention: z.string().min(1),
            countries: z.string().min(1),
            reviewed: z.boolean(),
            noticeMatches: z.boolean(),
          })
          .strict(),
      )
      .default([]),
    approvals: z
      .array(
        z
          .object({
            platform: z.enum(["youtube", "chzzk", "soop"]),
            broadcaster: z.string().min(1),
            receive: z.boolean(),
            fixedNotices: z.boolean(),
            screenPublication: z.boolean(),
            externalAi: z.boolean(),
            contractReference: text,
            checkedAt: text,
          })
          .strict(),
      )
      .default([]),
    notices: z
      .object({
        perAccountIntervalMs: z.number().int().min(3000).default(30000),
        globalPerMinute: z.number().int().min(1).max(20).default(2),
        approvedLimitConfirmed: z.boolean().default(false),
        botUserIds: z.array(z.string()).default([]),
      })
      .strict()
      .default(() => ({
        perAccountIntervalMs: 30000,
        globalPerMinute: 2,
        approvedLimitConfirmed: false,
        botUserIds: [],
      })),
    rightsDatabase: z.string().default("data/rights.sqlite"),
  })
  .strict();
export type PrivacyProfile = z.infer<typeof privacyProfileSchema>;
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
      audioEnabled: p.audioEnabled,
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
