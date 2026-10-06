import { PlatformAccounts } from "../../packages/application/accounts/platform-accounts.ts";
import { registerPlatformAccountRoutes } from "./http/routes/platform-accounts.ts";
import { createModelAuthorization } from "../../packages/infrastructure/reactions/model-authorization.ts";
import { WithdrawalFollowups } from "../../packages/application/rights/withdrawal-followups.ts";
import { registerReaderStream } from "./http/reader-stream.ts";
import { projectReadiness } from "../../packages/application/status/readiness.ts";
import { registerInputRoutes } from "./http/routes/inputs.ts";
import { RuntimeStatusSource } from "../../packages/infrastructure/status/runtime.ts";
import { projectAdminStatus } from "../../packages/application/status/projection.ts";
import {
  BroadcastService,
  BroadcastCommandError,
} from "../../packages/application/broadcast/service.ts";
import { registerBroadcastRoutes } from "./http/routes/broadcast.ts";
import { YoutubeAuth } from "../../packages/youtube-auth.ts";
import { NoticeBot } from "../../packages/notice-bot.ts";
import { Participation } from "../../packages/infrastructure/participation/runtime.ts";
import {
  PrivacyActionError,
  privacyProfileSchema,
  assertProfileUpdate,
  profileIssues,
} from "../../packages/privacy-profile.ts";
import { createRightsService } from "../../packages/infrastructure/rights/sqlite.ts";
import { participationStatusSchema } from "../../packages/contracts/participation.ts";
import { registerRightsRoutes } from "./http/routes/rights.ts";
import { RightsActionError } from "../../packages/application/rights/service.ts";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import {
  timingSafeEqual,
  randomBytes,
  createHmac,
  randomUUID,
} from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { Config } from "../../packages/config.ts";
import { Store } from "../../packages/storage.ts";
import { Capture } from "../../packages/capture.ts";
import { Transcriber } from "../../packages/transcription.ts";
import { AiStartError, Scheduler } from "../../packages/scheduler.ts";
import {
  mockModel,
  openaiModel,
  chatgptModel,
  limitModelConcurrency,
} from "../../packages/model.ts";
import { ChatgptAuth } from "../../packages/chatgpt-auth.ts";
import { ChzzkAuth } from "../../packages/chzzk.ts";
import { SoopAuth } from "../../packages/soop.ts";
import { Supervisor } from "../../packages/supervisor.ts";
import { createBroadcastCast } from "../../packages/infrastructure/cast/runtime.ts";
import { PersonaError } from "../../packages/application/cast/errors.ts";
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
  const rights = createRightsService(
    opts.demo ? ":memory:" : config.privacy.rightsDatabase,
  );
  const followups = new WithdrawalFollowups(
    rights,
    store.rightsFollowups,
    randomUUID,
  );
  followups.flush();
  store.on("context_invalidated", () => followups.flush());
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
  const modelBoundary = createModelAuthorization({
    store,
    capture,
    transcriber,
    participation,
    followups,
    profileReady: privacyReady,
    sessionOpen: inputSessionOpen,
  });
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
  const personas = createBroadcastCast(store, () => config.ai.description);
  let cancelAuthoringJobs = () => {};
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
    personas.prepare();
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
  const readyComponents = () =>
    projectReadiness({
      demo: !!opts.demo,
      profileReady: privacyReady(),
      modelReady: scheduler.providerReady(),
      screenRecent: !!capture.recent().length,
      speechState: transcriber.state,
      receiverConfigured: !!receiverConfigured(),
      receiverStates: Object.values(supervisor.states).map(
        (connector) => connector.state,
      ),
    });
  scheduler.readyCheck = () =>
    readyComponents()
      .checks.filter((check) => !check.optional && !check.ready)
      .map((check) => check.label);
  const broadcast = new BroadcastService({
    repository: {
      closed: () => store.closed(),
      aiRequested: () => store.aiDesiredRunning(),
      end: () => store.closeSession(),
      createNext: () => store.newSession(),
      erase: () => store.deleteAll(),
      disclose: () => {
        store.reveal();
      },
    },
    ai: {
      running: () => scheduler.state === "running",
      start: () => scheduler.start(),
      stop: (reason, preserve) => scheduler.stop(reason, preserve),
      waitForRecovery: () => {
        scheduler.state = "waiting_restart_inputs";
        scheduler.phase = "waiting_restart_inputs";
      },
    },
    cast: {
      disarm: (reason) => {
        personas.stopActive(reason);
      },
      cancelJobs: () => cancelAuthoringJobs(),
    },
    inputs: {
      startScreen: () => capture.start(),
      startSpeech: () => transcriber.start(),
      startChat: () => supervisor.start(),
      start: () => {
        capture.start();
        transcriber.start();
        if (opts.demo || receiverConfigured()) supervisor.start();
      },
      prepareForAi: () => {
        if (opts.demo) return;
        if (["stopped", "config_required"].includes(capture.state))
          capture.start();
        if (
          ["stopped", "disabled", "config_required"].includes(transcriber.state)
        )
          transcriber.start();
        if (receiverConfigured()) supervisor.start();
      },
      stopScreen: () => capture.stop(),
      stopSpeech: () => transcriber.stop(),
      stopChat: () => supervisor.stop(),
    },
  });
  supervisor.onBroadcastEnded = () => {
    void broadcast.endBroadcast().catch(() => {
      console.error(
        "Broadcast ended; an input adapter failed to stop cleanly.",
      );
    });
  };
  const platformAccounts = new PlatformAccounts({
    settings: () => ({
      demo: !!opts.demo,
      youtube: { ...config.youtube, configured: youtubeAuth.configured },
      chzzk: {
        ...config.chzzk,
        configured:
          !!process.env.CHZZK_CLIENT_ID && !!process.env.CHZZK_CLIENT_SECRET,
      },
      soop: {
        enabled: config.soop.mode === "official",
        redirectUri: config.soop.redirectUri,
        clientId: process.env.SOOP_CLIENT_ID,
        clientSecret: process.env.SOOP_CLIENT_SECRET,
      },
    }),
    youtube: youtubeAuth,
    chzzk: {
      authorizationUrl: (redirect) => auth.authorizationUrl(redirect),
      cancel: (state) => {
        auth.states.delete(state);
      },
      exchange: (code, state) => auth.exchange(code, state),
      forget: () => auth.forget(),
    },
    soop: soopAuth,
    stop: (platform) => supervisor.stopPlatform(platform),
    resetYoutubeNotices: () => supervisor.youtubeNotices?.reset(),
    soopStatus: (state) => supervisor.status("soop", state),
    now: () => Date.now(),
  });
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
        : e instanceof AiStartError ||
            e instanceof PrivacyActionError ||
            e instanceof RightsActionError ||
            e instanceof BroadcastCommandError
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

  if (opts.demo) {
    const { registerDemoPersonaRoutes } =
      await import("./demo/persona-routes.ts");
    cancelAuthoringJobs = registerDemoPersonaRoutes(
      app,
      store,
      scheduler,
      config,
      personaModel,
    );
  }
  const readers = registerReaderStream(
    app,
    {
      snapshot: () => store.readerSnapshot(),
      event: (event) => store.readerEvent(event),
      noticeEnabled: (notice) =>
        store.consentNoticeEnabled(
          notice.platform,
          config[notice.platform as "youtube" | "chzzk" | "soop"]
            ?.consentNoticeEnabled,
        ),
      subscribe: (listeners) => {
        store.on("event", listeners.event);
        store.on("reset", listeners.reset);
        store.on("consent_notice", listeners.notice);
        return () => {
          store.off("event", listeners.event);
          store.off("reset", listeners.reset);
          store.off("consent_notice", listeners.notice);
        };
      },
    },
    {
      origins,
      demo: !!opts.demo,
      authenticate: (token) => equal(token, readerToken),
    },
  );
  app.get("/api/admin/privacy", async () => {
    followups.flush();
    return participationStatusSchema.parse({
      generatedAt: Date.now(),
      pendingFollowups: followups.pendingCount,
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
    });
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
    participation?.replaceProfile(profile);
    config.privacy = profile;
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
    participation.blockAge((req.params as any).id);
    return { ok: true };
  });
  registerRightsRoutes(app, rights);
  const statusSource = new RuntimeStatusSource({
    demo: !!opts.demo,
    config,
    store,
    capture,
    transcriber,
    scheduler,
    supervisor,
    personas,
    rights,
    chatgpt,
    youtubeAuth,
    auth,
    soopAuth,
    privacyReady,
    readyComponents,
    now: () => Date.now(),
    credentials: () => ({
      speech: !!process.env.GROQ_API_KEY,
      youtube: !!(
        process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_ACCESS_TOKEN
      ),
      chzzk: !!(process.env.CHZZK_CLIENT_ID && process.env.CHZZK_CLIENT_SECRET),
      soop: !!(process.env.SOOP_CLIENT_ID && process.env.SOOP_CLIENT_SECRET),
      apiKey: !!process.env.OPENAI_API_KEY,
      apiModel: process.env.OPENAI_MODEL,
    }),
  });
  app.get("/api/admin/status", async () =>
    projectAdminStatus(statusSource.read()),
  );
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
    readers.closeAll(1008);
    store.audit("reader_token.rotated");
    return {
      token: readerToken,
      note: opts.persistReaderToken
        ? "Saved to the local .env file."
        : "Active until server restart.",
    };
  });
  registerInputRoutes(app, broadcast, {
    preview: () => capture.latest(),
    transcripts: () => store.exportTranscripts(),
  });
  registerBroadcastRoutes(app, broadcast, readyComponents);
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
  const invalidateChatgptContext = () => {
    scheduler.stop("chatgpt_account_changed");
    participation?.invalidateAll();
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
  registerPlatformAccountRoutes(app, platformAccounts);
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
      participation.connectionLost("soop");
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
    cancelAuthoringJobs();
    clearInterval(retention);
    clearInterval(restartRecovery);
    try {
      await broadcast.shutdown();
    } finally {
      readers.closeAll();
      followups.flush();
      store.close();
      rights.close();
      followups.clear();
    }
  });
  if (opts.startInputs !== false && !store.closed()) broadcast.startInputs();
  const resumeAiIfRequested = () => broadcast.recoverAi();
  const restartRecovery = setInterval(resumeAiIfRequested, 1000);
  restartRecovery.unref();
  return {
    app,
    broadcast,
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
