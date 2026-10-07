import type {
  ConversationMessage,
  ConversationIdentity,
  PublicEvent,
} from "../../contracts/conversation.ts";

export interface StoredConversationMessage extends ConversationMessage {
  author: string;
  channel: string;
}
export interface StoredConversationEvent extends PublicEvent {
  target: string | null;
}
export interface ConversationReadRepository {
  message(id: string): StoredConversationMessage | undefined;
  recentMessages(session: string): StoredConversationMessage[];
  event(sequence: number): StoredConversationEvent | undefined;
  latestIdentities(session: string): ConversationIdentity[] | undefined;
  disclosed(session: string): boolean;
  lastSequence(session: string): number;
  replaySequences(session: string, after: number): number[];
}
export interface ConversationProjectionEnvironment {
  sessionId(): string;
  closed(): boolean;
  permitted(message: StoredConversationMessage): boolean;
}
export interface ConversationSnapshot {
  type: "snapshot";
  sessionId: string;
  lastSeq: number;
  messages: Array<ConversationMessage | null>;
  identities: ConversationIdentity[];
  closed: boolean;
}
