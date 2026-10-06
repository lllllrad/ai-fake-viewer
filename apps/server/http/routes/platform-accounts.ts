import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AccountActionError,
  type PlatformAccounts,
} from "../../../../packages/application/accounts/platform-accounts.ts";
export function registerPlatformAccountRoutes(
  app: FastifyInstance,
  accounts: PlatformAccounts,
) {
  for (const platform of ["youtube", "chzzk", "soop"] as const) {
    app.post(`/api/admin/${platform}/authorize`, async (_req, reply) => {
      try {
        return { url: accounts.authorize(platform) };
      } catch (error) {
        if (error instanceof AccountActionError)
          return reply.code(error.statusCode).send({ error: error.message });
        throw error;
      }
    });
    const action = platform === "youtube" ? "disconnect" : "forget";
    app.post(`/api/admin/${platform}/${action}`, async () => {
      await accounts.disconnect(platform);
      return { ok: true };
    });
  }
  app.get("/oauth/youtube/callback", async (req, reply) => {
    try {
      const q = z
        .object({
          code: z.string().max(4096).optional(),
          state: z.string().min(1).max(256),
          error: z.string().optional(),
        })
        .parse(req.query);
      await accounts.completeYoutube(q);
      return reply
        .type("text/plain; charset=utf-8")
        .send(
          "YouTube 연결 완료. 관리자 화면으로 돌아가 수신기를 시작해 주세요. 자동 안내는 연결한 채널의 승인된 방송에서 발송됩니다.",
        );
    } catch {
      return reply
        .code(400)
        .type("text/plain; charset=utf-8")
        .send(
          "YouTube 연결 실패. 클라이언트 정보·등록된 redirect URI·채팅 발송 권한을 확인하고 관리자 화면에서 다시 연결해 주세요.",
        );
    }
  });
  app.get("/oauth/soop/callback", async (req, reply) => {
    const query = z
      .object({
        code: z.string().min(1).max(2048).optional(),
        error: z.string().optional(),
      })
      .parse(req.query);
    try {
      await accounts.completeSoop(query);
      return reply
        .type("text/html; charset=utf-8")
        .send(
          "<!doctype html><meta charset=utf-8><title>SOOP 연결 완료</title><h1>SOOP authorization complete</h1><p>인증이 저장됐습니다. 관리자 페이지에서 SOOP 채팅 연결을 시작하세요.</p><p><a href='/admin'>관리자 페이지로 돌아가기</a></p>",
        );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (reason === "SOOP_AUTHORIZATION_EXPIRED")
        return reply
          .code(400)
          .type("text/html; charset=utf-8")
          .send(
            "<!doctype html><meta charset=utf-8><title>SOOP 연결 실패</title><h1>SOOP authorization failed</h1><p>승인 취소 또는 인증 시간이 만료됐습니다. 관리자 페이지에서 다시 시도하세요.</p>",
          );
      const message = /^SOOP_TOKEN_HTTP_[0-9]{3}$/.test(reason)
        ? `토큰 발급에 실패했습니다 (HTTP ${reason.slice("SOOP_TOKEN_HTTP_".length)}). 등록된 Redirect URI와 SOOP 앱 권한을 확인하세요.`
        : "토큰 응답을 확인하지 못했습니다. 앱 등록 상태와 권한을 확인한 뒤 다시 시도하세요.";
      return reply
        .code(400)
        .type("text/html; charset=utf-8")
        .send(
          `<!doctype html><meta charset=utf-8><title>SOOP 연결 실패</title><h1>SOOP authorization failed</h1><p>${message}</p>`,
        );
    }
  });
  app.get("/oauth/chzzk/callback", async (req, reply) => {
    try {
      const q = z
        .object({
          code: z.string().min(1).max(2048).optional(),
          state: z.string().length(64).optional(),
          error: z.string().optional(),
          error_description: z.string().max(500).optional(),
        })
        .parse(req.query);
      await accounts.completeChzzk(q);
      return reply
        .type("text/html; charset=utf-8")
        .send(
          '<!doctype html><meta charset="utf-8"><title>CHZZK 연결 완료</title><h1>CHZZK authorization complete</h1><p>인증이 저장됐습니다. 관리자 페이지로 돌아가 수신 시작을 누르세요.</p>',
        );
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Unknown callback failure";
      const message =
        reason === "CHZZK_USER_DENIED"
          ? "CHZZK authorization was canceled. Retry from the admin page."
          : reason === "CHZZK_STATE_INVALID"
            ? "OAuth state expired or was already used. Retry authorization."
            : /^CHZZK_TOKEN_HTTP_[0-9]{3}$/.test(reason)
              ? `CHZZK token exchange failed (HTTP ${reason.slice("CHZZK_TOKEN_HTTP_".length)}). Check the registered redirect URL and app credentials.`
              : reason.startsWith("CHZZK_TOKEN_API_CODE_")
                ? "CHZZK did not issue a token. Check app registration and try authorization again."
                : reason === "CHZZK_TOKEN_INVALID_JSON" ||
                    reason === "CHZZK_TOKEN_INVALID_RESPONSE"
                  ? "CHZZK returned an unexpected token response. Check app registration and try again."
                  : reason.startsWith("fetch failed") ||
                      reason.includes("timed out")
                    ? "Could not reach CHZZK token service. Check network access and retry."
                    : "CHZZK callback failed. Verify the registered redirect URL and retry authorization.";
      return reply
        .code(400)
        .type("text/html; charset=utf-8")
        .send(
          `<!doctype html><meta charset="utf-8"><title>CHZZK 연결 실패</title><h1>CHZZK authorization failed</h1><p>${message}</p>`,
        );
    }
  });
}
