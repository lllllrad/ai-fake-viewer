import type { FastifyInstance } from "fastify";
import {
  soopBroadcastSchema,
  soopStatusSchema,
  soopMessageSchema,
  soopNoticeFailedSchema,
} from "../../../../packages/contracts/soop-bridge.ts";
import type { SoopBridge } from "../../../../packages/application/inputs/soop-bridge.ts";
export function registerSoopBridgeRoutes(
  app: FastifyInstance,
  bridge: SoopBridge,
) {
  app.get("/api/admin/soop/chat-session", async () => bridge.session());
  app.post("/api/admin/soop/status", async (req) => {
    const body = soopStatusSchema.parse(req.body);
    bridge.report(body.state, body.broadcastId);
    return { ok: true };
  });
  app.post("/api/admin/soop/notices/next", async (req) =>
    bridge.nextNotice(soopBroadcastSchema.parse(req.body).broadcastId),
  );
  app.post("/api/admin/soop/notices/failed", async (req) => {
    const body = soopNoticeFailedSchema.parse(req.body);
    bridge.noticeFailed(body.id, body.broadcastId);
    return { ok: true };
  });
  app.post("/api/admin/soop/message", async (req) => {
    const body = soopMessageSchema.parse(req.body);
    bridge.receive(body, body.broadcastId);
    return { ok: true };
  });
}
