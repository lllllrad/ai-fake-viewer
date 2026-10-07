/** SOOP appends a numeric connection suffix to account IDs in chat events. */
export function platformAccountId(platform: string, id: string): string {
  return platform === "soop"
    ? id.replace(/^([a-zA-Z0-9_]+)\(\d+\)$/, "$1")
    : id;
}
