import { materials, rules } from "./data.ts";
// Generated names use only Hangul and ASCII, where lowercase is casefold.
// The extra folds cover common compatibility forms in operator block lists.
export const nicknameKey = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[_.\s]/gu, "");

export function validNickname(
  value: string,
  blockedNames: readonly string[] = [],
): boolean {
  const name = value.normalize("NFC"),
    key = nicknameKey(name);
  return (
    Array.from(name).length >= rules.limits.min_length &&
    Array.from(name).length <= rules.limits.max_length &&
    new RegExp(`^(?:${rules.limits.allowed_pattern})$`, "u").test(name) &&
    !new RegExp(`(.)\\1{${rules.safety.max_consecutive_same_char},}`, "u").test(
      name,
    ) &&
    !new RegExp(`\\d{${rules.safety.max_consecutive_digits + 1},}`).test(
      name,
    ) &&
    !materials.reserved_exact.some(
      (reserved) => nicknameKey(reserved) === key,
    ) &&
    !materials.reserved_substrings.some((reserved) =>
      key.includes(nicknameKey(reserved)),
    ) &&
    !blockedNames.some((blocked) => nicknameKey(blocked) === key)
  );
}
