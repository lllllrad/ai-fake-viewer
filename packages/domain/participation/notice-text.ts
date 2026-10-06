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
