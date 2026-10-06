import { createHash } from "node:crypto";
import type { ReactionClock } from "../../application/reactions/scheduling.ts";

/** One simulation owns its clock and random stream; never patches global time. */
export class ExperimentRuntime {
  private state: number;
  private sequence = 0;
  now = 1800000000000;
  private timerId = 0;
  private delays = new Map<number, { at: number; callback(): void }>();
  constructor(readonly seed: number) {
    this.state = seed >>> 0;
  }
  random = () => {
    this.state += 0x6d2b79f5;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  id = () => {
    const hex = this.hash(`${this.seed}:${this.sequence++}`);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  hash = (value: string) => createHash("sha256").update(value).digest("hex");
  clock: ReactionClock<number> = {
    // The replay driver awaits every poll. Only publication delays are queued.
    repeat: () => ++this.timerId,
    cancelRepeat: () => {},
    delay: (callback, ms) => {
      const id = ++this.timerId;
      this.delays.set(id, { at: this.now + ms, callback });
      return id;
    },
    cancelDelay: (id) => {
      this.delays.delete(id);
    },
  };
  advance(to: number) {
    for (;;) {
      const next = [...this.delays.entries()]
        .filter(([, t]) => t.at <= to)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      this.now = next[1].at;
      this.delays.delete(next[0]);
      next[1].callback();
    }
    this.now = to;
  }
}
