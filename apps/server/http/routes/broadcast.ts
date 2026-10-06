import type { FastifyInstance } from "fastify";
import type { BroadcastService } from "../../../../packages/application/broadcast/service.ts";
import type { BroadcastReadiness } from "../../../../packages/contracts/readiness.ts";

/** HTTP is a transport for application commands, not their state machine. */
export function registerBroadcastRoutes(
  app: FastifyInstance,
  broadcast: BroadcastService,
  readiness: () => BroadcastReadiness,
) {
  app.post("/api/admin/ai/start", async () => {
    broadcast.enableAi();
    return { ok: true, started: true, readiness: readiness() };
  });
  app.post("/api/admin/ai/stop", async () => {
    broadcast.disableAi();
    return { ok: true };
  });
  app.post("/api/admin/pipeline/start", async () => {
    broadcast.startInputs();
    return { ok: true, readiness: readiness() };
  });
  app.post("/api/admin/pipeline/stop", async () => {
    await broadcast.stopInputs();
    return { ok: true };
  });
  app.post("/api/admin/reveal", async () => {
    broadcast.disclose();
    return { ok: true };
  });
  app.post("/api/admin/session/close", async () => {
    await broadcast.endBroadcast();
    return { ok: true };
  });
  app.post("/api/admin/session/new", async () => ({
    ok: true,
    started: await broadcast.newBroadcast(),
  }));
  app.post("/api/admin/data/delete", async () => ({
    ok: true,
    deleted: await broadcast.eraseData(),
  }));
}
