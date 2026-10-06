import type { FastifyInstance } from "fastify";
import {
  ReaderSession,
  type ReaderSource,
} from "../../../packages/application/conversation/reader-session.ts";
export function registerReaderStream(
  app: FastifyInstance,
  source: ReaderSource,
  options: {
    origins: readonly string[];
    demo: boolean;
    authenticate(token: string): boolean;
  },
) {
  const sessions = new Set<ReaderSession>();
  app.get("/stream", { websocket: true }, (socket, request) => {
    if (
      !request.headers.origin ||
      !options.origins.includes(request.headers.origin)
    ) {
      socket.close(1008);
      return;
    }
    const session = new ReaderSession(
      source,
      {
        open: () => socket.readyState === 1,
        bufferedBytes: () => socket.bufferedAmount,
        send: (packet) => socket.send(JSON.stringify(packet)),
        close: (code) => socket.close(code),
        ping: () => socket.ping(),
        terminate: () => socket.terminate(),
      },
      {
        after: (milliseconds, action) => {
          const timer = setTimeout(action, milliseconds);
          return () => clearTimeout(timer);
        },
        every: (milliseconds, action) => {
          const timer = setInterval(action, milliseconds);
          return () => clearInterval(timer);
        },
      },
      { ...options, disposed: () => sessions.delete(session) },
    );
    sessions.add(session);
    socket.on("message", (raw) => {
      try {
        session.authenticate(JSON.parse(raw.toString()));
      } catch {
        session.close(1008);
      }
    });
    socket.on("pong", () => session.pong());
    socket.on("close", () => session.dispose());
    socket.on("error", () => session.close(1011));
  });
  return {
    closeAll(code = 1000) {
      for (const session of [...sessions]) session.close(code);
    },
  };
}
