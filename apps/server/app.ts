import { speechApiKey } from "../../packages/infrastructure/inputs/speech-provider.ts";
import {
  loadPipelineProfile,
  applyPipelineProfile,
  pipelineCards,
} from "../../packages/infrastructure/reactions/pipeline-profile.ts";
import { registerHttpAccess } from "./http/access.ts";
import { ServerShutdown } from "./shutdown.ts";
import { ServerMaintenance } from "./maintenance.ts";
import { initializeServer, type StartupCleanup } from "./startup.ts";
import { registerHttpErrors } from "./http/errors.ts";
import {
  AdministratorSessions,
  equal,
} from "../../packages/infrastructure/accounts/administrator-sessions.ts";
import { limitModelConcurrency } from "../../packages/application/reactions/model-concurrency.ts";
import { ParticipationAdministration } from "../../packages/application/participation/administration.ts";
import { registerParticipationRoutes } from "./http/routes/participation.ts";
import { ProfileUpdate } from "../../packages/application/participation/profile-update.ts";
import { registerProfileRoutes } from "./http/routes/profile.ts";
import { SoopBridge } from "../../packages/application/inputs/soop-bridge.ts";
import { registerSoopBridgeRoutes } from "./http/routes/soop-bridge.ts";
import { ModelAccount } from "../../packages/application/accounts/model-account.ts";
import { registerModelAccountRoutes } from "./http/routes/model-account.ts";
import { PlatformAccounts } from "../../packages/application/accounts/platform-accounts.ts";
import { registerPlatformAccountRoutes } from "./http/routes/platform-accounts.ts";
import { createModelAuthorization } from "../../packages/infrastructure/reactions/model-authorization.ts";
import { WithdrawalFollowups } from "../../packages/application/rights/withdrawal-followups.ts";
import { registerReaderStream } from "./http/reader-stream.ts";
import { projectReadiness } from "../../packages/application/status/readiness.ts";
import { registerInputRoutes } from "./http/routes/inputs.ts";
import { RuntimeStatusSource } from "../../packages/infrastructure/status/runtime.ts";
import { projectAdminStatus } from "../../packages/application/status/projection.ts";
import { BroadcastService } from "../../packages/application/broadcast/service.ts";
import { registerBroadcastRoutes } from "./http/routes/broadcast.ts";
import { YoutubeAuth } from "../../packages/infrastructure/accounts/youtube-auth.ts";
import { FixedNoticeDelivery } from "../../packages/application/participation/fixed-notice-delivery.ts";
import { Participation } from "../../packages/infrastructure/participation/runtime.ts";
import { profileIssues } from "../../packages/privacy-profile.ts";
import { createRightsService } from "../../packages/infrastructure/rights/sqlite.ts";
import { registerRightsRoutes } from "./http/routes/rights.ts";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { Config } from "../../packages/config.ts";
import { Store } from "../../packages/storage.ts";
import { Capture } from "../../packages/infrastructure/inputs/screen-input.ts";
import { Transcriber } from "../../packages/infrastructure/inputs/speech-input.ts";
import { createScheduler } from "../../packages/infrastructure/reactions/scheduler.ts";
import { mockModel } from "../../packages/infrastructure/reactions/mock-model.ts";
import { openaiModel } from "../../packages/infrastructure/reactions/responses-api.ts";
import { chatgptModel } from "../../packages/infrastructure/reactions/chatgpt-model.ts";
import { ChatgptAuth } from "../../packages/infrastructure/accounts/chatgpt-auth.ts";
import { ChzzkAuth } from "../../packages/infrastructure/accounts/chzzk-auth.ts";
import { SoopAuth } from "../../packages/infrastructure/accounts/soop-auth.ts";
import { Supervisor } from "../../packages/infrastructure/inputs/platform-supervisor.ts";
import { createBroadcastCast } from "../../packages/infrastructure/cast/runtime.ts";
export { equal } from "../../packages/infrastructure/accounts/administrator-sessions.ts";
interface AppOptions {
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
}

export function createApp(config: Config, opts: AppOptions) {
  return initializeServer((startup) => assembleApp(config, opts, startup));
}

async function assembleApp(
  config: Config,
  opts: AppOptions,
  startup: StartupCleanup,
) {
  if (
    opts.adminToken.length < 32 ||
    opts.readerToken.length < 32 ||
    opts.adminToken === opts.readerToken
  )
    throw Error("Generate independent credentials using npm run setup");
  const app = Fastify({ logger: false, bodyLimit: 65536 });
  startup.add(() => app.close());
  const pipeline = loadPipelineProfile(config.ai.pipelineProfile || undefined);
  config = applyPipelineProfile(structuredClone(config), pipeline);
  const participation = opts.demo
    ? undefined
    : new Participation(config.privacy, "");
  const store = new Store(
    opts.demo ? ":memory:" : config.database,
    participation,
  );
  startup.add(() => store.close());
  const noticeBot = participation
    ? new FixedNoticeDelivery(participation, config.soop.streamerId, "soop", {
        now: () => Date.now(),
        id: randomUUID,
      })
    : undefined;
  store.on("reset", () => noticeBot?.reset());
  const rights = createRightsService(
    opts.demo ? ":memory:" : config.privacy.rightsDatabase,
  );
  startup.add(() => rights.close());
  const followups = new WithdrawalFollowups(
    rights,
    store.rightsFollowups,
    randomUUID,
  );
  startup.add(() => followups.clear());
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
    store.transcripts.record(entry),
  );
  transcriber.transcripts = store.transcripts.recent();
  transcriber.requests = Number(store.checkpoint("audio:requests") ?? 0);
  transcriber.onRequest = (count) =>
    store.ingestion.ingest([], { key: "audio:requests", value: String(count) });
  if (!opts.demo) {
    capture.allowProcessing = inputSessionOpen;
    transcriber.allowProcessing = inputSessionOpen;
    capture.state = "stopped";
    transcriber.state = "stopped";
  }
  const clearSpeechContext = () => {
    capture.clearContext();
    transcriber.clearContext();
    store.transcripts.clear();
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
        ? chatgptModel(config.ai, chatgpt, fetch, {
            ...modelBoundary,
            prompts: pipeline.prompts,
          })
        : openaiModel(config.ai, {
            endpoint: () => config.privacy.processing.endpoint,
            model: () => config.privacy.processing.model,
            ...modelBoundary,
            prompts: pipeline.prompts,
          }),
    2,
  );
  const personas = createBroadcastCast(store, () => config.ai.description, {
    cards: pipelineCards(pipeline),
    researchBasis: `real-viewer-research-v0.1;pipeline=${pipeline.profile.id}@${pipeline.profile.revision};sha256=${pipeline.digest}`,
  });
  store.audit(
    `pipeline.loaded:${pipeline.profile.id}@${pipeline.profile.revision}:${pipeline.digest}`,
  );
  let cancelAuthoringJobs = () => {};
  const scheduler = createScheduler(
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
      end: () => store.lifetime.end(),
      createNext: () => store.lifetime.createNext(),
      erase: () => store.lifetime.erase(),
      disclose: () => {
        store.identities.reveal();
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
  startup.add(() => broadcast.shutdown());
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
  await app.register(websocket, { options: { maxPayload: 4096 } });
  const { origins, publicOrigin } = registerHttpAccess(
    app,
    {
      port: config.port,
      network: config.network,
      redirects: {
        youtube: config.youtube.redirectUri,
        chzzk: config.chzzk.redirectUri,
        soop: config.soop.redirectUri,
      },
    },
    new AdministratorSessions(opts.adminToken),
  );
  registerHttpErrors(app);
  app.get("/health", async () => ({ ok: true }));

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
  startup.add(() => cancelAuthoringJobs());
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
  startup.add(() => readers.closeAll());
  const participationAdmin = new ParticipationAdministration({
    participation,
    profile: () => config.privacy,
    rights,
    followups,
    notices: () => ({
      noticeBot: noticeBot?.state ?? "disabled",
      youtubeNoticeBot: supervisor.youtubeNotices?.state ?? "disabled",
      chzzkNoticeBot: supervisor.chzzkNotices?.state ?? "disabled",
    }),
    now: () => Date.now(),
  });
  registerParticipationRoutes(app, participationAdmin);
  const profileUpdate = new ProfileUpdate({
    current: () => config.privacy,
    reconfigure: (apply) => broadcast.reconfigureInputs(apply),
    clearSpeech: () => store.transcripts.clear(),
    install: (profile) => {
      participation?.replaceProfile(profile);
      config.privacy = profile;
    },
  });
  registerProfileRoutes(app, profileUpdate);
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
      speech: !!speechApiKey(config.audio.provider),
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
    transcripts: () => store.transcripts.export(),
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
  const modelAccount = new ModelAccount({
    authorizationUrl: (clientId) =>
      chatgpt.authorizationUrl(config.port, clientId),
    activeAccount: () => chatgpt.active?.clientId ?? null,
    models: () => chatgpt.models(),
    selectAccount: (clientId) => chatgpt.select(clientId),
    selectModel: (slug, available) => chatgpt.setModel(slug, available),
    callback: (query) => chatgpt.callback(query),
    disconnect: () => chatgpt.disconnect(),
    stopGeneration: () => scheduler.stop("chatgpt_account_changed"),
    invalidateContext: () => participation?.invalidateAll(),
  });
  registerModelAccountRoutes(app, modelAccount);
  registerPlatformAccountRoutes(app, platformAccounts);
  const soopBridge = new SoopBridge({
    settings: () => ({
      enabled: !opts.demo && config.soop.mode === "official",
      available: !!participation?.available("soop", config.soop.streamerId),
      closed: store.closed(),
      broadcastId: store.sessionId,
      streamerId: config.soop.streamerId,
      clientId: process.env.SOOP_CLIENT_ID,
      clientSecret: process.env.SOOP_CLIENT_SECRET,
      state: supervisor.states.soop.state,
    }),
    access: (clientId, secret) => soopAuth.access(clientId, secret),
    status: (state) => supervisor.status("soop", state),
    connectionLost: () => participation?.connectionLost("soop"),
    receive: (message) => supervisor.receive("soop", message),
    notices: {
      reset: () => noticeBot?.reset(),
      next: (connected) => noticeBot?.next(connected) ?? null,
      state: () => noticeBot?.state ?? "disabled",
      failed: (id) => noticeBot?.failed(id),
      echo: (author, text) => {
        noticeBot?.echo(author, text);
      },
    },
  });
  registerSoopBridgeRoutes(app, soopBridge);
  if (existsSync(resolve("dist/web"))) {
    await app.register(fastifyStatic, {
      root: resolve("dist/web"),
      index: false,
    });
    for (const path of ["/", "/reader", "/overlay", "/admin"])
      app.get(path, async (req, reply) => reply.sendFile("index.html"));
  }
  store.retention.purge(Date.now() - config.retentionDays * 86400000);
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
  const resumeAiIfRequested = () => broadcast.recoverAi();
  const maintenance = new ServerMaintenance({
    purge: () =>
      store.retention.purge(Date.now() - config.retentionDays * 86400000),
    recover: resumeAiIfRequested,
    report: (event) =>
      console.error(JSON.stringify({ type: "server_maintenance", ...event })),
  });
  startup.add(() => maintenance.stop());
  maintenance.start();
  const shutdown = new ServerShutdown({
    cancelTimers: () => maintenance.stop(),
    cancelAuthoring: () => cancelAuthoringJobs(),
    shutdownBroadcast: () => broadcast.shutdown(),
    closeReaders: () => readers.closeAll(),
    flushFollowups: () => followups.flush(),
    closeBroadcastStorage: () => store.close(),
    closeRightsStorage: () => rights.close(),
    clearFollowups: () => followups.clear(),
  });
  app.addHook("onClose", () => shutdown.close());
  startup.handoff(() => app.close());
  if (opts.startInputs !== false && !store.closed()) broadcast.startInputs();
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
