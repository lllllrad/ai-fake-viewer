import type { FastifyInstance } from "fastify";
import type { ProfileUpdate } from "../../../../packages/application/participation/profile-update.ts";
export function registerProfileRoutes(
  app: FastifyInstance,
  profile: ProfileUpdate,
) {
  app.put("/api/admin/privacy/profile", async (req) =>
    profile.update(req.body),
  );
}
