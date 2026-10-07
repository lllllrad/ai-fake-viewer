import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AdministratorSessions } from "../../../packages/infrastructure/accounts/administrator-sessions.ts";

interface HttpAccessSettings {
  port: number;
  network: { bindHost: string; publicBaseUrl: string };
}

/** HTTP access rules and browser login share one session verifier. */
export function registerHttpAccess(
  app: FastifyInstance,
  settings: HttpAccessSettings,
  sessions: AdministratorSessions,
) {
  const origins = [
    `http://127.0.0.1:${settings.port}`,
    `http://localhost:${settings.port}`,
    ...(settings.network.bindHost === "0.0.0.0"
      ? [settings.network.publicBaseUrl]
      : []),
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
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
    if (
      (req.url.startsWith("/api/admin/") ||
        req.url.startsWith("/oauth/") ||
        ["/admin", "/"].includes(req.url)) &&
      !isLoopback(req.ip)
    )
      return reply
        .code(403)
        .send({ error: "Administrator access is local only" });
    if (!hosts.includes(req.headers.host ?? ""))
      return reply.code(403).send({ error: "Host rejected" });
    if (req.headers.origin && !origins.includes(req.headers.origin))
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
