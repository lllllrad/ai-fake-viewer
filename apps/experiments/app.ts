import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { ExperimentWorkspace } from "../../packages/infrastructure/experiments/interactive.ts";
import { experimentModel } from "../../packages/infrastructure/experiments/models.ts";
import { loadPipelineProfile } from "../../packages/infrastructure/reactions/pipeline-profile.ts";
import { ChatgptAuth } from "../../packages/infrastructure/accounts/chatgpt-auth.ts";
import { AdministratorSessions } from "../../packages/infrastructure/accounts/administrator-sessions.ts";
import { ModelAccount } from "../../packages/application/accounts/model-account.ts";
import { registerModelAccountRoutes } from "../server/http/routes/model-account.ts";
import { registerHttpAccess } from "../server/http/access.ts";
import { initializeServer } from "../server/startup.ts";
import { registerExperimentRoutes } from "./routes.ts";
import { registerExperimentErrors } from "./errors.ts";
import {
  experimentSettingsSchema,
  type ExperimentSettings,
} from "./settings.ts";
export function createExperimentApp(
  settings: ExperimentSettings,
  options: {
    directory: string;
    adminToken: string;
    encryptionKey: string;
    speechRequest?: typeof fetch;
  },
) {
  return initializeServer(async (startup) => {
    settings = experimentSettingsSchema.parse(settings);
    if (options.adminToken.length < 32)
      throw Error("Test administrator credential required");
    const app = Fastify({ logger: false, bodyLimit: 65536 });
    startup.add(() => app.close());
    const auth = new ChatgptAuth(
      options.encryptionKey,
      join(options.directory, "chatgpt.tokens"),
    );
    const pipeline = loadPipelineProfile(settings.pipelineProfile || undefined);
    const experiments = new ExperimentWorkspace(
      join(options.directory, "interactive"),
      pipeline,
      (provider) => experimentModel(provider, pipeline, auth, true),
    );
    startup.add(() => experiments.close());
    app.addHook("onClose", async () => experiments.close());
    const origin = `http://127.0.0.1:${settings.port}`;
    registerHttpAccess(
      app,
      {
        port: settings.port,
        network: { bindHost: "127.0.0.1", publicBaseUrl: "" },
        redirects: { youtube: origin, chzzk: origin, soop: origin },
      },
      new AdministratorSessions(
        options.adminToken,
        Date.now,
        "mixed_chat_experiments",
      ),
    );
    registerExperimentErrors(app);
    app.get("/health", async () => ({ ok: true, service: "experiments" }));
    app.get("/api/admin/session", async () => ({ chatgpt: auth.status }));
    registerExperimentRoutes(
      app,
      experiments,
      settings.audio,
      options.speechRequest,
    );
    registerModelAccountRoutes(
      app,
      new ModelAccount({
        authorizationUrl: (clientId) =>
          auth.authorizationUrl(settings.port, clientId),
        activeAccount: () => auth.active?.clientId ?? null,
        models: () => auth.models(),
        selectAccount: (clientId) => auth.select(clientId),
        selectModel: (slug, available) => auth.setModel(slug, available),
        callback: (query) => auth.callback(query),
        disconnect: () => auth.disconnect(),
        stopGeneration: () =>
          experiments.active?.stop("chatgpt_account_changed"),
        invalidateContext() {},
      }),
      { port: settings.port },
    );
    if (existsSync(resolve("dist/experiments"))) {
      await app.register(fastifyStatic, {
        root: resolve("dist/experiments"),
        index: false,
      });
      for (const path of ["/", "/admin"])
        app.get(path, async (_request, reply) => reply.sendFile("index.html"));
    }
    return { app, experiments };
  });
}
