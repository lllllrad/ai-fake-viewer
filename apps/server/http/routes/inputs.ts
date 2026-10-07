import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import type { BroadcastService } from "../../../../packages/application/broadcast/service.ts";

export function registerInputRoutes(
  app: FastifyInstance,
  broadcast: BroadcastService,
  queries: {
    preview(): { bytes: Buffer } | undefined;
    transcripts(): Iterable<string>;
  },
) {
  for (const [path, input] of [
    ["capture", "screen"],
    ["audio", "speech"],
  ] as const) {
    app.post(`/api/admin/${path}/start`, async () => {
      broadcast.startInput(input);
      return { ok: true };
    });
    app.post(`/api/admin/${path}/stop`, async () => {
      await broadcast.stopInput(input);
      return { ok: true };
    });
  }
  app.get("/api/admin/preview", async (_req, reply) => {
    const frame = queries.preview();
    if (!frame) return reply.code(404).send({ error: "No frame available" });
    return reply.type("image/jpeg").send(frame.bytes);
  });
  app.get("/api/admin/transcripts/export", async (_req, reply) => {
    reply
      .type("application/x-ndjson; charset=utf-8")
      .header(
        "Content-Disposition",
        'attachment; filename="transcripts.jsonl"',
      );
    return reply.send(Readable.from(queries.transcripts()));
  });
}
