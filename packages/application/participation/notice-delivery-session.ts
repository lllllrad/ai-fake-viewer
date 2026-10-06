export interface NoticeDeliveryPort {
  tick(signal: AbortSignal): Promise<void>;
  reset(): void;
}
export interface NoticeDeliveryClock<Handle> {
  repeat(callback: () => void, milliseconds: number): Handle;
  cancel(handle: Handle): void;
}

/** One platform connection's non-overlapping notice delivery and shutdown. */
export class NoticeDeliverySession<Handle> {
  private readonly controller = new AbortController();
  private stopped = false;
  private timer?: Handle;
  private pending?: Promise<void>;
  private readonly abort = () => {
    this.retire();
  };

  constructor(
    private readonly sender: NoticeDeliveryPort,
    private readonly signal: AbortSignal,
    private readonly clock: NoticeDeliveryClock<Handle>,
    private readonly failed: (error: unknown) => void,
  ) {
    if (signal.aborted) {
      this.retire();
      return;
    }
    signal.addEventListener("abort", this.abort, { once: true });
    try {
      this.timer = clock.repeat(() => this.tick(), 1000);
    } catch (error) {
      this.retire();
      this.report(error);
    }
  }

  stop(): Promise<void> {
    this.retire();
    return this.pending ?? Promise.resolve();
  }

  private tick() {
    if (this.stopped || this.pending) return;
    // Attach rejection handling before invoking a sender, including synchronous throws.
    const task = Promise.resolve()
      .then(() => {
        if (!this.stopped) return this.sender.tick(this.controller.signal);
      })
      .catch((error: unknown) => {
        if (this.stopped) return;
        this.retire();
        this.report(error);
      })
      .finally(() => {
        if (this.pending === task) this.pending = undefined;
      });
    this.pending = task;
  }

  private retire() {
    if (this.stopped) return;
    this.stopped = true;
    this.signal.removeEventListener("abort", this.abort);
    if (this.timer !== undefined) {
      try {
        this.clock.cancel(this.timer);
      } catch (error) {
        this.report(error);
      }
      this.timer = undefined;
    }
    this.controller.abort();
    try {
      this.sender.reset();
    } catch (error) {
      this.report(error);
    }
  }

  private report(error: unknown) {
    try {
      this.failed(error);
    } catch {
      /* Delivery is already retired; diagnostics cannot restart it. */
    }
  }
}
