import { apiIssues } from "../../packages/api-health.ts";
import { StaleModelContextError } from "../../packages/model-errors.ts";
import { YoutubeAuth } from "../../packages/youtube-auth.ts";
import { NoticeBot } from "../../packages/notice-bot.ts";
import { Participation } from "../../packages/participation.ts";
import {
  PrivacyActionError,
  privacyProfileSchema,
  assertProfileUpdate,
  profileIssues,
} from "../../packages/privacy-profile.ts";
import { RightsQueue, rightsIntakeSchema } from "../../packages/rights.ts";
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
import {
  mockModel,
  openaiModel,
  chatgptModel,
  type ModelInput,
  limitModelConcurrency,
} from "../../packages/model.ts";
import { ChatgptAuth } from "../../packages/chatgpt-auth.ts";
import { ChzzkAuth } from "../../packages/chzzk.ts";
import { SoopAuth } from "../../packages/soop.ts";
import { Supervisor } from "../../packages/supervisor.ts";
import { PersonaService } from "../../packages/persona/service.ts";
import { demoPersonaGenerator } from "../../packages/persona/generator.ts";
import { hash as canonicalHash } from "../../packages/persona/contracts.ts";
import { PersonaError } from "../../packages/persona/contracts.ts";
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
    chzzkTokenPath?: string;
    soopTokenPath?: string;
    youtubeTokenPath?: string;
  },
) {
  if (
    opts.adminToken.length < 32 ||
    opts.readerToken.length < 32 ||
    opts.adminToken === opts.readerToken
  )
    throw Error("Generate independent credentials using npm run setup");
  const app = Fastify({ logger: false, bodyLimit: 65536 });
  config = structuredClone(config);
  const participation = opts.demo
    ? undefined
    : new Participation(config.privacy, "");
  const store = new Store(
    opts.demo ? ":memory:" : config.database,
    participation,
  );
  const noticeBot = participation
    ? new NoticeBot(participation, config.soop.streamerId)
    : undefined;
  store.on("reset", () => noticeBot?.reset());
  const rights = new RightsQueue(
    opts.demo ? ":memory:" : config.privacy.rightsDatabase,
  );
  const withdrawalTasks = new Map<string, string>();
  const pendingRights = new Map<string, any>();
  const flushRights = () => {
    for (const [key, p] of pendingRights) {
      try {
        const task = rights.create(
          {
            platform: p.platform,
            account: p.author,
            session: p.session,
            broadcaster: p.broadcaster,
          },
          p.requestIds,
          true,
        );
        withdrawalTasks.set(key, task.id);
        pendingRights.delete(key);
      } catch {
        /* Keep minimal follow-up work visible for retry, without blocking withdrawal. */
      }
    }
  };
  if (participation)
    participation.onWithdraw = (p) => {
      const key = `${p.id}:${p.epoch}`;
      if ((p.published || p.requestIds.length) && !withdrawalTasks.has(key))
        pendingRights.set(key, { ...p, session: store.sessionId });
    };
  store.on("context_invalidated", flushRights);
  const privacyReady = () =>
    !participation ||
    (!profileIssues(config.privacy).length &&
      config.ai.provider === config.privacy.processing.provider &&
      !config.ai.gate.enabled &&
      config.privacy.processing.model ===
        (config.ai.provider === "chatgpt_subscription"
          ? chatgpt.active?.model
          : process.env.OPENAI_MODEL));

  const inputSessionOpen = () => !store.closed() && !participation?.ended;
  const capture = new Capture(config.capture, !!opts.demo);
  const transcriber = new Transcriber(config.audio, fetch, (entry) =>
    store.recordTranscript(entry),
  );
  transcriber.transcripts = store.recentTranscripts();
  transcriber.requests = Number(store.checkpoint("audio:requests") ?? 0);
  transcriber.onRequest = (count) =>
    store.ingestBatch([], { key: "audio:requests", value: String(count) });
  if (!opts.demo) {
    capture.allowProcessing = inputSessionOpen;
    transcriber.allowProcessing = inputSessionOpen;
    capture.state = "stopped";
    transcriber.state = "stopped";
  }
  const clearSpeechContext = () => {
    capture.clearContext();
    transcriber.clearContext();
    store.clearTranscripts();
  };
  store.on("context_invalidated", clearSpeechContext);
  store.on("reset", () => {
    clearSpeechContext();
    transcriber.requests = Number(store.checkpoint("audio:requests") ?? 0);
  });
  const chatgpt = new ChatgptAuth(
    opts.encryptionKey,
    opts.chatgptTokenPath ?? "data/chatgpt.tokens",
  );
  const audiences = new WeakMap<object, any[]>();
  const modelBoundary = {
    authorize: (input: ModelInput) => {
      if (
        !privacyReady() ||
        (input.frames.length > 0 && !inputSessionOpen()) ||
        ((input.transcripts?.length ?? 0) > 0 && !inputSessionOpen())
      )
        throw Error(
          "현재 운영 프로필·동의 범위에서 외부 AI 처리가 허용되지 않습니다.",
        );
      if (
        input.privacyRevision !== participation!.revision ||
        input.frames.some(
          (f) =>
            !capture.has(f.id) ||
            !capture.frames.some(
              (current) =>
                current.id === f.id &&
                current.capturedAt === f.capturedAt &&
                current.bytes.equals(f.bytes),
            ),
        ) ||
        [...(input.transcripts ?? []), ...(input.newTranscripts ?? [])].some(
          (t) =>
            !transcriber
              .recent()
              .some(
                (current) =>
                  current.id === t.id &&
                  current.text === t.text &&
                  current.capturedAt === t.capturedAt,
              ),
        ) ||
        input.messages.some((m) => !store.publicMessage(m.id))
      )
        throw new StaleModelContextError();
      if (!audiences.has(input))
        audiences.set(
          input,
          [...participation!.participants.values()]
            .filter((p) =>
              input.messages.some((m) => {
                const row = store.db
                  .prepare(
                    "SELECT a.author,m.platform,m.channel FROM messages m JOIN actors_private a ON a.id=m.actor WHERE m.id=?",
                  )
                  .get(m.id) as any;
                return (
                  row &&
                  row.author === p.author &&
                  row.platform === p.platform &&
                  row.channel === p.broadcaster
                );
              }),
            )
            .map((p) => ({ participant: p, epoch: p.epoch })),
        );
    },
    requestId: (id: string, input: ModelInput) => {
      for (const audience of audiences.get(input) ?? []) {
        const p = audience.participant;
        p.requestIds.push(id);
        p.requestIds = p.requestIds.slice(-100);
        participation?.changed();
        const key = `${p.id}:${audience.epoch + 1}`;
        const taskId = withdrawalTasks.get(key);
        if (taskId) rights.attachRequest(taskId, id);
        const pending = pendingRights.get(key);
        if (pending) pending.requestIds.push(id);
      }
    },
  };
  const personaModel = limitModelConcurrency(
    opts.demo
      ? mockModel
      : config.ai.provider === "chatgpt_subscription"
        ? chatgptModel(config.ai, chatgpt, fetch, modelBoundary)
        : openaiModel(config.ai, {
            endpoint: () => config.privacy.processing.endpoint,
            model: () => config.privacy.processing.model,
            ...modelBoundary,
          }),
    2,
  );
  const personaGenerator = opts.demo ? demoPersonaGenerator() : undefined;
  const personas = new PersonaService(
    store,
    personaModel,
    config,
    personaGenerator,
    !!opts.demo,
  );
  const scheduler = new Scheduler(
    store,
    capture,
    config,
    personaModel,
    !!opts.demo,
    () =>
      config.ai.provider === "chatgpt_subscription"
        ? !!chatgpt.active?.refreshToken && !!chatgpt.active?.model
        : !!process.env.OPENAI_API_KEY && !!process.env.OPENAI_MODEL,
    transcriber,
  );
  scheduler.preparePersonas = () => {
    const session = personas.ensureAutomaticCast();
    if (!session.armed) personas.arm(session.id, session.control_epoch);
  };
  const auth = new ChzzkAuth(
    opts.encryptionKey,
    opts.chzzkTokenPath ?? "data/chzzk.tokens",
  );
  const soopAuth = new SoopAuth(
    opts.encryptionKey,
    opts.soopTokenPath ?? "data/soop.tokens",
  );
  const youtubeAuth = new YoutubeAuth(
    opts.encryptionKey,
    opts.youtubeTokenPath ?? "data/youtube.tokens",
  );
  const supervisor = new Supervisor(
    config,
    store,
    auth,
    !!opts.demo,
    youtubeAuth,
  );
  const receiverConfigured = () =>
    (config.youtube.enabled &&
      !!(
        youtubeAuth.connected ||
        process.env.YOUTUBE_API_KEY ||
        process.env.YOUTUBE_ACCESS_TOKEN
      ) &&
      !!(config.youtube.video || config.youtube.channelId)) ||
    (config.chzzk.enabled &&
      !!process.env.CHZZK_CLIENT_ID &&
      !!process.env.CHZZK_CLIENT_SECRET &&
      !!auth.token) ||
    (config.soop.mode === "official" &&
      !!config.soop.streamerId &&
      !!soopAuth.token);
  scheduler.readyCheck = () => {
    if (opts.demo) return [];
    const missing: string[] = [];
    if (!privacyReady())
      missing.push("운영 프로필·국외 처리·선택한 AI 서비스 설정 확인");
    if (!scheduler.providerReady()) missing.push("연결된 AI 모델");
    return missing;
  };
  const readyComponents = () => {
    if (opts.demo)
      return {
        ready: true,
        checks: [
          { id: "capture", label: "데모 영상 입력", ready: true },
          { id: "audio", label: "데모 음성 입력", ready: true },
          {
            id: "receiver",
            label: "데모 채팅 입력",
            ready: true,
            optional: true,
          },
          { id: "model", label: "데모 AI 모델", ready: true },
        ],
      };
    const checks = [
      {
        id: "privacy",
        label: "운영 프로필 및 동의 범위",
        ready: privacyReady(),
      },
      {
        id: "capture",
        label: "송출 화면",
        ready: !!capture.recent().length,
        optional: true,
      },
      {
        id: "audio",
        label: "음성 인식 입력",
        ready: ["receiving", "listening"].includes(transcriber.state),
        optional: true,
      },
      {
        id: "receiver",
        label: "선택 플랫폼 채팅 수신기",
        optional: true,
        ready:
          !receiverConfigured() ||
          Object.values(supervisor.states).some((connector) =>
            [
              "connecting",
              "connected",
              "streaming",
              "polling",
              "receiving",
            ].includes(connector.state),
          ),
      },
      { id: "model", label: "AI 모델", ready: scheduler.providerReady() },
    ];
    return { ready: checks.every((c) => c.ready || c.optional), checks };
  };
  supervisor.onBroadcastEnded = () => {
    scheduler.stop("broadcast_ended");
    personas.stopActive("broadcast_ended");
    capture.stop();
    transcriber.stop();
    void supervisor.stop();
    store.closeSession();
  };
  let soopAuthorizationPendingUntil = 0;
  let readerToken = opts.readerToken;
  const youtubeCallback = new URL(config.youtube.redirectUri);
  const chzzkCallback = new URL(config.chzzk.redirectUri);
  const soopCallback = new URL(config.soop.redirectUri);
  const origins = [
    `http://127.0.0.1:${config.port}`,
    `http://localhost:${config.port}`,
    ...(config.network.bindHost === "0.0.0.0"
      ? [config.network.publicBaseUrl]
      : []),
    `${youtubeCallback.origin}`,
    `${chzzkCallback.origin}`,
    `${soopCallback.origin}`,
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
    if (e instanceof PersonaError)
      return reply.code(e.statusCode).send({
        error: { code: e.code, message: e.message, retryable: e.retryable },
      });
    reply.code(validation ? 400 : ((e as any).statusCode ?? 400)).send({
      error: validation
        ? "Invalid request fields"
        : e instanceof AiStartError || e instanceof PrivacyActionError
          ? e.message
          : req.url.startsWith("/api/admin/")
            ? "Action unavailable. Check configuration, credentials, fresh frames and session state."
            : "Request failed",
    });
  });
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api/admin/persona/") || req.method === "GET")
      return;
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 128)
      return reply.code(400).send({
        error: {
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "Provide an Idempotency-Key for this mutation.",
          retryable: false,
        },
      });
    const pathname = req.url.split("?", 1)[0];
    const params = req.params as any;
    const sessionId =
      typeof params?.id === "string" ? params.id : store.sessionId;
    const operation = `${req.method}:${pathname}`;
    const requestHash = canonicalHash({
      method: req.method,
      url: pathname,
      body: req.body ?? null,
    });
    const existing = store.db
      .prepare(
        "SELECT request_hash,result,status_code FROM persona_operator_commands WHERE session_id=? AND operation=? AND id=?",
      )
      .get(sessionId, operation, key) as any;
    if (existing) {
      if (existing.request_hash !== requestHash)
        return reply.code(409).send({
          error: {
            code: "IDEMPOTENCY_KEY_CONFLICT",
            message: "This key was already used for a different request.",
            retryable: false,
          },
        });
      if (existing.status_code === 0)
        return reply.code(409).send({
          error: {
            code: "IDEMPOTENCY_IN_PROGRESS",
            message: "The original request is still processing.",
            retryable: true,
          },
        });
      return reply.code(existing.status_code).send(JSON.parse(existing.result));
    }
    try {
      store.db
        .prepare(
          "INSERT INTO persona_operator_commands(id,session_id,operation,request_hash,result,status_code,created) VALUES(?,?,?,?, 'null',0,?)",
        )
        .run(key, sessionId, operation, requestHash, Date.now());
    } catch {
      return reply.code(409).send({
        error: {
          code: "IDEMPOTENCY_IN_PROGRESS",
          message: "The original request is still processing.",
          retryable: true,
        },
      });
    }
    (req as any).personaIdempotency = {
      key,
      sessionId,
      operation,
      requestHash,
    };
  });
  app.addHook("onSend", async (req, reply, payload) => {
    const context = (req as any).personaIdempotency;
    if (!context) return payload;
    if (reply.statusCode >= 200 && reply.statusCode < 300) {
      try {
        const value =
          typeof payload === "string"
            ? JSON.parse(payload)
            : JSON.parse(Buffer.from(payload as any).toString("utf8"));
        store.db
          .prepare(
            "UPDATE persona_operator_commands SET result=?,status_code=? WHERE id=? AND session_id=? AND operation=?",
          )
          .run(
            JSON.stringify(value),
            reply.statusCode,
            context.key,
            context.sessionId,
            context.operation,
          );
      } catch {
        store.db
          .prepare(
            "DELETE FROM persona_operator_commands WHERE id=? AND session_id=? AND operation=?",
          )
          .run(context.key, context.sessionId, context.operation);
      }
    } else
      store.db
        .prepare(
          "DELETE FROM persona_operator_commands WHERE id=? AND session_id=? AND operation=?",
        )
        .run(context.key, context.sessionId, context.operation);
    return payload;
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

  // P0 persona authoring and session control. These routes are operator-only;
  // public stream projections continue to use the existing allowlisted schema.
  app.post("/api/admin/persona/sessions", async (req) =>
    personas.createBrief(req.body),
  );
  app.get("/api/admin/persona/templates", async () => ({
    templates: personas.templates(),
  }));
  app.post("/api/admin/persona/templates", async (req) =>
    personas.createTemplate(req.body),
  );
  app.post("/api/admin/persona/sessions/:id/nickname-denylist", async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(60),
        reason: z.string().trim().min(1).max(200),
      })
      .strict()
      .parse(req.body);
    return personas.denyNickname(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.name,
      body.reason,
    );
  });
  app.get("/api/admin/persona/sessions/:id", async (req) =>
    personas.getSession(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
    ),
  );
  app.post("/api/admin/persona/sessions/:id/candidates", async (req) => {
    const body = z
      .object({ count: z.number().int().min(1).max(24).optional() })
      .strict()
      .parse(req.body ?? {});
    return personas.createCandidates(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.count,
    );
  });
  app.get("/api/admin/persona/sessions/:id/candidates", async (req) =>
    personas.listCandidates(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
    ),
  );
  app.post("/api/admin/persona/sessions/:id/clone", async (req) => {
    const body = z
      .object({ source_version_id: z.string().uuid() })
      .strict()
      .parse(req.body);
    return personas.clone(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.source_version_id,
    );
  });
  app.post("/api/admin/persona/sessions/:id/auditions", async (req) => {
    const body = z
      .object({ version_ids: z.array(z.string().uuid()).min(1).max(24) })
      .strict()
      .parse(req.body);
    return personas.audition(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.version_ids,
    );
  });
  app.get("/api/admin/persona/jobs/:id", async (req) =>
    personas.job(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
    ),
  );
  app.post("/api/admin/persona/jobs/:id/cancel", async (req) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    return personas.cancelJob(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
    );
  });
  app.post("/api/admin/persona/versions/:id/approve", async (req) => {
    const body = z
      .object({
        hash: z.string().length(64),
        evaluation_id: z.string().uuid(),
        reviewer_decision: z.unknown(),
      })
      .strict()
      .parse(req.body);
    return personas.approve(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body,
    );
  });
  app.post("/api/admin/persona/versions/:id/regenerate", async (req) => {
    const body = z
      .object({
        session_id: z.string().uuid(),
        source_hash: z.string().length(64),
        locked_paths: z.array(z.string()).max(30).default([]),
        dimensions: z.array(z.string()).max(30).default([]),
        nickname_only: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    return personas.regenerate(
      body.session_id,
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.source_hash,
      body.locked_paths,
      body.dimensions,
      body.nickname_only,
    );
  });
  app.post("/api/admin/persona/versions/:id/retire", async (req) => {
    const body = z
      .object({
        expected_hash: z.string().length(64),
        reason: z.string().trim().min(1).max(300),
      })
      .strict()
      .parse(req.body);
    return personas.retireVersion(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.expected_hash,
      body.reason,
    );
  });
  app.put("/api/admin/persona/sessions/:id/cast", async (req) => {
    const body = z
      .object({
        expected_revision: z.number().int().positive(),
        members: z.array(
          z
            .object({
              version_id: z.string().uuid(),
              display_name: z.string().trim().min(1).max(60).optional(),
            })
            .strict(),
        ),
      })
      .strict()
      .parse(req.body);
    return personas.putCast(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.expected_revision,
      body.members,
    );
  });
  app.post("/api/admin/persona/sessions/:id/freeze", async (req) => {
    const body = z
      .object({
        expected_revision: z.number().int().positive(),
        disclosure_confirmed: z.literal(true),
        policy: z.unknown().optional(),
      })
      .strict()
      .parse(req.body);
    return personas.freeze(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.expected_revision,
      body.disclosure_confirmed,
      body.policy,
    );
  });
  app.post("/api/admin/persona/sessions/:id/start", async (req) => {
    const body = z
      .object({
        expected_revision: z.number().int().positive(),
        arm_ai: z.boolean(),
      })
      .strict()
      .parse(req.body);
    const id = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    const state = personas.start(id, body.expected_revision, body.arm_ai);
    if (body.arm_ai) {
      try {
        scheduler.start();
      } catch (error) {
        scheduler.stop("preflight_failed");
        personas.stop(id, "preflight_failed");
        throw error;
      }
    } else scheduler.stop("persona_started_disarmed");
    return state;
  });
  app.post("/api/admin/persona/sessions/:id/ai/stop", async (req) => {
    const body = z
      .object({ reason: z.string().trim().min(1).max(200).optional() })
      .strict()
      .parse(req.body ?? {});
    scheduler.stop("persona_emergency_stop");
    return personas.stop(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.reason,
    );
  });
  app.post("/api/admin/persona/sessions/:id/ai/arm", async (req) => {
    const body = z
      .object({ expected_control_epoch: z.number().int().nonnegative() })
      .strict()
      .parse(req.body);
    const id = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    const state = personas.arm(id, body.expected_control_epoch);
    try {
      scheduler.start();
    } catch (error) {
      scheduler.stop("preflight_failed");
      personas.stop(id, "preflight_failed");
      throw error;
    }
    return state;
  });
  app.post("/api/admin/persona/sessions/:id/pause", async (req) => {
    const body = z
      .object({ expected_revision: z.number().int().positive() })
      .strict()
      .parse(req.body);
    scheduler.stop("persona_paused");
    return personas.pause(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.expected_revision,
    );
  });
  app.post("/api/admin/persona/sessions/:id/resume", async (req) => {
    const body = z
      .object({ expected_revision: z.number().int().positive() })
      .strict()
      .parse(req.body);
    return personas.resume(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.expected_revision,
    );
  });
  app.post("/api/admin/persona/sessions/:id/end", async (req) => {
    const body = z
      .object({ expected_revision: z.number().int().positive() })
      .strict()
      .parse(req.body);
    scheduler.stop("persona_ended");
    return personas.end(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.expected_revision,
    );
  });
  app.patch("/api/admin/persona/sessions/:id/policy", async (req) => {
    const body = z
      .object({
        expected_revision: z.number().int().positive(),
        policy: z.unknown(),
      })
      .strict()
      .parse(req.body);
    scheduler.stop("persona_policy_changed");
    const state = personas.updatePolicy(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.expected_revision,
      body.policy,
    );
    if (state.state === "live" && state.armed) {
      try {
        scheduler.start();
      } catch (error) {
        scheduler.stop("preflight_failed");
        personas.stop(state.id, "preflight_failed");
        throw error;
      }
    }
    return state;
  });
  app.patch(
    "/api/admin/persona/sessions/:id/members/:memberId",
    async (req) => {
      const body = z
        .object({
          expected_member_epoch: z.number().int().nonnegative(),
          presence: z.enum(["present", "departed"]).optional(),
          muted: z.boolean().optional(),
          attention: z.number().min(0).max(1).optional(),
          current_focus_tags: z
            .array(z.string().trim().min(1).max(60))
            .max(20)
            .optional(),
        })
        .strict()
        .parse(req.body);
      const result = personas.updateMember(
        z
          .string()
          .uuid()
          .parse((req.params as any).id),
        z
          .string()
          .uuid()
          .parse((req.params as any).memberId),
        body.expected_member_epoch,
        body,
      );
      const pending = scheduler.pending;
      if (pending && pending.memberId === (req.params as any).memberId) {
        if (pending.attemptId)
          store.finishPersonaAttempt(
            pending.attemptId,
            "canceled",
            "member_state_changed",
          );
        scheduler.pending = undefined;
      }
      return result;
    },
  );
  app.post("/api/admin/persona/sessions/:id/reveal", async (req) => {
    const body = z
      .object({ confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    return personas.reveal(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.confirmed,
    );
  });
  app.get("/api/admin/persona/sessions/:id/report", async (req) =>
    personas.report(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
    ),
  );
  app.get("/api/admin/persona/sessions/:id/replay", async (req) =>
    personas.replay(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
    ),
  );

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
    const consentNotice = (notice: {
      platform: string;
      channel: string;
      occurredAt: number;
    }) => {
      const enabled = store.consentNoticeEnabled(
        notice.platform,
        config[notice.platform as "youtube" | "chzzk" | "soop"]
          ?.consentNoticeEnabled,
      );
      if (enabled)
        send({
          type: "consent_notice",
          platform: notice.platform,
          occurredAt: notice.occurredAt,
        });
    };
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
        store.on("consent_notice", consentNotice);
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
      store.off("consent_notice", consentNotice);
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
  app.get("/api/admin/privacy", async () => {
    flushRights();
    return {
      pendingFollowups: pendingRights.size,
      noticeBot: noticeBot?.state ?? "disabled",
      youtubeNoticeBot: supervisor.youtubeNotices?.state ?? "disabled",
      chzzkNoticeBot: supervisor.chzzkNotices?.state ?? "disabled",
      profile: config.privacy,
      issues: profileIssues(config.privacy),
      participants: participation
        ? [...participation.participants.values()].map((p) => ({
            id: p.id,
            platform: p.platform,
            broadcaster: p.broadcaster,
            account: p.author,
            state: p.state,
            age: p.age,
            stage: p.stage,
            deliveredAt: p.deliveredAt,
            epoch: p.epoch,
            observed: p.observed,
            notice:
              p.state === "WAITING_CONSENT" ? participation.notice(p.id) : null,
          }))
        : [],
      rights: rights.list(),
      videos: rights.videos(),
    };
  });
  app.put("/api/admin/privacy/profile", async (req) => {
    const profile = privacyProfileSchema.parse(req.body);
    if (profile.rightsDatabase !== config.privacy.rightsDatabase)
      throw Error("권리행사 저장소 변경은 재시작이 필요합니다.");
    assertProfileUpdate(config.privacy, profile);
    scheduler.stop("privacy_profile_changed");
    capture.stop();
    transcriber.stop();
    store.clearTranscripts();
    await supervisor.stop();
    const prior = participation ? [...participation.participants.values()] : [];
    participation?.replaceProfile(profile);
    config.privacy = profile;
    for (const p of prior)
      store.revokeParticipant(p.platform, p.broadcaster, p.author);
    return { profile, issues: profileIssues(profile) };
  });
  app.post(
    "/api/admin/privacy/participants/:id/notice-delivered",
    async (req) => {
      const body = z
        .object({ delivered: z.literal(true) })
        .strict()
        .parse(req.body);
      void body;
      if (!participation) throw Error("Live 참여 상태가 없습니다.");
      if (
        ["soop", "youtube", "chzzk"].includes(
          participation.byId((req.params as any).id).platform,
        )
      )
        throw new PrivacyActionError(
          "SOOP·YouTube 안내는 자동 발송 응답으로 확인합니다.",
        );
      participation.delivered((req.params as any).id);
      return { ok: true };
    },
  );
  app.post(
    "/api/admin/privacy/participants/:id/confirm-live-command",
    async (req) => {
      const body = z
        .object({
          observationId: z.string().uuid(),
          verifiedLive: z.literal(true),
        })
        .strict()
        .parse(req.body);
      if (!participation) throw Error("Live 참여 상태가 없습니다.");
      participation.confirmLiveCommand(
        (req.params as any).id,
        body.observationId,
      );
      return { ok: true };
    },
  );
  app.post("/api/admin/privacy/participants/:id/block-age", async (req) => {
    if (!participation) throw Error("Live 참여 상태가 없습니다.");
    const p = participation.blockAge((req.params as any).id);
    store.revokeParticipant(p.platform, p.broadcaster, p.author);
    return { ok: true };
  });
  app.post("/api/admin/privacy/rights", async (req) =>
    rights.create(rightsIntakeSchema.parse(req.body)),
  );
  app.patch("/api/admin/privacy/rights/:id", async (req) =>
    rights.update((req.params as any).id, req.body),
  );
  app.delete("/api/admin/privacy/rights/:id", async (req) => {
    rights.remove((req.params as any).id);
    return { ok: true };
  });
  app.post("/api/admin/privacy/videos", async (req) => rights.video(req.body));
  app.get("/api/admin/status", async () => ({
    demo: !!opts.demo,
    generatedAt: Date.now(),
    originsRevealed: store.originsRevealed(),
    sessionId: store.sessionId,
    closed: store.closed(),
    broadcastEnded: Object.values(supervisor.states).some(
      (connector) => connector.state === "ended",
    ),
    aiDesiredRunning: store.aiDesiredRunning(),
    personas: personas.automaticSummary(),
    chatSummary: store.chatSummary(),
    privacy: {
      memoryOnly: !!opts.demo || config.database === ":memory:",
      ready: privacyReady(),
      issues: profileIssues(config.privacy),
      pendingRights: rights
        .list()
        .filter((r) => !["completed", "limited"].includes(r.state)).length,
    },
    retentionDays: config.retentionDays,
    connectors: supervisor.states,
    apiIssues: apiIssues({
      youtubeRead: supervisor.states.youtube,
      chzzkRead: supervisor.states.chzzk,
      youtubeSend: supervisor.youtubeNotices ?? { state: "disabled" },
      chzzkSend: supervisor.chzzkNotices ?? { state: "disabled" },
      audioState: transcriber.state,
      modelState: scheduler.state,
      modelIssue: scheduler.lastIssue,
    }),
    audio: {
      state: transcriber.state,
      configured: !!config.audio.url,
      credentialsReady: !!process.env.GROQ_API_KEY,
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
      configured:
        config.capture.backend === "rtmp"
          ? !!config.capture.url
          : !!config.capture.device,
      lastFrameAt: capture.latest()?.capturedAt ?? null,
      dimensions: capture.dimensions,
      lastError: capture.lastError,
      ffmpeg: config.capture.ffmpeg,
      backend: config.capture.backend,
      device: config.capture.backend === "rtmp" ? "" : config.capture.device,
      lastFrameAgeMs: capture.latest()
        ? Math.max(0, Date.now() - capture.latest()!.capturedAt)
        : null,
      framesInLastMinute: capture.frames.filter(
        (f) => f.capturedAt > Date.now() - 60000,
      ).length,
      masks: config.capture.masks,
    },
    ai: {
      state: scheduler.state,
      manualApproval: config.ai.manualApproval,
      pacing: config.ai.pacing,
      contextWindowSeconds: config.ai.contextWindowSeconds,
      busy: scheduler.busy,
      phase: scheduler.phase,
      lastIssue: scheduler.lastIssue,
      diagnostics: scheduler.diagnostics,
      reviewDraft: config.ai.reviewDraft,
      reviewCount: scheduler.reviews,
      input: {
        audioChunkSeconds: config.audio.chunkSeconds,
        audioLanguage: config.audio.language || "auto",
        contextWindowSeconds: config.ai.contextWindowSeconds,
        visualMode: config.ai.visualMode,
        last: scheduler.lastInput,
        availableTools: [],
      },
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
        suppressThreshold: config.ai.gate.threshold,
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
      readiness: readyComponents(),
      model: opts.demo
        ? "mock"
        : config.ai.provider === "chatgpt_subscription"
          ? (chatgpt.active?.model ?? "not selected")
          : (process.env.OPENAI_MODEL ?? "not configured"),
    },
    chatgpt: chatgpt.status,
    setup: {
      youtube: {
        oauthConfigured: youtubeAuth.configured,
        connected: youtubeAuth.connected,
        channelId: youtubeAuth.channelId,
        redirectUri: config.youtube.redirectUri,
        noticeState: supervisor.youtubeNotices?.state ?? "disabled",
        enabled: config.youtube.enabled,
        consentNoticeEnabled: store.consentNoticeEnabled(
          "youtube",
          config.youtube.consentNoticeEnabled,
        ),
        credentialsConfigured: !!(
          youtubeAuth.connected ||
          process.env.YOUTUBE_API_KEY ||
          process.env.YOUTUBE_ACCESS_TOKEN
        ),
        videoConfigured: !!config.youtube.video,
        channelConfigured: !!config.youtube.channelId,
      },
      chzzk: {
        enabled: config.chzzk.enabled,
        tokenConfigured: !!auth.token,
        consentNoticeEnabled: store.consentNoticeEnabled(
          "chzzk",
          config.chzzk.consentNoticeEnabled,
        ),
        credentialsConfigured: !!(
          process.env.CHZZK_CLIENT_ID && process.env.CHZZK_CLIENT_SECRET
        ),
        redirectUri: config.chzzk.redirectUri,
      },
      soop: {
        mode: config.soop.mode,
        consentNoticeEnabled: store.consentNoticeEnabled(
          "soop",
          config.soop.consentNoticeEnabled,
        ),
        streamerConfigured: !!config.soop.streamerId,
        credentialsConfigured: !!(
          process.env.SOOP_CLIENT_ID && process.env.SOOP_CLIENT_SECRET
        ),
        tokenConfigured: !!soopAuth.token,
        redirectUri: config.soop.redirectUri,
      },
      audio: {
        credentialsConfigured: !!process.env.GROQ_API_KEY,
      },
      ai: {
        provider: config.ai.provider,
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
    messages: store.readerSnapshot().messages,
  }));
  app.post("/api/admin/consent-notices/:platform", async (req, reply) => {
    const platform = z
      .enum(["youtube", "chzzk", "soop"])
      .parse((req.params as any).platform);
    const body = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    store.setConsentNoticeEnabled(platform, body.enabled);
    return { ok: true, platform, enabled: body.enabled };
  });
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
  app.post("/api/admin/ai/start", async (_req, reply) => {
    if (!opts.demo) {
      if (["stopped", "config_required"].includes(capture.state))
        capture.start();
      if (
        ["stopped", "disabled", "config_required"].includes(transcriber.state)
      )
        transcriber.start();
      if (receiverConfigured()) supervisor.start();
      if (!readyComponents().ready)
        return reply.code(409).send({
          error: "필수 입력을 모두 준비한 뒤 AI를 시작하세요.",
          readiness: readyComponents(),
        });
    }
    scheduler.start();
    return { ok: true, started: true, readiness: readyComponents() };
  });
  app.post("/api/admin/pipeline/start", async () => {
    if (store.closed()) throw Error("Session closed");
    capture.start();
    transcriber.start();
    if (receiverConfigured()) supervisor.start();
    return { ok: true, readiness: readyComponents() };
  });
  app.post("/api/admin/pipeline/stop", async () => {
    scheduler.stop();
    personas.stopActive("operator_stop");
    capture.stop();
    transcriber.stop();
    await supervisor.stop();
    return { ok: true };
  });
  app.post("/api/admin/ai/stop", async () => {
    scheduler.stop();
    personas.stopActive("operator_stop");
    capture.stop();
    transcriber.stop();
    await supervisor.stop();
    return { ok: true };
  });
  app.post("/api/admin/chat-summary/clear", async () => ({
    summary: store.clearChatSummary(),
  }));
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
    store.hide(id);
    return { ok: true };
  });
  app.post("/api/admin/reveal", async () => {
    scheduler.stop();
    personas.stopActive("identity_revealed");
    store.reveal();
    return { ok: true };
  });
  app.post("/api/admin/session/close", async () => {
    scheduler.stop();
    capture.stop();
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
    personas.cancelAll();
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
  const invalidateChatgptContext = () => {
    scheduler.stop("chatgpt_account_changed");
    const prior = participation ? [...participation.participants.values()] : [];
    participation?.invalidateAll();
    for (const p of prior)
      store.revokeParticipant(p.platform, p.broadcaster, p.author);
  };
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
    invalidateChatgptContext();
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
    invalidateChatgptContext();
    return { ok: true };
  });
  app.post("/api/admin/chatgpt/disconnect", async () => {
    scheduler.stop();
    invalidateChatgptContext();
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
      invalidateChatgptContext();
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
  app.post("/api/admin/youtube/authorize", async (_req, reply) => {
    if (opts.demo || !config.youtube.enabled || !youtubeAuth.configured)
      return reply.code(409).send({
        error:
          "config.yaml의 youtube.enabled와 .env의 YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET을 설정해 주세요.",
      });
    return { url: youtubeAuth.authorizationUrl(config.youtube.redirectUri) };
  });
  app.post("/api/admin/youtube/disconnect", async () => {
    await supervisor.stopPlatform("youtube");
    youtubeAuth.forget();
    supervisor.youtubeNotices?.reset();
    return { ok: true };
  });
  app.get("/oauth/youtube/callback", async (req, reply) => {
    try {
      if (opts.demo || !config.youtube.enabled) throw Error("disabled");
      const q = z
        .object({
          code: z.string().max(4096).optional(),
          state: z.string().min(1).max(256),
          error: z.string().optional(),
        })
        .parse(req.query);
      await youtubeAuth.callback(q.code, q.state, !!q.error);
      await supervisor.stopPlatform("youtube");
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
  app.post("/api/admin/soop/authorize", async (req, reply) => {
    if (opts.demo)
      return reply
        .code(409)
        .send({ error: "SOOP authorization is unavailable in demo mode." });
    if (config.soop.mode !== "official")
      return reply.code(409).send({
        error: "Set soop.mode: official in config.yaml, then restart.",
      });
    if (!process.env.SOOP_CLIENT_ID || !process.env.SOOP_CLIENT_SECRET)
      return reply.code(409).send({
        error:
          "Set SOOP_CLIENT_ID and SOOP_CLIENT_SECRET in .env, then restart.",
      });
    soopAuthorizationPendingUntil = Date.now() + 5 * 60 * 1000;
    return {
      url: soopAuth.authorizationUrl(process.env.SOOP_CLIENT_ID),
    };
  });
  app.get("/api/admin/soop/chat-session", async (_req, reply) => {
    if (
      opts.demo ||
      !participation?.available("soop", config.soop.streamerId) ||
      config.soop.mode !== "official" ||
      !config.soop.streamerId
    )
      return reply
        .code(409)
        .send({ error: "SOOP official mode and streamer ID are required." });
    if (!process.env.SOOP_CLIENT_ID || !process.env.SOOP_CLIENT_SECRET)
      return reply
        .code(409)
        .send({ error: "SOOP developer app credentials are not configured." });
    try {
      return {
        clientId: process.env.SOOP_CLIENT_ID,
        accessToken: await soopAuth.access(
          process.env.SOOP_CLIENT_ID,
          process.env.SOOP_CLIENT_SECRET,
        ),
        streamerId: config.soop.streamerId,
      };
    } catch {
      supervisor.status("soop", "auth_required");
      return reply
        .code(409)
        .send({ error: "Authorize SOOP from the admin page first." });
    }
  });
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
    if (body.state !== "subscribed") noticeBot?.reset();
    if (body.state !== "subscribed" && participation) {
      const prior = [...participation.participants.values()];
      participation.connectionLost("soop");
      for (const p of prior)
        if (p.state === "WITHDRAWN")
          store.revokeParticipant(p.platform, p.broadcaster, p.author);
    }
    supervisor.status("soop", body.state);
    return { ok: true };
  });
  app.post("/api/admin/soop/notices/next", async () => ({
    notice:
      noticeBot?.next(
        !opts.demo &&
          config.soop.mode === "official" &&
          !store.closed() &&
          supervisor.states.soop.state === "subscribed",
      ) ?? null,
    state: noticeBot?.state ?? "disabled",
  }));
  app.post("/api/admin/soop/notices/failed", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(req.body);
    noticeBot?.failed(id);
    return { ok: true };
  });
  app.post("/api/admin/soop/message", async (req, reply) => {
    if (opts.demo || config.soop.mode !== "official" || store.closed())
      return reply.code(409).send({ error: "SOOP chat input is unavailable." });
    if (supervisor.states.soop.state !== "subscribed")
      return reply.code(409).send({
        error: "SOOP chat is not connected to the configured broadcast.",
      });
    const body = z
      .object({
        userId: z.string().min(1).max(256),
        userNickname: z.string().trim().min(1).max(120),
        message: z.string().trim().min(1).max(4000),
      })
      .strict()
      .parse(req.body);
    if (body.userId === config.soop.streamerId) {
      noticeBot?.echo(body.userId, body.message);
      return { ok: true };
    }
    supervisor.receive("soop", {
      platform: "soop",
      channel: config.soop.streamerId,
      author: body.userId,
      name: body.userNickname,
      text: body.message,
      sourceId: null,
    });
    return { ok: true };
  });
  app.post("/api/admin/soop/forget", async () => {
    soopAuth.forget();
    supervisor.status("soop", "auth_required");
    return { ok: true };
  });
  app.get("/oauth/soop/callback", async (req, reply) => {
    const query = z
      .object({
        code: z.string().min(1).max(2048).optional(),
        error: z.string().optional(),
      })
      .parse(req.query);
    if (
      query.error ||
      !query.code ||
      soopAuthorizationPendingUntil < Date.now()
    ) {
      soopAuthorizationPendingUntil = 0;
      supervisor.status("soop", "auth_required");
      return reply
        .code(400)
        .type("text/html; charset=utf-8")
        .send(
          "<!doctype html><meta charset=utf-8><title>SOOP 연결 실패</title><h1>SOOP authorization failed</h1><p>승인 취소 또는 인증 시간이 만료됐습니다. 관리자 페이지에서 다시 시도하세요.</p>",
        );
    }
    soopAuthorizationPendingUntil = 0;
    try {
      if (!process.env.SOOP_CLIENT_ID || !process.env.SOOP_CLIENT_SECRET)
        throw Error("SOOP credentials are not configured");
      await soopAuth.exchange(
        query.code,
        process.env.SOOP_CLIENT_ID,
        process.env.SOOP_CLIENT_SECRET,
        config.soop.redirectUri,
      );
      supervisor.status("soop", "auth_ready");
      return reply
        .type("text/html; charset=utf-8")
        .send(
          "<!doctype html><meta charset=utf-8><title>SOOP 연결 완료</title><h1>SOOP authorization complete</h1><p>인증이 저장됐습니다. 관리자 페이지에서 SOOP 채팅 연결을 시작하세요.</p><p><a href='/admin'>관리자 페이지로 돌아가기</a></p>",
        );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      const message = reason.startsWith("SOOP_TOKEN_HTTP_")
        ? `토큰 발급에 실패했습니다 (HTTP ${reason.slice("SOOP_TOKEN_HTTP_".length)}). 등록된 Redirect URI와 SOOP 앱 권한을 확인하세요.`
        : "토큰 응답을 확인하지 못했습니다. 앱 등록 상태와 권한을 확인한 뒤 다시 시도하세요.";
      supervisor.status("soop", "auth_failed");
      return reply
        .code(400)
        .type("text/html; charset=utf-8")
        .send(
          `<!doctype html><meta charset=utf-8><title>SOOP 연결 실패</title><h1>SOOP authorization failed</h1><p>${message}</p>`,
        );
    }
  });
  app.post("/api/admin/chzzk/forget", async () => {
    await supervisor.stop();
    auth.forget();
    return { ok: true };
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
      if (q.error || (!q.code && q.state)) {
        if (q.state) auth.states.delete(q.state);
        throw new Error("CHZZK_USER_DENIED");
      }
      if (!q.code || !q.state) {
        if (q.state) auth.states.delete(q.state);
        throw new Error("CHZZK_CALLBACK_MISSING_FIELDS");
      }
      await auth.exchange(q.code, q.state);
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
            : reason.startsWith("CHZZK_TOKEN_HTTP_")
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
  app.addHook("onRequest", async (req, reply) => {
    if (
      !opts.demo &&
      ((config.ai.provider !== "chatgpt_subscription" &&
        /^\/api\/admin\/chatgpt(?:\/|$)/.test(req.url)) ||
        (req.method !== "GET" && req.url.startsWith("/api/admin/persona/")))
    )
      return reply.code(409).send({
        error:
          "현재 설정에서 허용하지 않는 입력 또는 제공자입니다. 선택한 AI 서비스와 운영 프로필을 확인해 주세요.",
      });
  });
  app.addHook("onClose", async () => {
    clearInterval(retention);
    clearInterval(restartRecovery);
    scheduler.stop("server_shutdown", true);
    await supervisor.stop();
    capture.stop();
    transcriber.stop();
    for (const s of sockets) s.close();
    flushRights();
    store.close();
    rights.close();
    withdrawalTasks.clear();
    pendingRights.clear();
  });
  if (opts.startInputs !== false && !store.closed()) {
    supervisor.start();
    capture.start();
    transcriber.start();
  }
  const resumeAiIfRequested = () => {
    if (store.closed() || !store.aiDesiredRunning()) return false;
    if (scheduler.state === "running") return true;
    try {
      scheduler.start();
      return true;
    } catch {
      scheduler.state = "waiting_restart_inputs";
      scheduler.phase = "waiting_restart_inputs";
      return false;
    }
  };
  const restartRecovery = setInterval(resumeAiIfRequested, 1000);
  restartRecovery.unref();
  return {
    app,
    store,
    capture,
    scheduler,
    supervisor,
    transcriber,
    personas,
    participation,
    rights,
    resumeAiIfRequested,
  };
}
