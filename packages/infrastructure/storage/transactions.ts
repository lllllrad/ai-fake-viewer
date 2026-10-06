import type { DatabaseSync } from "node:sqlite";

/** Joins synchronous nested work and publishes effects only after the outer commit. */
export class SqliteTransactions {
  private current?: {
    effects: Array<() => void>;
    failure?: unknown;
    failed: boolean;
  };
  constructor(
    private readonly database: Pick<DatabaseSync, "exec">,
    private readonly checkpoint: () => () => void,
  ) {}
  run<T>(work: () => T): T {
    if (this.current) {
      try {
        return work();
      } catch (error) {
        this.current.failed = true;
        this.current.failure = error;
        throw error;
      }
    }
    const restore = this.checkpoint();
    const transaction = {
      effects: [] as Array<() => void>,
      failed: false,
      failure: undefined as unknown,
    };
    this.database.exec("BEGIN IMMEDIATE");
    this.current = transaction;
    let result: T;
    try {
      result = work();
      if (transaction.failed) throw transaction.failure;
      this.database.exec("COMMIT");
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } finally {
        restore();
        this.current = undefined;
      }
      throw error;
    }
    this.current = undefined;
    const failures: unknown[] = [];
    for (const effect of transaction.effects) {
      try {
        effect();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        "Committed broadcast notification failed",
      );
    return result;
  }
  afterCommit(effect: () => void) {
    if (this.current) this.current.effects.push(effect);
    else effect();
  }
}
