import { randomUUID } from "node:crypto";
import { privacyProfileSchema } from "../packages/privacy-profile.ts";
import type { Store } from "../packages/storage.ts";
import type { Incoming } from "../packages/contracts.ts";
export const approvedProfile = () =>
  privacyProfileSchema.parse({
    operator: "Fixture operator",
    officer: "Fixture officer",
    contact: "fixture@example.test",
    policyUrl: "https://example.test/privacy",
    noticeUrl: "https://example.test/consent",
    policyVersion: "fixture-1",
    noticeVersion: "fixture-1",
    overseasBasis: "A",
    collectionNotice: "Fixture collection purpose and period",
    publicationNotice:
      "Fixture live recording VOD and edited video; original names after reveal; long-term video publication",
    overseasNotice:
      "Fixture OpenAI API transfer notice including countries, retention and refusal consequences",
    processing: {
      model: "fixture-model",
      endpoint: "https://api.openai.com/v1",
      countries: ["fixture-country"],
      subprocessors: "fixture scope",
      retention: "fixture retention",
      evidenceUrl: "https://example.test/provider",
      checkedAt: "2026-10-06",
      accountSettingsVerified: true,
      dataSharingDisabled: true,
      noticeMatchesConfiguration: true,
    },
    publications: [
      {
        platform: "youtube",
        channel: "fixture",
        url: "https://example.test/video",
        retention: "fixture video period",
        countries: "fixture countries",
        reviewed: true,
        noticeMatches: true,
      },
    ],
    approvals: ["youtube", "soop", "chzzk"].map((platform) => ({
      platform,
      broadcaster: "fixture",
      receive: true,
      fixedNotices: true,
      screenPublication: true,
      externalAi: true,
      contractReference: "fixture approved contract",
      checkedAt: "2026-10-06",
    })),
    notices: { approvedLimitConfirmed: true, globalPerMinute: 20 },
    rightsDatabase: ":memory:",
  });
export const privacyMessage = (
  author: string,
  text: string,
  at: number,
  extra: Partial<Incoming> = {},
): Incoming => ({
  platform: "youtube",
  channel: "fixture",
  author,
  name: `Synthetic ${author}`,
  text,
  sourceId: randomUUID(),
  publishedAt: at,
  ...extra,
});
export function activateFixture(
  store: Store,
  author: string,
  advance: (ms: number) => number,
  extra: Partial<Incoming> = {},
) {
  const send = () =>
    store.ingestBatch([privacyMessage(author, "!동의", advance(1), extra)]);
  send();
  const p = store.participation!.get(
    extra.platform ?? "youtube",
    extra.channel ?? "fixture",
    author,
  )!;
  for (const _ of store.participation!.stages()) {
    advance(31000);
    store.participation!.delivered(p.id);
    send();
  }
  return p;
}
