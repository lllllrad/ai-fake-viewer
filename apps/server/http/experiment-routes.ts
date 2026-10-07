import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  experimentStartSchema,
  experimentInputSchema,
} from "../../../packages/contracts/interactive-experiment.ts";
import {
  ExperimentWorkspace,
  ExperimentError,
} from "../../../packages/infrastructure/experiments/interactive.ts";
import { providerRecording } from "../../../packages/infrastructure/inputs/speech-provider.ts";

export function registerExperimentRoutes(
  app: FastifyInstance,
  workspace: ExperimentWorkspace,
  request: typeof fetch = fetch,
) {
  const id = (params: unknown) =>
    z.object({ id: z.string().uuid() }).parse(params).id;
  const microphone = new Set<string>();
  app.get("/api/admin/experiments", async () => ({
    activeId:
      workspace.active && !workspace.active.endedAt
        ? workspace.active.id
        : null,
    microphoneReady: !!process.env.OPENAI_API_KEY,
    sessions: workspace.list(),
  }));
  app.post("/api/admin/experiments", async (req) =>
    workspace.start(experimentStartSchema.parse(req.body)),
  );
  app.get(
    "/api/admin/experiments/:id",
    async (req) => workspace.read(id(req.params)).session,
  );
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
  app.post("/api/admin/experiments/:id/stop", async (req) => {
    const session = workspace.current(id(req.params));
    session.stop();
    return session.snapshot();
  });
  app.delete("/api/admin/experiments/:id", async (req) => {
    workspace.delete(id(req.params));
    return { ok: true };
  });
  app.post(
    "/api/admin/experiments/:id/audio",
    { bodyLimit: 6 * 1024 * 1024 },
    async (req) => {
      const session = workspace.current(id(req.params));
      session.assertOpen();
      const input = z
        .object({
          id: z.string().uuid(),
          mime: z.enum(["audio/webm", "audio/mp4", "audio/wav"]),
          audio: z
            .string()
            .min(4)
            .max(5600000)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/),
        })
        .strict()
        .parse(req.body);
      if (session.inputs.some((entry) => entry.id === input.id))
        return session.snapshot();
      if (microphone.has(session.id))
        throw new ExperimentError(
          "음성을 전사 중입니다. 완료 후 다시 말해 주세요.",
        );
      const key = process.env.OPENAI_API_KEY;
      if (!key)
        throw new ExperimentError(
          "마이크 전사에는 OPENAI_API_KEY가 필요합니다.",
        );
      if (session.microphoneCalls >= 30)
        throw new ExperimentError(
          "마이크 전사 30회 한도입니다. 새 테스트를 시작해 주세요.",
        );
      const bytes = Buffer.from(input.audio, "base64");
      if (bytes.length > 4 * 1024 * 1024)
        throw new ExperimentError("녹음은 4 MiB 이하로 보내 주세요.", 413);
      microphone.add(session.id);
      try {
        session.microphoneCalls++;
        session.persist();
        const extension = input.mime.split("/")[1];
        const text = (
          await providerRecording({
            provider: "openai",
            bytes,
            mime: input.mime,
            filename: "recording." + extension,
            language: "ko",
            key,
            request,
            signal: AbortSignal.any([
              session.abort.signal,
              AbortSignal.timeout(30000),
            ]),
          })
        ).trim();
        if (!text)
          throw new ExperimentError(
            "인식된 말이 없습니다. 다시 녹음하거나 텍스트로 입력해 주세요.",
          );
        if (text.length > 2000)
          throw new ExperimentError(
            "인식된 말이 너무 깁니다. 짧게 나누어 말해 주세요.",
          );
        session.input(input.id, text, "microphone");
        return session.snapshot();
      } catch (error) {
        if (error instanceof ExperimentError) throw error;
        throw new ExperimentError(
          "음성 전사에 실패했습니다. OpenAI 키·한도와 연결을 확인하거나 텍스트로 입력해 주세요.",
          502,
        );
      } finally {
        microphone.delete(session.id);
      }
    },
  );
}
