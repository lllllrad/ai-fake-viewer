import {
  nicknameKey,
  validNickname,
} from "../../domain/cast/nicknames/validation.ts";
import type { NicknameIdentity } from "../../domain/cast/nicknames/types.ts";
import {
  definitionSchema,
  type Definition,
} from "../../contracts/persona-definition.ts";
import { normalizeName } from "../../domain/cast/names.ts";
import { ensure } from "./errors.ts";
export interface AutomaticCard {
  definition: Definition;
  sources: readonly string[];
  nickname?: NicknameIdentity;
}
export interface AutomaticCastRepository {
  transaction<T>(work: () => T): T;
  closed(): boolean;
  active(): string | undefined;
  viewerNames(): string[];
  create(topic: string, cards: AutomaticCard[], researchBasis: string): string;
  members(): Array<{ id: string; name: string; definition: unknown }>;
}
/** Six synthetic viewers belong to the broadcast, not an operator authoring job. */
export class AutomaticCast {
  constructor(
    private readonly repository: AutomaticCastRepository,
    private readonly composition: {
      cards(topic: string, blockedNames?: readonly string[]): AutomaticCard[];
      researchBasis: string;
      id(): string;
    },
  ) {}
  ensure(topic: string) {
    return this.repository.transaction(() => {
      ensure(!this.repository.closed(), "SESSION_CLOSED");
      const active = this.repository.active();
      if (active) {
        const blocked = new Set(this.repository.viewerNames().map(nicknameKey));
        ensure(
          !this.repository
            .members()
            .some((member) => blocked.has(nicknameKey(member.name))),
          "NICKNAME_REVIEW_REQUIRED",
        );
        return active;
      }
      const context = topic.trim() || "현재 방송";
      const cards = this.composition
        .cards(context, this.repository.viewerNames())
        .map((card) => ({
          ...card,
          definition: definitionSchema.parse(card.definition),
        }));
      ensure(cards.length === 6, "CAST_SIZE_MISMATCH");
      ensure(
        new Set(cards.map((card) => card.definition.persona_id)).size === 6,
        "DUPLICATE_CAST_IDENTITY",
      );
      const names = new Set(this.repository.viewerNames().map(normalizeName));
      const families = new Set<string>();
      for (const card of cards) {
        const name = card.definition.display_name_suggestion;
        ensure(
          validNickname(name, this.repository.viewerNames()) &&
            !names.has(normalizeName(name)),
          "NICKNAME_COLLISION",
        );
        if (card.nickname) {
          ensure(
            card.nickname.persona_id === card.definition.persona_id &&
              card.nickname.display_name === name,
            "NICKNAME_IDENTITY_MISMATCH",
          );
          ensure(
            !families.has(card.nickname.family_key),
            "NICKNAME_FAMILY_COLLISION",
          );
          families.add(card.nickname.family_key);
        }
        names.add(normalizeName(name));
      }
      return this.repository.create(
        context,
        cards,
        this.composition.researchBasis,
      );
    });
  }
  summary() {
    return this.repository.members().map((member) => {
      const definition = definitionSchema.parse(member.definition);
      return {
        id: member.id,
        name: member.name,
        motive: definition.core.viewing_motive,
        participation: definition.core.social_behavior,
      };
    });
  }
}
