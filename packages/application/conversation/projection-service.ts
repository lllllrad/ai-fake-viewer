import { discloseMessage } from "../../domain/conversation/disclosure.ts";
import { publicMessageSchema } from "../../contracts/conversation.ts";
import type {
  ConversationMessage,
  PublicEvent,
} from "../../contracts/conversation.ts";
import type {
  ConversationReadRepository,
  ConversationProjectionEnvironment,
  ConversationSnapshot,
  StoredConversationMessage,
} from "./projection-ports.ts";

export class ConversationProjection {
  constructor(
    private readonly repository: ConversationReadRepository,
    private readonly environment: ConversationProjectionEnvironment,
  ) {}
  private project(
    message: StoredConversationMessage | undefined,
  ): ConversationMessage | null {
    if (!message || !this.environment.permitted(message)) return null;
    // Only explicit public fields cross this boundary.
    return {
      id: message.id,
      sessionId: message.sessionId,
      actorId: message.actorId,
      displayName: message.displayName,
      text: message.text,
      replyToId: message.replyToId,
      displayTime: message.displayTime,
      attribution: message.attribution,
      seq: message.seq,
    };
  }
  message(id: string) {
    return this.project(this.repository.message(id));
  }
  event(sequence: number): PublicEvent {
    const event = this.repository.event(sequence);
    if (!event) throw new Error("Conversation event not found");
    let type = event.type,
      payload = event.payload;
    if (type.startsWith("message.")) {
      payload =
        type === "message.added" || type === "message.updated"
          ? this.message(event.target ?? "")
          : { id: event.target };
      if (!payload) {
        type = "message.hidden";
        payload = { id: event.target };
      }
    }
    return {
      seq: event.seq,
      sessionId: event.sessionId,
      type,
      occurredAt: event.occurredAt,
      payload,
    };
  }
  private currentSnapshot() {
    const sessionId = this.environment.sessionId();
    const identities = this.repository.latestIdentities(sessionId);
    const closed = this.environment.closed();
    const messages = closed
      ? []
      : this.repository
          .recentMessages(sessionId)
          .map((message) => this.project(message));
    const visibleActors = new Set(
      messages
        .filter((message): message is ConversationMessage => message !== null)
        .map((message) => message.actorId),
    );
    const snapshot: ConversationSnapshot = {
      type: "snapshot",
      sessionId,
      lastSeq: this.repository.lastSequence(sessionId),
      messages,
      identities: (identities ?? []).filter((identity) =>
        visibleActors.has(identity.actorId),
      ),
      closed,
    };
    return { snapshot, revealed: identities !== undefined };
  }
  snapshot() {
    return this.currentSnapshot().snapshot;
  }
  disclosed() {
    return this.repository.disclosed(this.environment.sessionId());
  }
  readerMessage(message: ConversationMessage, revealed = this.disclosed()) {
    return discloseMessage(publicMessageSchema.parse(message), revealed);
  }
  readerSnapshot() {
    const { snapshot, revealed } = this.currentSnapshot();
    return {
      ...snapshot,
      messages: snapshot.messages
        .filter((m): m is ConversationMessage => m !== null)
        .map((message) => this.readerMessage(message, revealed)),
    };
  }
  readerEvent(event: PublicEvent): PublicEvent {
    if (event.type === "message.added" || event.type === "message.updated") {
      const value = event.payload;
      if (
        !value ||
        typeof value !== "object" ||
        !("id" in value) ||
        typeof value.id !== "string"
      )
        throw new Error("Conversation message event has no identifier");
      // A cached event cannot resurrect text removed since it was first projected.
      const message =
        !this.environment.closed() &&
        event.sessionId === this.environment.sessionId()
          ? this.message(value.id)
          : null;
      return message
        ? { ...event, payload: this.readerMessage(message) }
        : { ...event, type: "message.hidden", payload: { id: value.id } };
    }
    if (event.type.startsWith("message.")) {
      const payload = event.payload;
      return {
        ...event,
        payload: {
          id:
            payload && typeof payload === "object" && "id" in payload
              ? payload.id
              : null,
        },
      };
    }
    if (event.type === "identity.revealed")
      return {
        ...event,
        payload:
          event.sessionId === this.environment.sessionId()
            ? this.readerSnapshot().identities
            : [],
      };
    return event;
  }
  lastSequence() {
    return this.repository.lastSequence(this.environment.sessionId());
  }
  replay(after: number) {
    return this.repository
      .replaySequences(this.environment.sessionId(), after)
      .map((sequence) => this.event(sequence));
  }
}
