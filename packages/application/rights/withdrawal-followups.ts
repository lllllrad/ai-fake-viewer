import type { RightsIntake } from "../../contracts/rights.ts";
export interface FollowupWriter {
  create(
    intake: RightsIntake,
    requestIds: string[],
    appDone: boolean,
  ): { id: string };
  attachRequest(id: string, requestId: string): void;
}
interface Withdrawal {
  participantId: string;
  epoch: number;
  platform: string;
  account: string;
  session: string;
  broadcaster: string;
  published: boolean;
  requestIds: readonly string[];
}
type Pending =
  | { kind: "create"; intake: RightsIntake; requestIds: string[] }
  | { kind: "attach"; taskId: string; requestIds: string[] };
const boundedIds = (ids: readonly string[]) => [...new Set(ids)].slice(-100);
/** Post-commit follow-up retries retain identifiers, never participant snapshots or chat. */
export class WithdrawalFollowups {
  private readonly tasks = new Map<string, string>();
  private readonly pending = new Map<string, Pending>();
  constructor(private readonly writer: FollowupWriter) {}
  get pendingCount() {
    return this.pending.size;
  }
  withdrawn(input: Withdrawal) {
    if (!input.published && !input.requestIds.length) return;
    const key = `${input.participantId}:${input.epoch}`;
    const existing = this.pending.get(key);
    if (existing) {
      existing.requestIds = boundedIds([
        ...existing.requestIds,
        ...input.requestIds,
      ]);
      return;
    }
    const taskId = this.tasks.get(key);
    if (taskId) {
      if (input.requestIds.length)
        this.pending.set(key, {
          kind: "attach",
          taskId,
          requestIds: boundedIds(input.requestIds),
        });
      return;
    }
    this.pending.set(key, {
      kind: "create",
      intake: {
        platform: input.platform,
        account: input.account,
        session: input.session,
        broadcaster: input.broadcaster,
      },
      requestIds: boundedIds(input.requestIds),
    });
  }
  requestReturned(
    participantId: string,
    authorizedEpoch: number,
    requestId: string,
  ) {
    const key = `${participantId}:${authorizedEpoch + 1}`;
    const existing = this.pending.get(key);
    if (existing) {
      existing.requestIds = boundedIds([...existing.requestIds, requestId]);
      return;
    }
    const taskId = this.tasks.get(key);
    if (!taskId) return;
    this.pending.set(key, { kind: "attach", taskId, requestIds: [requestId] });
    this.flushKey(key);
  }
  private flushKey(key: string) {
    const pending = this.pending.get(key);
    if (!pending) return;
    try {
      if (pending.kind === "create") {
        const task = this.writer.create(
          pending.intake,
          pending.requestIds,
          true,
        );
        this.tasks.set(key, task.id);
      } else {
        while (pending.requestIds.length) {
          this.writer.attachRequest(pending.taskId, pending.requestIds[0]);
          pending.requestIds.shift();
        }
      }
      this.pending.delete(key);
    } catch {
      // Separate rights storage failure must not reverse completed local withdrawal.
    }
  }
  flush() {
    for (const key of this.pending.keys()) this.flushKey(key);
  }
  clear() {
    this.tasks.clear();
    this.pending.clear();
  }
}
