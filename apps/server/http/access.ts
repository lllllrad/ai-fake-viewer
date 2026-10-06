import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AdministratorSessions } from "../../../packages/infrastructure/accounts/administrator-sessions.ts";

interface HttpAccessSettings {
  port: number;
  network: { bindHost: string; publicBaseUrl: string };
  redirects: { youtube: string; chzzk: string; soop: string };
}

/** HTTP access rules and browser login share one session verifier. */
export function registerHttpAccess(
  app: FastifyInstance,
  settings: HttpAccessSettings,
  sessions: AdministratorSessions,
) {
  const youtubeCallback = new URL(settings.redirects.youtube);
  const chzzkCallback = new URL(settings.redirects.chzzk);
  const soopCallback = new URL(settings.redirects.soop);
  const origins = [
    `http://127.0.0.1:${settings.port}`,
    `http://localhost:${settings.port}`,
    ...(settings.network.bindHost === "0.0.0.0"
      ? [settings.network.publicBaseUrl]
      : []),
    `${youtubeCallback.origin}`,
    `${chzzkCallback.origin}`,
    `${soopCallback.origin}`,
  ];
  const publicOrigin =
    settings.network.bindHost === "0.0.0.0"
      ? settings.network.publicBaseUrl
      : origins[0];
  const isLoopback = (ip: string) =>
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
  const hosts = origins.map((v) => new URL(v).host);
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Content-Type-Options", "nosniff")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' https://static.sooplive.com; style-src 'self'; img-src 'self' blob: data:; connect-src 'self' https://openapi.sooplive.com wss://*.sooplive.com:*; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
    const requestPath = req.url.split("?", 1)[0];
    const isYoutubeCallback = requestPath === "/oauth/youtube/callback";
    const isChzzkCallback = requestPath === "/oauth/chzzk/callback";
    const isSoopCallback = requestPath === "/oauth/soop/callback";
    if (
      (req.url.startsWith("/api/admin/") ||
        (req.url.startsWith("/oauth/") &&
          !isYoutubeCallback &&
          !isChzzkCallback &&
          !isSoopCallback) ||
        ["/admin", "/"].includes(req.url)) &&
      !isLoopback(req.ip)
    )
      return reply
        .code(403)
        .send({ error: "Administrator access is local only" });
    const callbackHost = chzzkCallback.host;
    const soopCallbackHost = soopCallback.host;
    const hostAllowed =
      hosts.includes(req.headers.host ?? "") ||
      (isYoutubeCallback && req.headers.host === youtubeCallback.host) ||
      (isChzzkCallback && req.headers.host === callbackHost) ||
      (isSoopCallback && req.headers.host === soopCallbackHost);
    if (!hostAllowed) return reply.code(403).send({ error: "Host rejected" });
    if (
      req.headers.origin &&
      !origins.includes(req.headers.origin) &&
      !(isYoutubeCallback && req.headers.origin === youtubeCallback.origin) &&
      !(isChzzkCallback && req.headers.origin === chzzkCallback.origin) &&
      !(isSoopCallback && req.headers.origin === soopCallback.origin)
    )
      return reply.code(403).send({ error: "Origin rejected" });
    if (req.url.startsWith("/api/admin/") && req.url !== "/api/admin/login") {
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      if (
        !sessions.authenticateToken(token) &&
        !sessions.authenticateCookie(req.headers.cookie)
      )
        return reply.code(401).send({ error: "Administrator token required" });
      if (
        req.method !== "GET" &&
        req.headers.origin &&
        !origins.includes(req.headers.origin)
      )
        return reply.code(403).send({ error: "Origin rejected" });
    }
  });
  app.post("/api/admin/login", async (req, reply) => {
    const body = z.object({ token: z.string() }).parse(req.body);
    if (!sessions.authenticateToken(body.token))
      return reply.code(401).send({ error: "Invalid administrator token" });
    reply.header("Set-Cookie", sessions.issueCookie());
    return { ok: true };
  });
  app.post("/api/admin/logout", async (_req, reply) => {
    reply.header("Set-Cookie", sessions.clearCookie());
    return { ok: true };
  });

  return { origins, publicOrigin };
}
