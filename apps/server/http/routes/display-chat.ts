import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DisplayChatCommands } from "../../../../packages/application/inputs/display-chat.ts";
import {
  soopMessageSchema,
  soopStatusSchema,
} from "../../../../packages/contracts/soop-bridge.ts";

export function registerDisplayChatRoutes(
  app: FastifyInstance,
  chat: DisplayChatCommands,
) {
  app.get("/api/admin/display-chat", async () => chat.status());
  app.put("/api/admin/display-chat", async (req) => {
    await chat.save(req.body);
    return chat.status();
  });
  for (const platform of ["youtube", "chzzk", "soop"] as const) {
    app.post(`/api/admin/display-chat/${platform}/start`, async () => {
      chat.start(platform);
      return { ok: true };
    });
    app.post(`/api/admin/display-chat/${platform}/stop`, async () => {
      await chat.stop(platform);
      return { ok: true };
    });
    app.post(
      `/api/admin/display-chat/${platform}/authorize`,
      async (_req, reply) => {
        try {
          return { url: chat.accounts.authorize(platform) };
        } catch {
          return reply
            .code(409)
            .send({
              error: "방송 채팅 설정과 플랫폼 앱 인증 정보를 확인해 주세요.",
            });
        }
      },
    );
    app.post(`/api/admin/display-chat/${platform}/disconnect`, async () => {
      await chat.accounts.disconnect(platform);
      return { ok: true };
    });
    app.get(`/oauth/${platform}/callback`, async (req, reply) => {
      try {
        const q = z
          .object({
            code: z.string().max(4096).optional(),
            state: z.string().max(256).optional(),
            error: z.string().max(100).optional(),
          })
          .parse(req.query);
        if (platform === "youtube")
          await chat.accounts.completeYoutube({ ...q, state: q.state ?? "" });
        if (platform === "chzzk") await chat.accounts.completeChzzk(q);
        if (platform === "soop") await chat.accounts.completeSoop(q);
        chat.start(platform);
        return reply.redirect("/admin#chat-details", 303);
      } catch {
        return reply
          .code(400)
          .type("text/html; charset=utf-8")
          .send(
            '<!doctype html><meta charset="utf-8"><title>채팅 계정 연결 실패</title><p>플랫폼 앱 설정과 등록된 콜백 주소를 확인해 주세요.</p><a href="/admin#chat-details">방송 채팅 설정으로 돌아가기</a>',
          );
      }
    });
  }
  app.get("/api/admin/soop/chat-session", async (_req, reply) => {
    try {
      return await chat.soopSession();
    } catch {
      return reply
        .code(409)
        .send({ error: "SOOP 계정·방송 설정을 확인하고 다시 연결해 주세요." });
    }
  });
  app.post("/api/admin/soop/status", async (req, reply) => {
    const body = soopStatusSchema.parse(req.body);
    try {
      chat.soopStatus(body.state, body.broadcastId);
      return { ok: true };
    } catch {
      return reply
        .code(409)
        .send({ error: "SOOP 연결이 변경되었습니다. 다시 연결해 주세요." });
    }
  });
  app.post("/api/admin/soop/message", async (req, reply) => {
    const body = soopMessageSchema.parse(req.body);
    try {
      chat.soopMessage(body);
      return { ok: true };
    } catch {
      return reply.code(409).send({ error: "SOOP 채팅 연결을 확인해 주세요." });
    }
  });
}
