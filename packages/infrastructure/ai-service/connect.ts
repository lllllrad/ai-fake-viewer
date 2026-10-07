import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { ReactionCoordinator } from "../../application/reactions/coordinator.ts";
import { reactionPipelines } from "../../application/reactions/pipelines.ts";
import { registerReactionProgram } from "../../application/reactions/program.ts";
import {
  viewerInspectionSchema,
  type ViewerInspection,
} from "../../contracts/reaction-inspection.ts";
import { AiServiceClient, type AiServiceConnection } from "./client.ts";

export function aiServiceConnection(): AiServiceConnection {
  return {
    url: process.env.AI_SERVICE_URL ?? "http://127.0.0.1:3212",
    token:
      process.env.AI_SERVICE_TOKEN ??
      (existsSync(".local/ai-service.token")
        ? readFileSync(".local/ai-service.token", "utf8").trim()
        : ""),
  };
}
export async function connectAiService(connection = aiServiceConnection()) {
  const client = new AiServiceClient(connection);
  const metadata = z
    .object({
      protocol: z.literal(1),
      pipelines: z.array(
        z.object({
          id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
          revision: z.number().int().positive(),
          label: z.string().min(1),
          description: z.string(),
        }),
      ),
    })
    .parse(await client.json("/v1/pipelines"));
  for (const descriptor of metadata.pipelines) {
    if (
      reactionPipelines.list().some((pipeline) => pipeline.id === descriptor.id)
    )
      continue;
    registerReactionProgram(descriptor.id, () =>
      client.program(descriptor.id, descriptor.revision),
    );
    const inspection = new WeakMap<object, ViewerInspection[]>();
    reactionPipelines.register({
      ...descriptor,
      create: (...args) => new ReactionCoordinator(...args),
      draft: (options) =>
        client.program(descriptor.id, descriptor.revision).draft(options),
      inspect: (engine) =>
        (inspection.get(engine) ?? []).map((state) => ({
          ...state,
          status: engine.state === "running" ? state.status : "중지됨",
        })),
      async refreshInspection(engine) {
        const result = await client.json(
          "/v1/inspect",
          {
            pipelineType: descriptor.id,
            revision: descriptor.revision,
            context: {
              memories: engine.store.viewerMemory?.list() ?? [],
              members: engine.store.personaRuntime()?.members ?? [],
              state: engine.state,
              busy: engine.busy,
              diagnostics: engine.diagnostics,
              pending: engine.pending
                ? {
                    memberId: engine.pending.memberId,
                    decision: engine.pending.decision,
                  }
                : undefined,
            },
          },
          AbortSignal.timeout(2000),
        );
        inspection.set(
          engine,
          viewerInspectionSchema.array().parse(result.states),
        );
      },
    });
  }
}
/** Composition roots connect once; fixtures explicitly install a local test implementation. */
export async function ensureAiService() {
  if (!reactionPipelines.list().length) await connectAiService();
}
