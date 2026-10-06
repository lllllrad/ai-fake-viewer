export interface ReactionClock<Handle> {
  repeat(callback: () => void, milliseconds: number): Handle;
  cancelRepeat(handle: Handle): void;
  delay(callback: () => void, milliseconds: number): Handle;
  cancelDelay(handle: Handle): void;
}
/** Owns timer cancellation, including callbacks already queued by the host clock. */
export class ReactionSchedule<Handle> {
  private epoch = 0;
  private dispatchRevision = 0;
  private polling?: Handle;
  private dispatch?: Handle;
  constructor(
    private readonly clock: ReactionClock<Handle>,
    private readonly failed: (error: unknown) => void,
  ) {}
  get pollHandle() {
    return this.polling;
  }
  get dispatchHandle() {
    return this.dispatch;
  }
  start(callback: () => void, milliseconds: number) {
    this.stop();
    const epoch = this.epoch;
    this.polling = this.clock.repeat(() => {
      if (epoch !== this.epoch) return;
      this.run(callback);
    }, milliseconds);
  }
  defer(callback: () => void, milliseconds: number) {
    this.cancelDispatch();
    const epoch = this.epoch,
      revision = this.dispatchRevision;
    this.dispatch = this.clock.delay(() => {
      if (epoch !== this.epoch || revision !== this.dispatchRevision) return;
      this.dispatch = undefined;
      this.dispatchRevision++;
      this.run(callback);
    }, milliseconds);
  }
  cancelDispatch() {
    this.dispatchRevision++;
    if (this.dispatch !== undefined) this.clock.cancelDelay(this.dispatch);
    this.dispatch = undefined;
  }
  stop() {
    this.epoch++;
    if (this.polling !== undefined) this.clock.cancelRepeat(this.polling);
    this.polling = undefined;
    this.cancelDispatch();
  }
  private run(callback: () => void) {
    try {
      callback();
    } catch (error) {
      this.stop();
      try {
        this.failed(error);
      } catch {
        /* Timers are already stopped. */
      }
    }
  }
}
