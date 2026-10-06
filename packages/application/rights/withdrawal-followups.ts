import type { RightsIntake, PendingFollowup } from "../../contracts/rights.ts";
export interface FollowupWriter {
  createFollowup(
    id: string,
    intake: RightsIntake,
    requestIds: string[],
  ): { id: string };
  attachRequest(id: string, requestId: string): void;
}
export interface Withdrawal {
  participantId: string;
  epoch: number;
  platform: string;
  account: string;
  session: string;
  broadcaster: string;
  published: boolean;
  requestIds: readonly string[];
}
export type { PendingFollowup } from "../../contracts/rights.ts";
export interface FollowupQueue {
  get(key: string): PendingFollowup | undefined;
  save(entry: PendingFollowup): void;
  remove(key: string): void;
  entries(): PendingFollowup[];
  count(): number;
}
const boundedIds = (ids: readonly string[]) => [...new Set(ids)].slice(-100);
/** Invoke inside the same transaction as local erasure and consent invalidation. */
export function enqueueWithdrawal(
  queue: FollowupQueue,
  input: Withdrawal,
  id: () => string,
) {
  if (!input.published && !input.requestIds.length) return;
  const key = `${input.participantId}:${input.epoch}`;
  const existing = queue.get(key);
  queue.save(
    existing
      ? {
          ...existing,
          requestIds: boundedIds([...existing.requestIds, ...input.requestIds]),
        }
      : {
          key,
          taskId: id(),
          intake: {
            platform: input.platform,
            account: input.account,
            session: input.session,
            broadcaster: input.broadcaster,
          },
          requestIds: boundedIds(input.requestIds),
        },
  );
}
/** Transfers durable minimal follow-ups to independent rights storage with idempotent intake. */
export class WithdrawalFollowups {
  private readonly tasks = new Map<string, string>();
  constructor(
    private readonly writer: FollowupWriter,
    private readonly queue: FollowupQueue,
    private readonly id: () => string,
  ) {}
  get pendingCount() {
    return this.queue.count();
  }
  withdrawn(input: Withdrawal) {
    const key = `${input.participantId}:${input.epoch}`,
      taskId = this.tasks.get(key);
    if (taskId && !this.queue.get(key)) {
      if (input.requestIds.length)
        this.queue.save({
          key,
          taskId,
          requestIds: boundedIds(input.requestIds),
        });
      return;
    }
    enqueueWithdrawal(this.queue, input, this.id);
  }
  requestReturned(
    participantId: string,
    authorizedEpoch: number,
    requestId: string,
  ) {
    const key = `${participantId}:${authorizedEpoch + 1}`;
    const existing = this.queue.get(key);
    if (existing) {
      this.queue.save({
        ...existing,
        requestIds: boundedIds([...existing.requestIds, requestId]),
      });
      return;
    }
    const taskId = this.tasks.get(key);
    if (!taskId) return;
    this.queue.save({ key, taskId, requestIds: [requestId] });
    this.flushKey(key);
  }
  private flushKey(key: string) {
    const pending = this.queue.get(key);
    if (!pending) return;
    try {
      if (pending.intake)
        this.writer.createFollowup(
          pending.taskId,
          pending.intake,
          pending.requestIds,
        );
      else
        for (const request of pending.requestIds)
          this.writer.attachRequest(pending.taskId, request);
      this.tasks.set(key, pending.taskId);
      this.queue.remove(key);
    } catch {
      // Keep the durable entry until both delivery and acknowledgement succeed.
    }
  }
  flush() {
    for (const entry of this.queue.entries()) this.flushKey(entry.key);
  }
  clear() {
    this.tasks.clear();
  }
}
