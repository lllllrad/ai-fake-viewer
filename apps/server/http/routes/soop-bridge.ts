import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SoopBridge } from "../../../../packages/application/inputs/soop-bridge.ts";
export function registerSoopBridgeRoutes(
  app: FastifyInstance,
  bridge: SoopBridge,
) {
  app.get("/api/admin/soop/chat-session", async () => bridge.session());
  app.post("/api/admin/soop/status", async (req) => {
    const body = z
      .object({
        state: z.enum([
          "connecting",
          "subscribed",
          "disconnected",
          "permission_blocked",
          "failed",
        ]),
      })
      .parse(req.body);
    bridge.report(body.state);
    return { ok: true };
  });
  app.post("/api/admin/soop/notices/next", async () => bridge.nextNotice());
  app.post("/api/admin/soop/notices/failed", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(req.body);
    bridge.noticeFailed(id);
    return { ok: true };
  });
  app.post("/api/admin/soop/message", async (req) => {
    const body = z
      .object({
        userId: z.string().min(1).max(256),
        userNickname: z.string().trim().min(1).max(120),
        message: z.string().trim().min(1).max(4000),
      })
      .strict()
      .parse(req.body);
    bridge.receive(body);
    return { ok: true };
  });
}
