import { DisplayConversation } from "../../packages/infrastructure/conversation/display-conversation.ts";
import { DisplayChatConnections } from "../../packages/infrastructure/platforms/display-chat.ts";
import { registerDisplayChatRoutes } from "./http/routes/display-chat.ts";
import { applyInputMode } from "../../packages/infrastructure/inputs/input-mode.ts";
import { ensureAiService } from "../../packages/infrastructure/ai-service/connect.ts";
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
import { ModelAccount } from "../../packages/application/accounts/model-account.ts";
import { registerModelAccountRoutes } from "./http/routes/model-account.ts";
import { createModelAuthorization } from "../../packages/infrastructure/reactions/model-authorization.ts";
import { registerReaderStream } from "./http/reader-stream.ts";
import { projectReadiness } from "../../packages/application/status/readiness.ts";
import { registerInputRoutes } from "./http/routes/inputs.ts";
import { RuntimeStatusSource } from "../../packages/infrastructure/status/runtime.ts";
import { projectAdminStatus } from "../../packages/application/status/projection.ts";
import { BroadcastService } from "../../packages/application/broadcast/service.ts";
import { registerBroadcastRoutes } from "./http/routes/broadcast.ts";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { randomBytes } from "node:crypto";
import { resolve, dirname } from "node:path";
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
  displayChatDirectory?: string;
  persistDisplayChat?: (settings: Config["displayChat"]) => void;
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
  await ensureAiService();
  const app = Fastify({ logger: false, bodyLimit: 65536 });
  startup.add(() => app.close());
  const pipeline = loadPipelineProfile(config.ai.pipelineProfile || undefined);
  config = applyPipelineProfile(structuredClone(config), pipeline);
  config = applyInputMode(config, !!opts.demo);
  const store = new Store(opts.demo ? ":memory:" : config.database, !opts.demo);
  startup.add(() => store.close());
  const display = new DisplayConversation(store);
  startup.add(() => display.close());
  const displayChat = new DisplayChatConnections(
    config.displayChat,
    opts.encryptionKey,
    {
      session: () => store.sessionId,
      closed: () => store.closed(),
      receive: (message) => display.receive(message),
      port: config.port,
      demo: !!opts.demo,
      persist: opts.demo ? undefined : opts.persistDisplayChat,
      directory:
        opts.displayChatDirectory ??
        (!opts.demo && config.database !== ":memory:"
          ? dirname(config.database)
          : undefined),
    },
  );
  startup.add(() => displayChat.close());
  let displaySession = store.sessionId;
  const syncDisplay = () => {
    if (store.closed() || displaySession !== store.sessionId) {
      displaySession = store.sessionId;
      const session = displaySession;
      void displayChat.stopAll().then(() => {
        if (!store.closed() && session === store.sessionId)
          displayChat.startAll();
      });
    }
  };
  store.on("event", syncDisplay);
  store.on("reset", syncDisplay);
  const inputSessionOpen = () => !store.closed();
  const capture = new Capture(
    { ...config.capture, url: config.input.streamUrl },
    !!opts.demo,
  );
  const transcriber = new Transcriber(
    { ...config.audio, url: config.input.streamUrl },
    fetch,
    (entry) => store.transcripts.record(entry),
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
            endpoint: () => "https://api.openai.com/v1",
            model: () => process.env.OPENAI_MODEL!,
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
  const readyComponents = () =>
    projectReadiness({
      demo: !!opts.demo,
      streamConfigured: !!config.input.streamUrl,
      modelReady: scheduler.providerReady(),
      screenRecent: !!capture.recent().length,
      speechState: transcriber.state,
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
      start: () => {
        capture.start();
        transcriber.start();
      },
      prepareForAi: () => {
        if (opts.demo) return;
        if (["stopped", "config_required"].includes(capture.state))
          capture.start();
        if (
          ["stopped", "disabled", "config_required"].includes(transcriber.state)
        )
          transcriber.start();
      },
      stopScreen: () => capture.stop(),
      stopSpeech: () => transcriber.stop(),
    },
  });
  startup.add(() => broadcast.shutdown());
  let readerToken = opts.readerToken;
  await app.register(websocket, { options: { maxPayload: 4096 } });
  const { origins, publicOrigin } = registerHttpAccess(
    app,
    {
      port: config.port,
      network: config.network,
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
  const readers = registerReaderStream(app, display, {
    origins,
    demo: !!opts.demo,
    authenticate: (token) => equal(token, readerToken),
  });
  startup.add(() => readers.closeAll());
  const statusSource = new RuntimeStatusSource({
    demo: !!opts.demo,
    config,
    store,
    capture,
    transcriber,
    scheduler,
    personas,
    chatgpt,
    readyComponents,
    displayMessages: () => display.snapshot().messages,
    now: () => Date.now(),
    credentials: () => ({
      speech: !!speechApiKey(config.audio.provider),
      apiKey: !!process.env.OPENAI_API_KEY,
      apiModel: process.env.OPENAI_MODEL,
    }),
  });
  app.get("/api/admin/status", async () =>
    projectAdminStatus(statusSource.read()),
  );
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
  registerDisplayChatRoutes(app, displayChat);
  registerInputRoutes(app, broadcast, {
    preview: () => capture.latest(),
    transcripts: () => store.transcripts.export(),
  });
  registerBroadcastRoutes(app, broadcast, readyComponents);
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
    if (!display.hide(id)) store.hide(id);
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
    invalidateContext: () => store.emit("context_invalidated"),
  });
  registerModelAccountRoutes(app, modelAccount);
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
          "현재 설정에서 허용하지 않는 입력 또는 제공자입니다. 선택한 AI 서비스를 확인해 주세요.",
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
    shutdownBroadcast: async () => {
      await Promise.all([broadcast.shutdown(), displayChat.close()]);
    },
    closeReaders: () => readers.closeAll(),
    closeBroadcastStorage: () => {
      display.close();
      store.close();
    },
  });
  app.addHook("onClose", () => shutdown.close());
  startup.handoff(() => app.close());
  const startInputs = () => {
    if (store.closed()) return;
    broadcast.startInputs();
    displayChat.startAll();
  };
  if (opts.startInputs !== false) startInputs();
  return {
    app,
    startInputs,
    broadcast,
    store,
    display,
    displayChat,
    capture,
    scheduler,
    transcriber,
    personas,
    resumeAiIfRequested,
  };
}
