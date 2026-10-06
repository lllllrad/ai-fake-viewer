import { z } from "zod";
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
