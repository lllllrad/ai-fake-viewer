import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { timingSafeEqual, randomBytes, createHmac } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import { z } from "zod";
import type { Config } from "../../packages/config.ts";
import type { PublicEvent } from "../../packages/contracts.ts";
import { Store } from "../../packages/storage.ts";
import { Capture } from "../../packages/capture.ts";
import { Transcriber } from "../../packages/transcription.ts";
import { AiStartError, Scheduler } from "../../packages/scheduler.ts";
import { mockModel, openaiModel, chatgptModel } from "../../packages/model.ts";
import { ChatgptAuth } from "../../packages/chatgpt-auth.ts";
import { ChzzkAuth } from "../../packages/chzzk.ts";
import { Supervisor } from "../../packages/supervisor.ts";
export function equal(a: unknown, b: string) {
  return (
    typeof a === "string" &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export async function createApp(
  config: Config,
  opts: {
    demo?: boolean;
    adminToken: string;
    readerToken: string;
    encryptionKey: string;
    startInputs?: boolean;
    persistReaderToken?: (token: string) => void;
    chatgptTokenPath?: string;
  },
) {
  if (
    opts.adminToken.length < 32 ||
    opts.readerToken.length < 32 ||
    opts.adminToken === opts.readerToken
  )
    throw Error("Generate independent credentials using npm run setup");
  const app = Fastify({ logger: false, bodyLimit: 65536 });
  const store = new Store(config.database);
  const capture = new Capture(config.capture, !!opts.demo);
  const transcriber = new Transcriber(
    config.audio,
    config.policy.groqAudioReviewed,
    fetch,
    (entry) => store.recordTranscript(entry),
  );
  const chatgpt = new ChatgptAuth(
    opts.encryptionKey,
    opts.chatgptTokenPath ?? "data/chatgpt.tokens",
  );
  const scheduler = new Scheduler(
    store,
    capture,
    config,
    opts.demo
      ? mockModel
      : config.ai.provider === "chatgpt_subscription"
        ? chatgptModel(config.ai, chatgpt)
        : openaiModel(config.ai),
    !!opts.demo,
    () =>
      config.ai.provider === "chatgpt_subscription"
        ? !!chatgpt.active?.refreshToken && !!chatgpt.active?.model
        : !!process.env.OPENAI_API_KEY && !!process.env.OPENAI_MODEL,
    transcriber,
  );
  const auth = new ChzzkAuth(opts.encryptionKey);
  const supervisor = new Supervisor(config, store, auth, !!opts.demo);
  let readerToken = opts.readerToken;
  const origins = [
    `http://127.0.0.1:${config.port}`,
    `http://localhost:${config.port}`,
    ...(config.network.bindHost === "0.0.0.0"
      ? [config.network.publicBaseUrl]
      : []),
  ];
  const publicOrigin =
    config.network.bindHost === "0.0.0.0"
      ? config.network.publicBaseUrl
      : origins[0];
  const isLoopback = (ip: string) =>
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
  const hosts = origins.map((v) => new URL(v).host);
  const sessionAgeSeconds = 7 * 24 * 60 * 60;
  const sessionCookie = "mixed_chat_admin";
  const signSession = (value: string) =>
    createHmac("sha256", opts.adminToken).update(value).digest("base64url");
  const newSession = () => {
    const payload = `${Date.now() + sessionAgeSeconds * 1000}.${randomBytes(16).toString("base64url")}`;
    return `${payload}.${signSession(payload)}`;
  };
  const validSession = (cookie: string | undefined) => {
    const value = cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${sessionCookie}=`))
      ?.slice(sessionCookie.length + 1);
    if (!value || !/^\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value))
      return false;
    const dot = value.lastIndexOf(".");
    const payload = value.slice(0, dot);
    const expires = Number(payload.slice(0, payload.indexOf(".")));
    return (
      Number.isSafeInteger(expires) &&
      expires > Date.now() &&
      equal(value.slice(dot + 1), signSession(payload))
    );
  };
  const sockets = new Set<any>();
  await app.register(websocket, { options: { maxPayload: 4096 } });
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
      if (!equal(token, opts.adminToken) && !validSession(req.headers.cookie))
        return reply.code(401).send({ error: "Administrator token required" });
      if (
        req.method !== "GET" &&
        req.headers.origin &&
        !origins.includes(req.headers.origin)
      )
        return reply.code(403).send({ error: "Origin rejected" });
    }
  });
  app.setErrorHandler((e, req, reply) => {
    const validation = e instanceof z.ZodError;
    reply.code(validation ? 400 : ((e as any).statusCode ?? 400)).send({
      error: validation
        ? "Invalid request fields"
        : e instanceof AiStartError
          ? e.message
          : req.url.startsWith("/api/admin/")
            ? "Action unavailable. Check configuration, credentials, fresh frames and session state."
            : "Request failed",
    });
  });
  app.get("/health", async () => ({ ok: true }));
  app.post("/api/admin/login", async (req, reply) => {
    const body = z.object({ token: z.string() }).parse(req.body);
    if (!equal(body.token, opts.adminToken))
      return reply.code(401).send({ error: "Invalid administrator token" });
    reply.header(
      "Set-Cookie",
      `${sessionCookie}=${newSession()}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${sessionAgeSeconds}`,
    );
    return { ok: true };
  });
  app.post("/api/admin/logout", async (_req, reply) => {
    reply.header(
      "Set-Cookie",
      `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0`,
    );
    return { ok: true };
  });

  app.get("/stream", { websocket: true }, (socket, req) => {
    if (!req.headers.origin || !origins.includes(req.headers.origin)) {
      socket.close(1008);
      return;
    }
    let authorized = false;
    let alive = true;
    const timeout = setTimeout(() => socket.close(1008), 5000);
    const send = (data: unknown) => {
      if (socket.readyState !== 1) return;
      if (socket.bufferedAmount > 1024 * 1024) {
        socket.close(1013);
        return;
      }
      socket.send(JSON.stringify(data));
    };
    const event = (e: PublicEvent) =>
      send({ type: "event", event: store.readerEvent(e) });
    const reset = () => send({ ...store.readerSnapshot(), demo: !!opts.demo });
    socket.on("pong", () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 30000);
    socket.on("message", (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (authorized) {
          socket.close(1008);
          return;
        }
        if (m.type !== "auth" || !equal(m.token, readerToken)) {
          socket.close(1008);
          return;
        }
        authorized = true;
        clearTimeout(timeout);
        sockets.add(socket);
        // Synchronous SQLite snapshot plus listener registration has no asynchronous gap.
        // Always refresh the current window; historical hidden bodies are never replayed.
        reset();
        store.on("event", event);
        store.on("reset", reset);
      } catch {
        socket.close(1008);
      }
    });
    socket.on("close", () => {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      sockets.delete(socket);
      store.off("event", event);
      store.off("reset", reset);
    });
  });
  app.get("/api/admin/transcripts/export", async (_req, reply) => {
    reply
      .type("application/x-ndjson; charset=utf-8")
      .header(
        "Content-Disposition",
        'attachment; filename="transcripts.jsonl"',
      );
    return reply.send(Readable.from(store.exportTranscripts()));
  });
  app.get("/api/admin/status", async () => ({
    demo: !!opts.demo,
    sessionId: store.sessionId,
    closed: store.closed(),
    retentionDays: config.retentionDays,
    connectors: supervisor.states,
    audio: {
      state: transcriber.state,
      requests: transcriber.requests,
      maxRequests: config.audio.maxRequests,
      language: config.audio.language || "auto",
      latestAt: transcriber.recent().at(-1)?.capturedAt ?? null,
      transcriptCount: transcriber.recent().length,
      latestText: transcriber.recent().at(-1)?.text ?? null,
      loggedCount: store.transcriptCount(),
      history: store.transcriptRows(),
    },
    capture: {
      state: capture.state,
      confirmed: capture.confirmed,
      lastFrameAt: capture.latest()?.capturedAt ?? null,
      dimensions: capture.dimensions,
      masks: config.capture.masks,
    },
    ai: {
      state: scheduler.state,
      manualApproval: config.ai.manualApproval,
      busy: scheduler.busy,
      pending: scheduler.pending
        ? {
            text: scheduler.pending.decision.text,
            expires: scheduler.pending.expires,
          }
        : null,
      gate: {
        enabled: config.ai.gate.enabled,
        state: opts.demo
          ? "demo_bypass"
          : config.ai.gate.enabled
            ? scheduler.gate.state
            : "disabled",
        requests: scheduler.gate.requests,
        maxRequests: config.ai.gate.maxRequests,
        filtered: scheduler.gate.filtered,
        errors: scheduler.gate.errors,
        probability: scheduler.gate.probability,
        threshold: config.ai.gate.threshold,
      },
      skips: scheduler.skips,
      rejects: scheduler.rejects,
      usage: store.usage(),
      costEstimate:
        config.ai.provider === "chatgpt_subscription" ||
        config.ai.inputUsdPerMillion === null ||
        config.ai.outputUsdPerMillion === null ||
        !config.ai.priceCheckedAt
          ? "unavailable"
          : "configured_prices",
      maxCalls: config.ai.maxCalls,
      provider: config.ai.provider,
      visualMode: config.ai.visualMode,
      model: opts.demo
        ? "mock"
        : config.ai.provider === "chatgpt_subscription"
          ? (chatgpt.active?.model ?? "not selected")
          : (process.env.OPENAI_MODEL ?? "not configured"),
    },
    chatgpt: chatgpt.status,
    setup: {
      youtube: {
        enabled: config.youtube.enabled,
        credentialsConfigured: !!(
          process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_ACCESS_TOKEN
        ),
        videoConfigured: !!config.youtube.video,
      },
      chzzk: {
        enabled: config.chzzk.enabled,
        credentialsConfigured: !!(
          process.env.CHZZK_CLIENT_ID && process.env.CHZZK_CLIENT_SECRET
        ),
      },
      soop: {
        mode: config.soop.mode,
        streamerConfigured: !!config.soop.streamerId,
      },
      audio: {
        enabled: config.audio.enabled,
        credentialsConfigured: !!process.env.GROQ_API_KEY,
        reviewed: config.policy.groqAudioReviewed,
      },
      capture: {
        enabled: config.capture.enabled,
        maskConfigured: config.capture.masks.length > 0,
      },
      ai: {
        provider: config.ai.provider,
        providerReviewed: config.policy.providerReviewed,
        connected:
          config.ai.provider === "chatgpt_subscription"
            ? !!chatgpt.active?.refreshToken
            : !!(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
        modelSelected:
          config.ai.provider === "chatgpt_subscription"
            ? !!chatgpt.active?.model
            : !!process.env.OPENAI_MODEL,
      },
    },
    policy: config.policy,
    messages: store.readerSnapshot().messages,
  }));
  app.get("/api/admin/links", async () => ({
    reader: `${publicOrigin}/reader#${readerToken}`,
    overlay: `${publicOrigin}/overlay#${readerToken}`,
  }));
  app.post("/api/admin/reader-token/rotate", async () => {
    const next = randomBytes(32).toString("hex");
    opts.persistReaderToken?.(next);
    readerToken = next;
    for (const s of sockets) s.close(1008);
    store.audit("reader_token.rotated");
    return {
      token: readerToken,
      note: opts.persistReaderToken
        ? "Saved to the local .env file."
        : "Active until server restart.",
    };
  });
  app.get("/api/admin/preview", async (req, reply) => {
    const f = capture.latest();
    if (!f) return reply.code(404).send({ error: "No frame available" });
    return reply.type("image/jpeg").send(f.bytes);
  });
  app.post("/api/admin/capture/start", async () => {
    capture.start();
    return { ok: true };
  });
  app.post("/api/admin/capture/stop", async () => {
    scheduler.stop("paused_input_stale");
    capture.stop();
    return { ok: true };
  });
  app.post("/api/admin/capture/confirm", async () => {
    capture.confirm();
    return { ok: true };
  });
  app.post("/api/admin/ai/start", async () => {
    scheduler.start();
    return { ok: true };
  });
  app.post("/api/admin/ai/stop", async () => {
    scheduler.stop();
    return { ok: true };
  });
  app.post("/api/admin/ai/approve", async () => {
    scheduler.approve();
    return { ok: true };
  });
  app.post("/api/admin/ai/reject", async () => {
    scheduler.reject();
    return { ok: true };
  });
  app.post("/api/admin/messages/:id/hide", async (req) => {
    const id = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    scheduler.pending = undefined;
    store.hide(id);
    return { ok: true };
  });
  app.post("/api/admin/reveal", async () => {
    scheduler.stop();
    store.reveal();
    return { ok: true };
  });
  app.post("/api/admin/session/close", async () => {
    scheduler.stop();
    await supervisor.stop();
    store.closeSession();
    transcriber.stop();
    return { ok: true };
  });
  app.post("/api/admin/session/new", async () => {
    scheduler.stop();
    await supervisor.stop();
    transcriber.stop();
    store.newSession();
    supervisor.start();
    transcriber.start();
    return { ok: true };
  });
  app.post("/api/admin/data/delete", async () => {
    scheduler.stop();
    await supervisor.stop();
    store.deleteAll();
    capture.stop();
    transcriber.stop();
    return { ok: true };
  });
  app.post("/api/admin/audio/start", async () => {
    if (store.closed()) throw Error("Session closed");
    transcriber.start();
    return { ok: true };
  });
  app.post("/api/admin/audio/stop", async () => {
    transcriber.stop();
    return { ok: true };
  });
  app.post("/api/admin/connectors/start", async () => {
    if (store.closed()) throw Error("Session closed");
    supervisor.start();
    return { ok: true };
  });
  app.post("/api/admin/connectors/stop", async () => {
    await supervisor.stop();
    return { ok: true };
  });
  app.post("/api/admin/chatgpt/authorize", async (req) => {
    const body = z
      .object({ clientId: z.string().optional() })
      .parse(req.body ?? {});
    return { url: chatgpt.authorizationUrl(config.port, body.clientId) };
  });
  app.get("/api/admin/chatgpt/models", async () => ({
    models: await chatgpt.models(),
  }));
  app.post("/api/admin/chatgpt/select-account", async (req) => {
    scheduler.stop();
    const body = z.object({ clientId: z.string() }).parse(req.body);
    chatgpt.select(body.clientId);
    return { ok: true };
  });
  app.post("/api/admin/chatgpt/select-model", async (req) => {
    scheduler.stop();
    const body = z.object({ slug: z.string() }).parse(req.body);
    const models = await chatgpt.models();
    chatgpt.setModel(
      body.slug,
      models.map((m) => m.slug),
    );
    return { ok: true };
  });
  app.post("/api/admin/chatgpt/disconnect", async () => {
    scheduler.stop();
    return chatgpt.disconnect();
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
      await chatgpt.callback(q);
      return reply
        .type("text/plain")
        .send(
          "ChatGPT connected. Return to the admin page and select a model.",
        );
    } catch {
      return reply
        .code(400)
        .type("text/plain")
        .send(
          "ChatGPT connection failed. Return to the admin page and try again.",
        );
    }
  });
  app.post("/api/admin/chzzk/authorize", async (req, reply) => {
    if (opts.demo)
      return reply.code(409).send({
        error:
          "Demo mode uses artificial inputs. Restart with npm start for live CHZZK.",
      });
    if (!config.chzzk.enabled)
      return reply.code(409).send({
        error: "Set chzzk.enabled: true in config.yaml, then restart.",
      });
    if (!process.env.CHZZK_CLIENT_ID || !process.env.CHZZK_CLIENT_SECRET)
      return reply.code(409).send({
        error:
          "Set CHZZK_CLIENT_ID and CHZZK_CLIENT_SECRET in .env, then restart.",
      });
    return { url: auth.authorizationUrl(config.chzzk.redirectUri) };
  });
  app.post("/api/admin/chzzk/forget", async () => {
    await supervisor.stop();
    auth.forget();
    return { ok: true };
  });
  app.get("/oauth/chzzk/callback", async (req, reply) => {
    const q = z
      .object({
        code: z.string().min(1).max(2048),
        state: z.string().length(64),
      })
      .parse(req.query);
    await auth.exchange(q.code, q.state);
    return reply
      .type("text/plain")
      .send(
        "CHZZK authorization saved. Return to the admin page and start receivers.",
      );
  });
  if (existsSync(resolve("dist/web"))) {
    await app.register(fastifyStatic, {
      root: resolve("dist/web"),
      index: false,
    });
    for (const path of ["/", "/reader", "/overlay", "/admin"])
      app.get(path, async (req, reply) => reply.sendFile("index.html"));
  }
  const retention = setInterval(() => {
    store.purge(Date.now() - config.retentionDays * 86400000);
  }, 3600000);
  retention.unref();
  store.purge(Date.now() - config.retentionDays * 86400000);
  app.addHook("onClose", async () => {
    clearInterval(retention);
    scheduler.stop();
    await supervisor.stop();
    capture.stop();
    transcriber.stop();
    for (const s of sockets) s.close();
    store.close();
  });
  if (opts.startInputs !== false && !store.closed()) {
    supervisor.start();
    capture.start();
    if (!opts.demo) transcriber.start();
  }
  return { app, store, capture, scheduler, supervisor, transcriber };
}
