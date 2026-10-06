import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RightsService } from "../../../../packages/application/rights/service.ts";
import { rightsIntakeSchema } from "../../../../packages/contracts/rights.ts";

const requestParams = z.object({ id: z.string().min(1) });

export function registerRightsRoutes(
  app: FastifyInstance,
  rights: RightsService,
) {
  app.post("/api/admin/privacy/rights", async (req) =>
    rights.create(rightsIntakeSchema.parse(req.body)),
  );
  app.patch("/api/admin/privacy/rights/:id", async (req) =>
    rights.update(requestParams.parse(req.params).id, req.body),
  );
  app.delete("/api/admin/privacy/rights/:id", async (req) => {
    rights.remove(requestParams.parse(req.params).id);
    return { ok: true };
  });
  app.post("/api/admin/privacy/videos", async (req) => rights.video(req.body));
}
