import { appropriateNickname } from "../packages/domain/cast/nicknames/safety.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NicknameRegistry,
  hangulKeys,
} from "../packages/persona/nicknames/generator.ts";
import {
  nicknameKey,
  validNickname,
} from "../packages/domain/cast/nicknames/validation.ts";
import { seedRows, materials } from "../packages/domain/cast/nicknames/data.ts";
import { automaticDefinitions } from "../packages/persona/automatic.ts";

test("two-set keyboard conversion preserves compound finals, vowels, NFC and Shift", () => {
  for (const [input, expected] of Object.entries({
    보리: "qhfl",
    민수: "alstn",
    한별: "gksquf",
    값: "rkqt",
    읽: "dlfr",
    까: "Rk",
    예: "dP",
    꽤: "Rho",
    뺨: "Qia",
    왜: "dho",
    의: "dml",
  })) {
    assert.equal(hangulKeys(input), expected);
    assert.equal(hangulKeys(input.normalize("NFD")), expected);
  }
  for (let code = 0xac00; code <= 0xd7a3; code++)
    assert.match(hangulKeys(String.fromCodePoint(code)), /^[A-Za-z]{2,5}$/);
  for (const input of ["ㄱ", "abc", "보 리", "ᄔ"])
    assert.throws(() => hangulKeys(input), /UNSUPPORTED_HANGUL/);
});
test("display validation rejects controls, impersonation, oversized and decorated names", () => {
  for (const name of [
    "보리",
    "qhfl27",
    "Bori_27",
    "xX르딘Xx",
    "까".normalize("NFD"),
  ])
    assert(validNickname(name), name);
  for (const name of [
    "",
    "a".repeat(21),
    "aaaaa",
    "보리123456",
    "보 리",
    "보리\u200b",
    "보리\u202e",
    "🙂",
    "관리자",
    "ＡＤＭＩＮ",
    "xx고객센터xx",
    "a-b",
  ])
    assert(!validNickname(name), name);
  assert.equal(nicknameKey("Ｂori_27."), nicknameKey("bori27"));
  assert.equal(nicknameKey("BORI 27"), nicknameKey("bori27"));
  assert(!validNickname("bori27", ["Ｂori_27."]));
});
test("starter vocabulary consists of unique synthetic seeds with bounded approved variants", () => {
  assert.equal(seedRows.length, 823);
  assert.equal(new Set(seedRows.map((row) => row[0])).size, 823);
  for (const [, base, , roman, initials, spellings] of seedRows) {
    assert(validNickname(base), base);
    for (const name of [...roman, ...initials, ...spellings])
      assert(validNickname(name), name);
  }
});
test("one thousand identities have unique roots and conservative names within a two-operation budget", () => {
  const registry = new NicknameRegistry("large-fixture");
  const records = Array.from({ length: 1000 }, (_, index) =>
    registry.create(`fixture:${index}`),
  );
  assert.equal(
    new Set(records.map((r) => nicknameKey(r.display_name))).size,
    1000,
  );
  assert.equal(new Set(records.map((r) => r.family_key)).size, 1000);
  const seen = new Set(records.map((r) => r.base_kind));
  assert.equal(seen.size, 7);
  const operations = new Set<string>();
  for (const record of records) {
    assert(validNickname(record.display_name));
    assert(record.steps.length <= 2);
    record.steps.forEach((step) => operations.add(step));
    assert.equal(record.source, "synthetic");
    assert.equal(record.real_account_availability_checked, false);
    assert.equal(record.data_version, materials.version);
    assert.equal(
      record.number_meaning,
      "unspecified_fictional_token_not_birthdate",
    );
    if (record.origin_mode !== "literal")
      assert(
        record.steps.every((step) =>
          [
            record.origin_mode,
            "digits",
            "underscore_digits",
            "trailing_underscore",
            "short_letter",
          ].includes(step),
        ),
      );
    if (record.steps.includes("legacy_wrap"))
      assert.deepEqual(record.steps, ["legacy_wrap"]);
    if (record.steps.some((s) => s === "digits" || s === "underscore_digits"))
      assert(record.display_name.endsWith(record.number_token));
  }
  for (const operation of [
    "roman",
    "keyboard",
    "initials",
    "repeat",
    "approved_spelling",
    "affix",
    "title_case",
    "repeat_letter",
    "leet",
    "legacy_wrap",
  ])
    assert(operations.has(operation), operation);
});
test("stored identities win over changed seed and returned records cannot mutate the registry", () => {
  const registry = new NicknameRegistry("first");
  const first = registry.create("persona-1");
  const saved = registry.snapshot();
  const restored = new NicknameRegistry("changed", saved);
  restored.create("persona-2");
  assert.deepEqual(restored.create("persona-1"), first);
  saved[0].display_name = "mutated";
  const returned = restored.create("persona-1");
  returned.steps.push("mutated");
  assert.deepEqual(restored.create("persona-1"), first);
  assert.throws(
    () => restored.create("persona-1", [first.display_name]),
    /NICKNAME_REVIEW_REQUIRED/,
  );
  assert.deepEqual(restored.create("persona-1"), first);
  assert.throws(
    () => new NicknameRegistry("seed", [first, first]),
    /DUPLICATE_NICKNAME_REGISTRY/,
  );
});
test("creation is reproducible, excludes blocked names and fails without fallback when every candidate is blocked", () => {
  const left = new NicknameRegistry("repeat"),
    right = new NicknameRegistry("repeat");
  for (let i = 0; i < 30; i++)
    assert.deepEqual(left.create(`p${i}`), right.create(`p${i}`));
  const initial = new NicknameRegistry("repeat").create("blocked");
  const replacement = new NicknameRegistry("repeat").create("blocked", [
    initial.display_name,
  ]);
  assert.notEqual(
    nicknameKey(initial.display_name),
    nicknameKey(replacement.display_name),
  );
  assert.equal(initial.number_token, replacement.number_token);
  // A fully occupied registry cannot allocate another root; no UUID suffix or family reuse.
  const bases = [
    ...seedRows.map((r) => r[1]),
    ...materials.modifiers.flatMap((modifier) =>
      materials.default_nouns.map((noun) => modifier + noun),
    ),
  ];
  const all = [
    ...new Set(bases.map((base) => "root:" + nicknameKey(base))),
  ].map((family, index) => ({
    ...initial,
    persona_id: `occupied:${index}`,
    family_key: family,
    display_name: `n${index}`,
  }));
  const exhausted = new NicknameRegistry("full", all);
  assert.throws(() => exhausted.create("new"), /NICKNAME_POOL_EXHAUSTED/);
  assert.equal(exhausted.snapshot().length, all.length);
});
test("names are independent of topic and voice for the same synthetic identities", () => {
  const compose = (topic: string, voice: number) => {
    let index = 0;
    return automaticDefinitions(topic, {
      index: () => voice,
      id: () => `00000000-0000-4000-8000-${String(index++).padStart(12, "0")}`,
    });
  };
  assert.deepEqual(
    compose("게임", 0).map((c) => c.nickname),
    compose("요리", 2).map((c) => c.nickname),
  );
});

test("nickname policy covers prohibited roots and transformed output without blocking innocent substrings", () => {
  for (const name of [
    "씨발",
    "씨.발12",
    "병신_2",
    "Tlqkf",
    "fUck42",
    "sh1t",
    "s.h.i.t",
    "b1tch",
    "젖은조개",
    "ＳＨＩＴ",
  ]) {
    assert.equal(appropriateNickname(name), false, name);
    assert.equal(validNickname(name), false, name);
  }
  for (const name of [
    "glass",
    "grass",
    "class",
    "충전기",
    "메트로놈",
    "보리",
    "조개",
    "sigma",
  ])
    assert.equal(appropriateNickname(name), true, name);
});
test("curated source variants and all modifier/noun combinations satisfy nickname policy", () => {
  for (const row of seedRows)
    for (const text of [row[1], ...row[3], ...row[4], ...row[5]])
      assert(appropriateNickname(text), text);
  for (const modifier of materials.modifiers)
    for (const noun of materials.default_nouns)
      assert(appropriateNickname(modifier + noun), modifier + noun);
});
