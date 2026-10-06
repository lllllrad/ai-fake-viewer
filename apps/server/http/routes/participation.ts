import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ParticipationAdministration } from "../../../../packages/application/participation/administration.ts";
const participantParams = z.object({ id: z.string().min(1).max(100) });
export function registerParticipationRoutes(
  app: FastifyInstance,
  administration: ParticipationAdministration,
) {
  app.get("/api/admin/privacy", async () => administration.status());
  app.post(
    "/api/admin/privacy/participants/:id/notice-delivered",
    async (req) => {
      z.object({ delivered: z.literal(true) })
        .strict()
        .parse(req.body);
      administration.confirmNotice(participantParams.parse(req.params).id);
      return { ok: true };
    },
  );
  app.post(
    "/api/admin/privacy/participants/:id/confirm-live-command",
    async (req) => {
      const body = z
        .object({
          observationId: z.string().uuid(),
          verifiedLive: z.literal(true),
        })
        .strict()
        .parse(req.body);
      administration.confirmCommand(
        participantParams.parse(req.params).id,
        body.observationId,
      );
      return { ok: true };
    },
  );
  app.post("/api/admin/privacy/participants/:id/block-age", async (req) => {
    administration.blockAge(participantParams.parse(req.params).id);
    return { ok: true };
  });
}
