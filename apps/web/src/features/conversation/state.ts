import {
  conversationPacketSchema,
  type ConversationPacket,
  type ConversationMessage,
} from "../../../../../packages/contracts/conversation.ts";

export interface ConversationState {
  sessionId: string | null;
  sequence: number;
  messages: ConversationMessage[];
  closed: boolean;
  demo: boolean;
}
export function emptyConversation(): ConversationState {
  return {
    sessionId: null,
    sequence: 0,
    messages: [],
    closed: false,
    demo: false,
  };
}
export function decodeConversationPacket(
  raw: string,
): ConversationPacket | undefined {
  try {
    const parsed = conversationPacketSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
export function receiveConversation(
  state: ConversationState,
  packet: ConversationPacket,
): ConversationState {
  if (packet.type === "snapshot")
    return {
      sessionId: packet.sessionId,
      sequence: packet.lastSeq,
      messages: packet.closed
        ? []
        : packet.messages
            .filter((m) => m.sessionId === packet.sessionId)
            .slice(-300),
      closed: packet.closed,
      demo: packet.demo,
    };
  const event = packet.event;
  if (event.sessionId !== state.sessionId || event.seq <= state.sequence)
    return state;
  const next = { ...state, sequence: event.seq };
  if (event.type === "session.closed")
    return { ...next, closed: true, messages: [] };
  if (state.closed) return next;
  if (event.type === "message.hidden")
    return {
      ...next,
      messages: state.messages.filter((m) => m.id !== event.payload.id),
    };
  if (event.type === "message.added" || event.type === "message.updated") {
    if (event.payload.sessionId !== state.sessionId) return next;
    return {
      ...next,
      messages: [
        ...state.messages.filter((m) => m.id !== event.payload.id),
        event.payload,
      ]
        .sort((a, b) => a.seq - b.seq)
        .slice(-300),
    };
  }
  // Identity changes are followed by a fresh server projection, not client reconstruction.
  return next;
}
