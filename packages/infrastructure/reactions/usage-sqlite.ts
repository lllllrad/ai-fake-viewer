import type { DatabaseSync } from "node:sqlite";
import type { ModelUsagePort } from "../../application/reactions/model-call.ts";
export class SqliteModelUsage implements ModelUsagePort {
  constructor(
    private readonly db: DatabaseSync,
    private readonly runtime: {
      sessionId(): string;
      id(): string;
      now(): number;
    },
    private readonly transactions: { run<T>(work: () => T): T },
  ) {}
  reserve(maxUsd: number | null, reserved: number | null) {
    return this.transactions.run(() => {
      const usage = this.usage();
      if (maxUsd !== null && usage.reservedUsd + (reserved ?? 0) > maxUsd)
        return null;
      const id = this.runtime.id();
      this.db
        .prepare(
          "INSERT INTO model_usage(id,session,at,reserved,status) VALUES(?,?,?,?,?)",
        )
        .run(
          id,
          this.runtime.sessionId(),
          this.runtime.now(),
          reserved,
          "reserved",
        );
      return id;
    });
  }
  settle(
    id: string,
    input: number | undefined,
    output: number | undefined,
    cost: number | null,
  ) {
    this.db
      .prepare(
        "UPDATE model_usage SET input=?,output=?,reserved=COALESCE(?,reserved),status=? WHERE id=? AND session=?",
      )
      .run(
        input ?? null,
        output ?? null,
        cost,
        "completed",
        id,
        this.runtime.sessionId(),
      );
  }
  usage() {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) calls,COALESCE(SUM(reserved),0) reservedUsd,SUM(input) inputTokens,SUM(output) outputTokens FROM model_usage WHERE session=?",
      )
      .get(this.runtime.sessionId())!;
    return {
      calls: Number(row.calls),
      reservedUsd: Number(row.reservedUsd),
      inputTokens: row.inputTokens === null ? null : Number(row.inputTokens),
      outputTokens: row.outputTokens === null ? null : Number(row.outputTokens),
    };
  }
}
