import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Store } from "../../storage.ts";
import type {
  ConversationMessage,
  PublicEvent,
} from "../../contracts/conversation.ts";
import type { ReaderSource } from "../../application/conversation/reader-session.ts";
import { discloseMessage } from "../../domain/conversation/disclosure.ts";

import {
  displayChatSchema,
  type DisplayChat,
} from "../../contracts/display-chat.ts";

/** Presentation-only, bounded memory. Never writes to or invalidates the AI store. */
export class DisplayConversation implements ReaderSource {
  private readonly events = new EventEmitter();
  private readonly viewers = new Map<string, ConversationMessage>();
  private readonly sources = new Map<string, string>();
  private readonly sequences = new Map<string, number>();
  private session: string;
  private sequence = 0;
  constructor(
    private readonly store: Pick<
      Store,
      | "sessionId"
      | "closed"
      | "readerSnapshot"
      | "readerEvent"
      | "originsRevealed"
      | "on"
      | "off"
    >,
    private readonly now = () => Date.now(),
  ) {
    this.session = store.sessionId;
    this.snapshot();
    store.on("event", this.onAiEvent);
    store.on("reset", this.onReset);
  }
  private syncSession() {
    if (this.session !== this.store.sessionId || this.store.closed()) {
      this.viewers.clear();
      this.sources.clear();
      this.sequences.clear();
      this.session = this.store.sessionId;
    }
  }
  private aiMessage(message: ConversationMessage): ConversationMessage {
    let seq = this.sequences.get(message.id);
    if (seq === undefined) {
      seq = ++this.sequence;
      this.sequences.set(message.id, seq);
    }
    return { ...message, seq };
  }
  private readonly onAiEvent = (event: PublicEvent) => {
    this.syncSession();
    const current = this.store.readerEvent(event);
    const seq = ++this.sequence;
    if (
      current.type === "message.added" ||
      current.type === "message.updated"
    ) {
      const message = current.payload as ConversationMessage;
      this.sequences.set(message.id, seq);
      current.payload = { ...message, seq };
    }
    this.events.emit("event", { ...current, seq });
  };
  private readonly onReset = () => {
    this.syncSession();
    this.events.emit("reset");
  };
  snapshot() {
    this.syncSession();
    const source = this.store.readerSnapshot();
    const ai = source.messages.filter(
      (m): m is ConversationMessage => m !== null,
    );
    const liveIds = new Set(ai.map((m) => m.id));
    for (const id of this.sequences.keys())
      if (!liveIds.has(id)) this.sequences.delete(id);
    const messages = [
      ...ai.map((m) => this.aiMessage(m)),
      ...[...this.viewers.values()].map((m) =>
        discloseMessage(m, this.store.originsRevealed()),
      ),
    ]
      .sort((a, b) => a.seq - b.seq)
      .slice(-300);
    return { ...source, messages, lastSeq: this.sequence };
  }
  event(event: PublicEvent): PublicEvent {
    const payload = event.payload as ConversationMessage | null;
    if (event.type === "message.added" || event.type === "message.updated") {
      const viewer = payload && this.viewers.get(payload.id);
      if (
        viewer &&
        viewer.sessionId === this.store.sessionId &&
        !this.store.closed()
      )
        return {
          ...event,
          payload: discloseMessage(viewer, this.store.originsRevealed()),
        };
      const current = this.store.readerEvent(event);
      return current.type === "message.hidden"
        ? current
        : {
            ...current,
            payload: this.aiMessage(current.payload as ConversationMessage),
          };
    }
    return event;
  }
  subscribe(listeners: { event(event: PublicEvent): void; reset(): void }) {
    this.events.on("event", listeners.event);
    this.events.on("reset", listeners.reset);
    return () => {
      this.events.off("event", listeners.event);
      this.events.off("reset", listeners.reset);
    };
  }
  receive(raw: DisplayChat) {
    const input = displayChatSchema.parse(raw);
    this.syncSession();
    if (this.store.closed()) return false;
    const key = JSON.stringify([input.platform, input.channel, input.sourceId]);
    const priorId = this.sources.get(key);
    if (priorId) return false;
    const id = randomUUID();
    const message: ConversationMessage = {
      id,
      sessionId: this.session,
      actorId: randomUUID(),
      displayName: input.name,
      text: input.text,
      attribution: input.platform,
      replyToId: null,
      displayTime: this.now(),
      seq: ++this.sequence,
    };
    this.sources.set(key, id);
    this.viewers.set(id, message);
    while (this.viewers.size > 300)
      this.viewers.delete(this.viewers.keys().next().value!);
    while (this.sources.size > 1000)
      this.sources.delete(this.sources.keys().next().value!);
    this.events.emit("event", {
      seq: message.seq,
      sessionId: this.session,
      occurredAt: message.displayTime,
      type: "message.added",
      payload: message,
    });
    return true;
  }
  hide(id: string) {
    if (!this.viewers.delete(id)) return false;
    this.events.emit("event", {
      seq: ++this.sequence,
      sessionId: this.session,
      occurredAt: this.now(),
      type: "message.hidden",
      payload: { id },
    });
    return true;
  }
  clear() {
    this.viewers.clear();
    this.sources.clear();
    this.events.emit("reset");
  }
  close() {
    this.store.off("event", this.onAiEvent);
    this.store.off("reset", this.onReset);
    this.viewers.clear();
    this.sources.clear();
    this.sequences.clear();
    this.events.removeAllListeners();
  }
}
