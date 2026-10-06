interface Task {
  controller: AbortController;
  done: Promise<void>;
  stopping?: Promise<void>;
}

/** Owns platform execution slots through cancellation, draining and notification. */
export class PlatformTasks {
  private readonly tasks = new Map<string, Task>();
  private draining?: Promise<void>;
  constructor(
    private readonly failed: (platform: string, error: unknown) => void,
    private readonly stopped: (platform: string) => void,
  ) {}

  get stopping() {
    return this.draining !== undefined;
  }

  start(
    platform: string,
    run: (signal: AbortSignal) => Promise<void>,
  ): boolean {
    if (this.draining || this.tasks.has(platform)) return false;
    const task: Task = {
      controller: new AbortController(),
      done: Promise.resolve(),
    };
    this.tasks.set(platform, task);
    task.done = Promise.resolve()
      .then(() => {
        if (!task.controller.signal.aborted) return run(task.controller.signal);
      })
      .catch((error: unknown) => {
        if (!task.controller.signal.aborted) this.report(platform, error);
      })
      .finally(() => {
        if (!task.stopping && this.tasks.get(platform) === task)
          this.tasks.delete(platform);
      });
    return true;
  }

  stop(platform: string): Promise<void> {
    const task = this.tasks.get(platform);
    if (!task) {
      this.notifyStopped(platform);
      return Promise.resolve();
    }
    if (task.stopping) return task.stopping;
    // Install the drain before abort listeners can issue a reentrant stop.
    task.stopping = task.done.then(() => {
      try {
        this.notifyStopped(platform);
      } finally {
        if (this.tasks.get(platform) === task) this.tasks.delete(platform);
      }
    });
    task.controller.abort();
    return task.stopping;
  }

  stopAll(afterDrain: () => void = () => {}): Promise<void> {
    if (this.draining) return this.draining;
    // Publish the barrier before aborting any adapter: abort handlers may reenter.
    let finish!: () => void;
    const barrier = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.draining = barrier;
    const pending = [...this.tasks.keys()].map((platform) =>
      this.stop(platform),
    );
    void Promise.all(pending)
      .then(() => {
        try {
          afterDrain();
        } finally {
          this.draining = undefined;
          finish();
        }
      })
      .catch((error) => {
        // Cleanup callbacks must not become unhandled asynchronous rejections.
        this.report("all", error);
      });
    return barrier;
  }

  private notifyStopped(platform: string) {
    try {
      this.stopped(platform);
    } catch (error) {
      this.report(platform, error);
    }
  }
  private report(platform: string, error: unknown) {
    try {
      this.failed(platform, error);
    } catch {
      /* Release ownership even when reporting itself fails. */
    }
  }
}
