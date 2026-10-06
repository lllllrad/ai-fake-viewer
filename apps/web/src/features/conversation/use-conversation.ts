import { useEffect, useRef, useState } from "react";
import {
  decodeConversationPacket,
  emptyConversation,
  receiveConversation,
} from "./state.ts";
export type ConversationConnection =
  "connecting" | "connected" | "reconnecting" | "denied" | "invalid";

/** A single subscription owns reconnects and discards callbacks from prior credentials. */
export function useConversation(token: string) {
  const [conversation, setConversation] = useState(emptyConversation);
  const [connection, setConnection] =
    useState<ConversationConnection>("connecting");
  const sequence = useRef(0);
  useEffect(() => {
    setConversation(emptyConversation());
    sequence.current = 0;
    setConnection("connecting");
    if (!token) return;
    let disposed = false;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;
    const connect = () => {
      if (disposed) return;
      const current = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/stream`,
      );
      socket = current;
      current.onopen = () => {
        if (!disposed && socket === current)
          current.send(
            JSON.stringify({ type: "auth", token, afterSeq: sequence.current }),
          );
      };
      current.onmessage = (event) => {
        if (disposed || socket !== current) return;
        const packet = decodeConversationPacket(String(event.data));
        if (!packet) {
          setConnection("invalid");
          setConversation(emptyConversation());
          current.close(1002);
          return;
        }
        if (packet.type === "snapshot") {
          sequence.current = packet.lastSeq;
          setConnection("connected");
        } else if (packet.type === "event")
          sequence.current = Math.max(sequence.current, packet.event.seq);
        setConversation((state) => receiveConversation(state, packet));
      };
      current.onclose = (event) => {
        if (disposed || socket !== current) return;
        setConversation(emptyConversation());
        setConnection(event.code === 1008 ? "denied" : "reconnecting");
        if (event.code !== 1008) reconnect = setTimeout(connect, 2000);
      };
      current.onerror = () => {
        if (!disposed && socket === current) current.close();
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnect);
      socket?.close();
    };
  }, [token]);
  useEffect(() => {
    if (conversation.noticeAt === null) return;
    const timer = setTimeout(
      () => setConversation((state) => ({ ...state, noticeAt: null })),
      12000,
    );
    return () => clearTimeout(timer);
  }, [conversation.noticeAt]);
  return { conversation, connection };
}
