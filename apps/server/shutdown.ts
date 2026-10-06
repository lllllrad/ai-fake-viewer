interface ServerShutdownDependencies {
  cancelTimers(): void;
  cancelAuthoring(): void;
  shutdownBroadcast(): Promise<void>;
  closeReaders(): void;
  flushFollowups(): void;
  closeBroadcastStorage(): void;
  closeRightsStorage(): void;
  clearFollowups(): void;
}

/** Drain inputs before closing storage; one failed cleanup cannot skip another resource. */
export class ServerShutdown {
  private result?: Promise<void>;
  constructor(private readonly dependencies: ServerShutdownDependencies) {}

  close(): Promise<void> {
    if (this.result) return this.result;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    this.result = new Promise<void>((done, failed) => {
      resolve = done;
      reject = failed;
    });
    // Publish ownership before cancellation callbacks can reenter close().
    void this.drain().then(resolve, reject);
    return this.result;
  }

  private async drain() {
    const failures: unknown[] = [];
    const attempt = (action: () => void) => {
      try {
        action();
      } catch (error) {
        failures.push(error);
      }
    };
    const d = this.dependencies;
    attempt(() => d.cancelTimers());
    attempt(() => d.cancelAuthoring());
    try {
      await d.shutdownBroadcast();
    } catch (error) {
      failures.push(error);
    }
    attempt(() => d.closeReaders());
    attempt(() => d.flushFollowups());
    attempt(() => d.closeBroadcastStorage());
    attempt(() => d.closeRightsStorage());
    attempt(() => d.clearFollowups());
    if (failures.length)
      throw new AggregateError(failures, "Server resource shutdown failed");
  }
}
