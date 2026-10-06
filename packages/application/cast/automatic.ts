import {
  definitionSchema,
  type Definition,
} from "../../contracts/persona-definition.ts";
import { normalizeName } from "../../domain/cast/names.ts";
import { ensure } from "./errors.ts";
export interface AutomaticCard {
  definition: Definition;
  sources: readonly string[];
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
      cards(topic: string): AutomaticCard[];
      researchBasis: string;
      id(): string;
    },
  ) {}
  ensure(topic: string) {
    return this.repository.transaction(() => {
      ensure(!this.repository.closed(), "SESSION_CLOSED");
      const active = this.repository.active();
      if (active) return active;
      const context = topic.trim() || "현재 방송";
      const cards = this.composition
        .cards(context)
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
      for (const card of cards) {
        let suffix = 0;
        while (
          names.has(normalizeName(card.definition.display_name_suggestion))
        ) {
          ensure(suffix < 100, "NICKNAME_COLLISION");
          card.definition.display_name_suggestion = `시청자${this.composition.id().slice(0, 12)}${suffix++}`;
        }
        names.add(normalizeName(card.definition.display_name_suggestion));
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
