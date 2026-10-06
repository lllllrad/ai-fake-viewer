import { randomUUID } from "node:crypto";
import type { Store } from "../../storage.ts";
import { AutomaticCast } from "../../application/cast/automatic.ts";
import { CastExecutionControl } from "../../application/cast/control.ts";
import { BroadcastCast } from "../../application/cast/broadcast-cast.ts";
import {
  automaticDefinitions,
  researchBasis,
} from "../../persona/automatic.ts";
import { SqliteAutomaticCast } from "./automatic-sqlite.ts";
import { SqliteCastControl } from "./control-sqlite.ts";
export function createBroadcastCast(
  store: Store,
  topic: () => string,
  options: {
    now?: () => number;
    id?: () => string;
    cards?: typeof automaticDefinitions;
    researchBasis?: string;
  } = {},
) {
  const runtime = {
    sessionId: () => store.sessionId,
    closed: () => store.closed(),
    sequence: () => store.lastSeq(),
    id: options.id ?? randomUUID,
    now: options.now ?? (() => Date.now()),
    transaction: <T>(work: () => T) => store.transaction(work),
  };
  return new BroadcastCast(
    new AutomaticCast(new SqliteAutomaticCast(store.db, runtime), {
      cards: options.cards ?? automaticDefinitions,
      researchBasis: options.researchBasis ?? researchBasis,
      id: options.id ?? randomUUID,
    }),
    new CastExecutionControl(
      new SqliteCastControl(store.db, runtime),
      runtime.now,
    ),
    topic,
  );
}
