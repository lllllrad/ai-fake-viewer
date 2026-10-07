import Fastify from "fastify";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { servicePipelines, type ServicePipeline } from "./programs.ts";
import {
  encodeWire,
  decodeWire,
} from "../../packages/infrastructure/ai-service/wire.ts";
import type {
  ModelInput,
  ModelResult,
} from "../../packages/application/reactions/model-port.ts";
import type { DraftOutcome } from "../../packages/application/reactions/program.ts";

export function createAiService(
  token: string,
  pipelines: readonly ServicePipeline[] = servicePipelines,
) {
  if (token.length < 32)
    throw Error("AI service token must contain at least 32 characters");
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 * 1024 });
  const registry = new Map(pipelines.map((p) => [p.id, p]));
  if (registry.size !== pipelines.length)
    throw Error("Duplicate AI service pipeline");
  type Packet =
    | { kind: "model"; step: number; input: ModelInput<Buffer> }
    | { kind: "done"; outcome: DraftOutcome<ModelInput<Buffer>> }
    | { kind: "error" };
  type Job = {
    abort: AbortController;
    at: number;
    step: number;
    phase: string;
    traces: Array<{ event: string; details: Record<string, string | number> }>;
    frames: ModelInput<Buffer>["frames"];
    valid: Set<string>;
    packet?: Packet;
    ready?: () => void;
    resolve?: (result: ModelResult) => void;
    reject?: (error: Error) => void;
    claimed: boolean;
  };
  const jobs = new Map<string, Job>();
  const remove = (id: string) => {
    const job = jobs.get(id);
    if (!job) return;
    job.abort.abort();
    job.packet = { kind: "done", outcome: { kind: "canceled" } };
    job.ready?.();
    job.ready = undefined;
    job.reject?.(Error("canceled"));
    jobs.delete(id);
  };
  const timer = setInterval(() => {
    for (const [id, job] of jobs) if (Date.now() - job.at > 90000) remove(id);
  }, 10000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    for (const id of jobs.keys()) remove(id);
  });
  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    const supplied = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return reply.code(401).send({ error: "Unauthorized" });
  });
  app.setErrorHandler((error, _req, reply) =>
    reply
      .code(error instanceof z.ZodError ? 400 : 502)
      .send({ error: "AI service request failed" }),
  );
  const pipeline = (id: unknown, revision?: unknown) => {
    const entry = registry.get(z.string().parse(id));
    if (!entry || (revision !== undefined && revision !== entry.revision))
      throw Error("Unknown AI type or revision");
    return entry;
  };
  const refresh = (job: Job, body: any) => {
    job.frames = Array.isArray(body.frames) ? body.frames : [];
    job.valid = new Set(
      z.array(z.string()).max(100).parse(body.validTranscripts),
    );
  };
  const read = async (id: string, job: Job) => {
    if (!job.packet)
      await new Promise<void>((resolve) => {
        job.ready = resolve;
      });
    const packet = job.packet!;
    const response = encodeWire({
      id,
      ...packet,
      phase: job.phase,
      traces: job.traces.splice(0),
    });
    if (packet.kind !== "model") jobs.delete(id);
    return response;
  };
  app.get("/health", async () => ({
    ok: true,
    service: "viewer-ai",
    protocol: 1,
  }));
  app.get("/v1/pipelines", async () => ({
    protocol: 1,
    pipelines: pipelines.map(({ id, revision, label, description }) => ({
      id,
      revision,
      label,
      description,
    })),
  }));
  app.post("/v1/inspect", async (req) => {
    const body = decodeWire(req.body);
    return {
      states:
        pipeline(body.pipelineType, body.revision).inspect?.(body.context) ??
        [],
    };
  });
  app.post("/v1/select", async (req) => {
    const body = decodeWire(req.body);
    const entry = pipeline(body.pipelineType, body.revision);
    if (
      !Array.isArray(body.input?.members) ||
      body.input.members.length > 100 ||
      !Array.isArray(body.input.randomValues)
    )
      throw Error("Invalid selection");
    return encodeWire({
      selected:
        (await entry.select(body.input, AbortSignal.timeout(10000))) ?? null,
    });
  });
  app.post("/v1/runs", async (req, reply) => {
    if (jobs.size >= 100)
      return reply.code(429).send({ error: "AI service capacity reached" });
    const body = decodeWire(req.body);
    const entry = pipeline(body.pipelineType, body.revision);
    if (
      !body.input?.persona ||
      !Array.isArray(body.input.messages) ||
      !Array.isArray(body.input.frames)
    )
      throw Error("Invalid draft input");
    const id = randomUUID();
    const job: Job = {
      abort: new AbortController(),
      at: Date.now(),
      step: 0,
      phase: "starting",
      traces: [],
      frames: [],
      valid: new Set(),
      claimed: false,
    };
    refresh(job, body);
    jobs.set(id, job);
    reply.raw.once("close", () => {
      if (!reply.raw.writableEnded) remove(id);
    });
    const emit = (packet: Packet) => {
      job.packet = packet;
      job.ready?.();
      job.ready = undefined;
    };
    void entry
      .draft<Buffer>({
        input: body.input,
        signal: job.abort.signal,
        isCurrent: () => !job.abort.signal.aborted,
        inspectAllowed: body.inspectAllowed === true,
        review: body.review === true,
        latestFrames: () => job.frames,
        hasTranscript: (id) => job.valid.has(id),
        active() {},
        phase: (phase) => {
          job.phase = phase;
        },
        trace: (event, details) => {
          job.traces.push({ event, details });
        },
        model: (input) =>
          new Promise<ModelResult>((resolve, reject) => {
            job.resolve = resolve;
            job.reject = reject;
            job.claimed = false;
            emit({ kind: "model", step: ++job.step, input });
          }),
      })
      .then(
        (outcome) => emit({ kind: "done", outcome }),
        () => emit({ kind: "error" }),
      );
    return read(id, job);
  });
  app.post("/v1/runs/:id/continue", async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = jobs.get(id);
    const body = decodeWire(req.body);
    if (
      !job ||
      job.packet?.kind !== "model" ||
      job.claimed ||
      body.step !== job.step
    )
      return reply.code(409).send({ error: "Stale AI service step" });
    refresh(job, body);
    job.claimed = true;
    job.at = Date.now();
    reply.raw.once("close", () => {
      if (!reply.raw.writableEnded) remove(id);
    });
    job.packet = undefined;
    job.resolve?.(body.result);
    return read(id, job);
  });
  app.delete("/v1/runs/:id", async (req) => {
    remove((req.params as { id: string }).id);
    return { ok: true };
  });
  return app;
}
