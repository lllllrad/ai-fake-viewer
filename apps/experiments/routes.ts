import { reactionPipelines } from "../../packages/application/reactions/pipelines.ts";
import { Transcriber } from "../../packages/infrastructure/inputs/speech-input.ts";
import { readAudioEvent } from "../../packages/infrastructure/inputs/worker-events.ts";
import { speechInPcm } from "../../packages/domain/inputs/pcm-chunks.ts";
import type { InteractiveExperiment } from "../../packages/infrastructure/experiments/interactive.ts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  experimentStartSchema,
  experimentResumeSchema,
  experimentInputSchema,
} from "../../packages/contracts/interactive-experiment.ts";
import {
  ExperimentWorkspace,
  ExperimentError,
} from "../../packages/infrastructure/experiments/interactive.ts";
import { configSchema, type Config } from "../../packages/config.ts";
import {
  speechApiKey,
  speechProviderInfo,
} from "../../packages/infrastructure/inputs/speech-provider.ts";

export function registerExperimentRoutes(
  app: FastifyInstance,
  workspace: ExperimentWorkspace,
  audio: Pick<Config["audio"], "provider" | "language"> &
    Partial<Pick<Config["audio"], "chunkSeconds" | "maxRequests">>,
  request: typeof fetch = fetch,
) {
  const speech = speechProviderInfo(audio.provider);
  const id = (params: unknown) =>
    z.object({ id: z.string().uuid() }).parse(params).id;
  const audioConfig = configSchema.parse({ audio }).audio;
  const microphones = new WeakMap<
    InteractiveExperiment,
    { transcriber: Transcriber; seen: Set<string> }
  >();
  app.get("/api/admin/experiments", async () => ({
    activeId:
      workspace.active && !workspace.active.endedAt
        ? workspace.active.id
        : null,
    pipelineTypes: reactionPipelines.list(),
    defaultPipelineType: workspace.defaultPipelineType,
    microphoneReady: !!speechApiKey(audio.provider),
    microphone: {
      ...speech,
      language: audio.language,
      chunkSeconds: audioConfig.chunkSeconds,
      maxRequests: audioConfig.maxRequests,
    },
    sessions: workspace.list(),
  }));
  app.post("/api/admin/experiments", async (req) =>
    workspace.start(experimentStartSchema.parse(req.body)),
  );
  app.get("/api/admin/experiments/:id", async (req) => {
    const sessionId = id(req.params);
    if (workspace.active?.id === sessionId)
      await workspace.active.refreshInspection();
    return workspace.read(sessionId).session;
  });
  app.get("/api/admin/experiments/:id/trace", async (req) =>
    workspace.read(id(req.params)),
  );
  app.get("/api/admin/experiments/:id/export", async (req, reply) => {
    reply.header(
      "Content-Disposition",
      'attachment; filename="ai-viewer-test.json"',
    );
    return workspace.read(id(req.params));
  });
  app.post("/api/admin/experiments/:id/input", async (req) => {
    const input = experimentInputSchema.parse(req.body);
    const session = workspace.current(id(req.params));
    session.input(input.id, input.text, "text");
    return session.snapshot();
  });
  app.post("/api/admin/experiments/:id/resume", async (req) => {
    experimentResumeSchema.parse(req.body ?? {});
    return workspace.resume(id(req.params));
  });
  app.post("/api/admin/experiments/:id/stop", async (req) => {
    const session = workspace.current(id(req.params));
    session.stop();
    await session.refreshInspection();
    return session.snapshot();
  });
  app.delete("/api/admin/experiments/:id", async (req) => {
    workspace.delete(id(req.params));
    return { ok: true };
  });
  app.post("/api/admin/experiments/:id/audio/stop", async (req) => {
    const session = workspace.current(id(req.params));
    microphones.get(session)?.transcriber.stop();
    return { ok: true };
  });
  app.post(
    "/api/admin/experiments/:id/audio",
    { bodyLimit: 1500000 },
    async (req) => {
      const session = workspace.current(id(req.params));
      session.assertOpen();
      const input = z
        .object({
          id: z.string().uuid(),
          capturedAt: z.number().int().nonnegative(),
          pcm: z.string().min(4).max(1280000),
        })
        .strict()
        .parse(req.body);
      const frame = readAudioEvent(
        { type: "audio", capturedAt: input.capturedAt, pcm: input.pcm },
        audioConfig.chunkSeconds,
      );
      if (
        !frame ||
        frame.type !== "audio" ||
        Math.abs(Date.now() - frame.capturedAt) > 30000
      )
        throw new ExperimentError(
          "방송과 같은 길이의 최신 PCM 음성 청크가 필요합니다.",
          400,
        );
      if (!speechApiKey(audio.provider))
        throw new ExperimentError(
          `마이크 전사에는 서버의 ${speech.keyName}가 필요합니다.`,
        );
      let microphone = microphones.get(session);
      if (!microphone) {
        const transcriber = new Transcriber(audioConfig, request, (entry) => {
          session.input(entry.id, entry.text, "microphone", entry.capturedAt);
          return true;
        });
        transcriber.requests = session.microphoneCalls;
        transcriber.allowProcessing = () =>
          !session.abort.signal.aborted &&
          !session.endedAt &&
          session.coordinator.state === "running";
        transcriber.onRequest = (count) => {
          session.microphoneCalls = count;
          session.persist();
        };
        session.abort.signal.addEventListener(
          "abort",
          () => transcriber.stop(),
          { once: true },
        );
        transcriber.startPcm();
        microphone = { transcriber, seen: new Set() };
        microphones.set(session, microphone);
      }
      if (microphone.seen.has(input.id)) return session.snapshot();
      if (session.microphoneCalls >= audioConfig.maxRequests)
        throw new ExperimentError(
          `마이크 전사 ${audioConfig.maxRequests}회 한도입니다. 새 테스트를 시작해 주세요.`,
        );
      // Like the live transcriber, skip chunks arriving during an upstream request; no backlog.
      microphone.seen.add(input.id);
      if (microphone.seen.size > 1000)
        microphone.seen.delete(microphone.seen.values().next().value!);
      if (!speechInPcm(frame.pcm) || microphone.transcriber.busy)
        return session.snapshot();
      if (microphone.transcriber.state === "stopped")
        microphone.transcriber.startPcm();
      await microphone.transcriber.transcribe(frame.pcm, frame.capturedAt);
      session.assertOpen();
      if (
        [
          "auth_required",
          "quota_blocked",
          "provider_error",
          "storage_error",
        ].includes(microphone.transcriber.state)
      )
        throw new ExperimentError(
          `${speech.label} 전사에 실패했습니다. 테스트 서버의 키·한도와 저장 상태를 확인해 주세요.`,
          502,
        );
      return session.snapshot();
    },
  );
}
