/** Format one complete notice; splitting or truncation would hide required content. */
export function fixedNoticeText(text: string, bodyBudget = 170): string {
  const body = text.trim().replace(/\s+/gu, " ");
  if (
    !Number.isSafeInteger(bodyBudget) ||
    bodyBudget <= 0 ||
    !body ||
    body.length > bodyBudget
  )
    throw Error("notice_too_long");
  return `[안내] ${body}`;
}

/** Content shared by delivery and own-echo suppression. */
export function consentNoticeText(profile: {
  thirdPartyNotice: string;
  noticeUrl: string;
}) {
  return `14세 이상 수집·AI·국외처리·방송공개${profile.thirdPartyNotice ? "·제3자제공" : ""} !동의/철회 !철회. 미동의 제외 ${profile.noticeUrl}`;
}
export function isOwnFixedNotice(
  message: { author: string; channel: string; platform: string; text: string },
  profile: Parameters<typeof consentNoticeText>[0],
) {
  if (message.author !== message.channel) return false;
  const text = consentNoticeText(profile);
  if (message.platform === "soop")
    return (
      message.text === text ||
      (message.text.startsWith(text) &&
        /^ \[안내 [a-f0-9]{8}\]$/.test(message.text.slice(text.length)))
    );
  try {
    return (
      message.text ===
      fixedNoticeText(text, message.platform === "chzzk" ? 88 : 170)
    );
  } catch {
    return false;
  }
}
