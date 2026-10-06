import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ModelAccount } from "../../../../packages/application/accounts/model-account.ts";
export function registerModelAccountRoutes(
  app: FastifyInstance,
  account: ModelAccount,
) {
  app.post("/api/admin/chatgpt/authorize", async (req) => {
    const body = z
      .object({ clientId: z.string().optional() })
      .parse(req.body ?? {});
    return { url: account.authorize(body.clientId) };
  });
  app.get("/api/admin/chatgpt/models", async () => ({
    models: await account.models(),
  }));
  app.post("/api/admin/chatgpt/select-account", async (req) => {
    const body = z.object({ clientId: z.string() }).parse(req.body);
    account.selectAccount(body.clientId);
    return { ok: true };
  });
  app.post("/api/admin/chatgpt/select-model", async (req) => {
    const body = z.object({ slug: z.string() }).parse(req.body);
    await account.selectModel(body.slug);
    return { ok: true };
  });
  app.post("/api/admin/chatgpt/disconnect", async () => {
    return account.disconnect();
  });
  app.get("/oauth/chatgpt/callback", async (req, reply) => {
    try {
      const q = z
        .object({
          state: z.string().optional(),
          code: z.string().optional(),
          client_id: z.string().optional(),
          error: z.string().optional(),
        })
        .parse(req.query);
      await account.callback(q);
      return reply
        .type("text/plain; charset=utf-8")
        .send(
          "ChatGPT connected. Return to the admin page and select a model.",
        );
    } catch {
      return reply
        .code(400)
        .type("text/plain; charset=utf-8")
        .send(
          "ChatGPT connection failed. Return to the admin page and try again.",
        );
    }
  });
}
