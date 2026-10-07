import type { DatabaseSync } from "node:sqlite";
import type { ViewerMemoryStore } from "../../application/reactions/viewer-memory.ts";
import {
  viewerMemorySchema,
  viewerStateSchema,
  type ViewerState,
} from "../../contracts/model-tools.ts";
export class SqliteViewerMemory implements ViewerMemoryStore {
  constructor(
    private db: DatabaseSync,
    private session: () => string,
    private now: () => number,
  ) {}
  list() {
    this.db
      .prepare("DELETE FROM viewer_memory WHERE expires<=?")
      .run(this.now());
    return this.db
      .prepare("SELECT payload FROM viewer_memory WHERE session=?")
      .all(this.session())
      .map((row) => viewerMemorySchema.parse(JSON.parse(String(row.payload))));
  }
  read(member: string, binding: string) {
    return this.list().find(
      (state) => state.memberId === member && state.binding === binding,
    );
  }
  write(
    member: string,
    binding: string,
    values: ViewerState,
    expires: number,
    sourceMessageIds: string[] = [],
    kind: "initial" | "updated" = "updated",
  ) {
    const previous = this.read(member, binding);
    const state = viewerMemorySchema.parse({
      memberId: member,
      binding,
      revision: (previous?.revision ?? 0) + 1,
      updatedAt: this.now(),
      expiresAt: expires,
      values: viewerStateSchema.parse(values),
      sourceMessageIds,
      kind,
    });
    // Never extend inherited context forever through repeated summarization.
    const prior =
      kind === "updated" && previous?.kind === "updated"
        ? this.db
            .prepare(
              "SELECT expires FROM viewer_memory WHERE session=? AND member=? AND binding=?",
            )
            .get(this.session(), member, binding)
        : undefined;
    state.expiresAt = Math.min(expires, Number(prior?.expires ?? expires));
    this.db
      .prepare(
        "INSERT INTO viewer_memory VALUES(?,?,?,?,?) ON CONFLICT(session,member) DO UPDATE SET binding=excluded.binding,payload=excluded.payload,expires=excluded.expires",
      )
      .run(
        this.session(),
        member,
        binding,
        JSON.stringify(state),
        Math.min(expires, Number(prior?.expires ?? expires)),
      );
    return state;
  }
  clear() {
    this.db.prepare("DELETE FROM viewer_memory").run();
  }
}
