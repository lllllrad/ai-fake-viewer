import {
  readerAuthSchema,
  type PublicEvent,
} from "../../contracts/conversation.ts";
import type { ConversationSnapshot } from "./projection-ports.ts";
export interface ReaderSource {
  snapshot(): ConversationSnapshot;
  event(event: PublicEvent): PublicEvent;
  subscribe(listeners: {
    event(event: PublicEvent): void;
    reset(): void;
  }): () => void;
}
export interface ReaderTransport {
  open(): boolean;
  bufferedBytes(): number;
  send(packet: unknown): void;
  close(code: number): void;
  ping(): void;
  terminate(): void;
}
export interface ReaderClock {
  after(milliseconds: number, action: () => void): () => void;
  every(milliseconds: number, action: () => void): () => void;
}
/** Owns one reader's authorization, subscriptions and bounded delivery lifetime. */
export class ReaderSession {
  private authorized = false;
  private disposed = false;
  private alive = true;
  private unsubscribe?: () => void;
  private readonly cancelAuth: () => void;
  private readonly cancelHeartbeat: () => void;
  constructor(
    private readonly source: ReaderSource,
    private readonly transport: ReaderTransport,
    clock: ReaderClock,
    private readonly options: {
      demo: boolean;
      authenticate(token: string): boolean;
      disposed(): void;
    },
  ) {
    this.cancelAuth = clock.after(5000, () => this.close(1008));
    this.cancelHeartbeat = clock.every(30000, () => this.heartbeat());
  }
  authenticate(raw: unknown) {
    if (this.disposed) return;
    const message = readerAuthSchema.safeParse(raw);
    if (
      this.authorized ||
      !message.success ||
      !this.options.authenticate(message.data.token)
    ) {
      this.close(1008);
      return;
    }
    this.authorized = true;
    this.cancelAuth();
    // Current snapshot and listener registration are synchronous; never replay cached raw bodies.
    this.reset();
    if (this.disposed) return;
    this.unsubscribe = this.source.subscribe({
      event: (event) =>
        this.deliver(() => ({
          type: "event",
          event: this.source.event(event),
        })),
      reset: () => this.reset(),
    });
  }
  private reset() {
    this.deliver(() => ({
      ...this.source.snapshot(),
      demo: this.options.demo,
    }));
  }
  private deliver(packet: () => unknown) {
    if (this.disposed || !this.authorized) return;
    if (!this.transport.open()) {
      this.dispose();
      return;
    }
    if (this.transport.bufferedBytes() > 1024 * 1024) {
      this.close(1013);
      return;
    }
    try {
      this.transport.send(packet());
    } catch {
      this.close(1011);
    }
  }
  pong() {
    if (!this.disposed) this.alive = true;
  }
  private heartbeat() {
    if (this.disposed) return;
    if (!this.alive) {
      this.dispose();
      this.transport.terminate();
      return;
    }
    this.alive = false;
    try {
      this.transport.ping();
    } catch {
      this.close(1011);
    }
  }
  close(code = 1000) {
    if (this.disposed) return;
    this.dispose();
    try {
      this.transport.close(code);
    } catch {
      // A broken transport must not turn a reader notification into a storage failure.
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAuth();
    this.cancelHeartbeat();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.options.disposed();
  }
}
