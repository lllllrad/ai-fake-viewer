export type Kind =
  | "ko_common"
  | "ko_alias"
  | "name_fragment"
  | "en_word"
  | "phrase"
  | "hobby"
  | "default_combo";
export type SeedRow = [
  id: string,
  base: string,
  kind: Exclude<Kind, "default_combo">,
  roman: string[],
  initials: string[],
  spellings: string[],
  repeat: boolean,
  affix: boolean,
];
export interface NicknameIdentity {
  persona_id: string;
  source: "synthetic";
  display_name: string;
  family_key: string;
  seed_id: string;
  base: string;
  base_kind: Kind;
  origin_mode: string;
  number_token: string;
  number_style: string;
  number_meaning: "unspecified_fictional_token_not_birthdate";
  steps: string[];
  generator_version: string;
  data_version: string;
  rules_version: string;
  source_id: "starter_curated_v1";
  real_account_availability_checked: false;
}
