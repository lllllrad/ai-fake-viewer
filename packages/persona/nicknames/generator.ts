import { appropriateNickname } from "../../domain/cast/nicknames/safety.ts";
import {
  nicknameKey,
  validNickname,
} from "../../domain/cast/nicknames/validation.ts";
import { createHash } from "node:crypto";
import {
  materials,
  rules,
  seedRows,
} from "../../domain/cast/nicknames/data.ts";
import type {
  Kind,
  NicknameIdentity,
  SeedRow,
} from "../../domain/cast/nicknames/types.ts";

const leading = [
  "r",
  "R",
  "s",
  "e",
  "E",
  "f",
  "a",
  "q",
  "Q",
  "t",
  "T",
  "d",
  "w",
  "W",
  "c",
  "z",
  "x",
  "v",
  "g",
];
const medial = [
  "k",
  "o",
  "i",
  "O",
  "j",
  "p",
  "u",
  "P",
  "h",
  "hk",
  "ho",
  "hl",
  "y",
  "n",
  "nj",
  "np",
  "nl",
  "b",
  "m",
  "ml",
  "l",
];
const trailing = [
  "",
  "r",
  "R",
  "rt",
  "s",
  "sw",
  "sg",
  "e",
  "f",
  "fr",
  "fa",
  "fq",
  "ft",
  "fx",
  "fv",
  "fg",
  "a",
  "q",
  "qt",
  "t",
  "T",
  "d",
  "w",
  "c",
  "z",
  "x",
  "v",
  "g",
];

/** Physical two-set keys; Shift is significant. Unsupported jamo are rejected. */
export function hangulKeys(value: string): string {
  return Array.from(value.normalize("NFC"), (char) => {
    const index = char.codePointAt(0)! - 0xac00;
    if (index < 0 || index >= 11172) throw new Error("UNSUPPORTED_HANGUL");
    return (
      leading[Math.floor(index / 588)] +
      medial[Math.floor((index % 588) / 28)] +
      trailing[index % 28]
    );
  }).join("");
}

function randomFor(seed: string, personaId: string) {
  let counter = 0;
  return () =>
    createHash("sha256")
      .update(JSON.stringify([seed, personaId, counter++]))
      .digest()
      .readUInt32BE(0) / 0x100000000;
}
function pick<T>(items: readonly T[], random: () => number): T {
  if (!items.length) throw new Error("EMPTY_NICKNAME_POOL");
  return items[Math.floor(random() * items.length)];
}
function weighted(
  weights: Record<string, number>,
  random: () => number,
): string {
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = random() * total;
  for (const [name, weight] of entries) {
    cursor -= weight;
    if (cursor < 0) return name;
  }
  throw new Error("EMPTY_NICKNAME_WEIGHTS");
}
function numberToken(random: () => number) {
  const style = weighted(rules.number_style_weights, random);
  if (style === "small" || style === "two_digit" || style === "pattern")
    return { style, token: pick(materials.number_tokens[style], random) };
  const length = style === "random_three" ? 3 : style === "random_four" ? 4 : 5;
  return {
    style,
    token: Array.from({ length }, () => Math.floor(random() * 10)).join(""),
  };
}
const pools = new Map<Kind, SeedRow[]>();
for (const row of seedRows) {
  if ([row[1], ...row[3], ...row[4], ...row[5]].every(appropriateNickname))
    pools.set(row[2], [...(pools.get(row[2]) ?? []), row]);
}

/** One registry per cast. Persist records with persona snapshots, never just a seed. */
export class NicknameRegistry {
  private readonly records = new Map<string, NicknameIdentity>();
  private readonly names = new Set<string>();
  private readonly families = new Set<string>();
  constructor(
    private readonly seed = "nicknamegen-v1",
    saved: readonly NicknameIdentity[] = [],
  ) {
    for (const record of saved) {
      if (
        this.records.has(record.persona_id) ||
        this.names.has(nicknameKey(record.display_name)) ||
        this.families.has(record.family_key)
      )
        throw new Error("DUPLICATE_NICKNAME_REGISTRY");
      if (record.source !== "synthetic" || !validNickname(record.display_name))
        throw new Error("INVALID_NICKNAME_REGISTRY");
      this.remember(record);
    }
  }
  private remember(record: NicknameIdentity) {
    this.records.set(record.persona_id, structuredClone(record));
    this.names.add(nicknameKey(record.display_name));
    this.families.add(record.family_key);
  }
  snapshot(): NicknameIdentity[] {
    return structuredClone([...this.records.values()]);
  }
  create(
    personaId: string,
    blockedNames: readonly string[] = [],
  ): NicknameIdentity {
    if (!personaId.trim()) throw new Error("PERSONA_ID_REQUIRED");
    const existing = this.records.get(personaId);
    if (existing) {
      if (!validNickname(existing.display_name, blockedNames))
        throw new Error("NICKNAME_REVIEW_REQUIRED");
      return structuredClone(existing);
    }
    const random = randomFor(this.seed, personaId),
      number = numberToken(random);
    for (let attempt = 0; attempt < rules.limits.max_attempts; attempt++) {
      const kind = weighted(rules.kind_weights, random) as Kind;
      const row: SeedRow =
        kind === "default_combo"
          ? [
              "",
              pick(materials.modifiers, random) +
                pick(materials.default_nouns, random),
              "ko_common",
              [],
              [],
              [],
              false,
              false,
            ]
          : pick(pools.get(kind)!, random);
      const [id, base, , roman, initials, spellings, repeat, affix] = row;
      if (!appropriateNickname(base)) continue;
      const family = "root:" + nicknameKey(base);
      if (this.families.has(family)) continue;
      const origins = Object.fromEntries(
        Object.entries(rules.origin_weights[kind]).filter(
          ([mode]) =>
            mode === "literal" ||
            (mode === "roman" && roman.length) ||
            (mode === "initials" && initials.length) ||
            (mode === "keyboard" && /^[가-힣]+$/u.test(base)),
        ),
      );
      const origin = weighted(origins, random);
      let name =
        origin === "roman"
          ? pick(roman, random)
          : origin === "initials"
            ? pick(initials, random)
            : origin === "keyboard"
              ? hangulKeys(base)
              : base;
      const steps: string[] = origin === "literal" ? [] : [origin];
      let micro = "none";
      if (origin === "literal") {
        const compatible: Record<string, boolean> = {
          none: true,
          repeat:
            repeat && kind === "ko_alias" && Array.from(base).length === 2,
          approved_spelling: spellings.length > 0,
          affix: affix && (kind === "ko_alias" || kind === "name_fragment"),
          title_case: /^[a-z]+$/.test(base),
          repeat_letter: /^[a-z]+$/.test(base),
          leet: /^[a-z]+$/.test(base) && /[aeio]/.test(base),
          legacy_wrap: true,
        };
        micro = weighted(
          Object.fromEntries(
            Object.entries(rules.micro_weights).filter(
              ([op]) => compatible[op],
            ),
          ),
          random,
        );
        if (micro === "repeat") name += name;
        if (micro === "approved_spelling") name = pick(spellings, random);
        if (micro === "affix") name += pick(materials.affixes, random);
        if (micro === "title_case")
          name = name[0].toUpperCase() + name.slice(1);
        if (micro === "repeat_letter") name += name.at(-1);
        if (micro === "leet") {
          const indices = Array.from(name).flatMap((char, index) =>
            /[aeio]/.test(char) ? [index] : [],
          );
          const index = pick(indices, random),
            chars = [...name];
          chars[index] = (
            { a: "4", e: "3", i: "1", o: "0" } as Record<string, string>
          )[chars[index]];
          name = chars.join("");
        }
        if (micro === "legacy_wrap") {
          const [left, right] = pick(materials.legacy_wrappers, random);
          name = left + name + right;
        }
        if (micro !== "none") steps.push(micro);
      }
      if (
        micro !== "legacy_wrap" &&
        steps.length < rules.limits.max_transform_steps
      ) {
        const group =
          kind === "phrase" || kind === "hobby"
            ? "phrase"
            : kind === "name_fragment" || kind === "en_word"
              ? "accountish"
              : "plain";
        const suffix = weighted(rules.suffix_weights[group], random);
        if (suffix === "digits") name += number.token;
        if (suffix === "underscore_digits") name += "_" + number.token;
        if (suffix === "trailing_underscore") name += "_";
        if (suffix === "short_letter")
          name += pick(["k", "s", "n", "x"], random);
        if (suffix !== "none") steps.push(suffix);
      }
      name = name.normalize("NFC");
      if (
        !validNickname(name, blockedNames) ||
        this.names.has(nicknameKey(name))
      )
        continue;
      const record: NicknameIdentity = {
        persona_id: personaId,
        source: "synthetic",
        display_name: name,
        family_key: family,
        seed_id: id || "combo:" + base,
        base,
        base_kind: kind,
        origin_mode: origin,
        number_token: number.token,
        number_style: number.style,
        number_meaning: "unspecified_fictional_token_not_birthdate",
        steps,
        generator_version: "1.1.0",
        data_version: materials.version,
        rules_version: rules.version,
        source_id: "starter_curated_v1",
        real_account_availability_checked: false,
      };
      this.remember(record);
      return structuredClone(record);
    }
    throw new Error("NICKNAME_POOL_EXHAUSTED");
  }
}
