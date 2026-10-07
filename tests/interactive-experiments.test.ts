import { experimentTraceSchema } from "../packages/contracts/interactive-experiment.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { ExperimentWorkspace } from "../packages/infrastructure/experiments/interactive.ts";
import { loadPipelineProfile } from "../packages/infrastructure/reactions/pipeline-profile.ts";
import { fixtureModel } from "../packages/infrastructure/experiments/models.ts";
import { registerExperimentRoutes } from "../apps/experiments/routes.ts";
import { registerExperimentErrors } from "../apps/experiments/errors.ts";
import type { Model } from "../packages/application/reactions/model-port.ts";
import { createExperimentApp } from "../apps/experiments/app.ts";
import { experimentSettingsSchema } from "../apps/experiments/settings.ts";

const until = async (condition: () => boolean) => {
  const deadline = Date.now() + 4000;
  while (!condition()) {
    if (Date.now() > deadline) throw Error("Timed out waiting for experiment");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
function workspace(model: Model<Buffer> = fixtureModel) {
  const directory = mkdtempSync(join(tmpdir(), "interactive-experiment-"));
  const pipeline = loadPipelineProfile();
  const service = new ExperimentWorkspace(
    directory,
    pipeline,
    () => ({ model, name: "fixture" }),
    () => 0,
  );
  return {
    service,
    directory,
    cleanup: () => {
      service.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("interactive speech drives the production cast, records review, and survives restart as history", async () => {
  const { service, directory, cleanup } = workspace();
  try {
    const session = service.start({
      topic: "퍼즐 게임",
      provider: "fixture",
      maxCalls: 6,
    });
    assert.equal(session.personas.length, 6);
    assert.throws(
      () => service.start({ topic: "other", provider: "fixture", maxCalls: 6 }),
      /먼저 종료/,
    );
    const inputId = randomUUID();
    service
      .current(session.id)
      .input(inputId, "퍼즐 게임 처음 하는데 어떤가요?", "text");
    service
      .current(session.id)
      .input(inputId, "퍼즐 게임 처음 하는데 어떤가요?", "text");
    await until(() => service.read(session.id).session.messages.length === 1);
    const trace = service.read(session.id);
    assert.equal(trace.session.inputs.length, 1);
    assert.equal(trace.session.calls, 2);
    assert.equal(trace.calls.length, 2);
    assert.equal(trace.session.viewerStates.length, 6);
    const memberId = trace.calls[0].memberId;
    assert(memberId);
    assert.equal(trace.calls[1].memberId, memberId);
    assert.equal(trace.calls[0].stage, "generation");
    assert.equal(trace.calls[1].stage, "review");
    assert.equal(trace.calls[0].model, "fixture");
    assert.equal(
      trace.calls[0].personaName,
      trace.session.personas.find((persona) => persona.id === memberId)!
        .displayName,
    );
    const inspection = trace.session.viewerStates.find(
      (state) => state.memberId === memberId,
    )!;
    assert.equal(
      inspection.sections.find((section) => section.label === "최근 모델 판단")
        ?.value,
      "발화 선택",
    );
    const events = inspection.sections.find(
      (section) => section.label === "최근 파이프라인 사건",
    )!.value as Array<{ event: string; details: { memberId: string } }>;
    assert(events.some((event) => event.event === "published"));
    assert(events.every((event) => event.details.memberId === memberId));
    const legacy = { ...trace.session };
    delete (legacy as Partial<typeof legacy>).viewerStates;
    assert.deepEqual(
      experimentTraceSchema.parse({ ...trace, session: legacy }).session
        .viewerStates,
      [],
    );

    assert.ok(
      trace.diagnostics.some((entry: any) => entry.event === "published"),
    );
    assert.match(trace.session.messages[0].text, /퍼즐 게임/);
    service.current(session.id).stop();
    service.close();
    const reopened = new ExperimentWorkspace(
      directory,
      loadPipelineProfile(),
      () => {
        throw Error("No model calls on history");
      },
    );
    assert.equal(reopened.list().length, 1);
    assert.equal(reopened.read(session.id).session.messages.length, 1);
    assert.equal(trace.personaProvenance.length, 6);
    assert.deepEqual(
      reopened.read(session.id).personaProvenance,
      trace.personaProvenance,
    );
    const { personaProvenance: _omitted, ...oldTrace } = trace;
    assert.deepEqual(
      experimentTraceSchema.parse(oldTrace).personaProvenance,
      [],
    );
    assert.equal(
      reopened.read(session.id).session.inputs[0].text,
      "퍼즐 게임 처음 하는데 어떤가요?",
    );
    assert.ok(reopened.read(session.id).session.endedAt);
    assert.throws(() => reopened.current(session.id), /진행 중/);
    reopened.delete(session.id);
    assert.equal(reopened.list().length, 0);
  } finally {
    cleanup();
  }
});

test("stop cancels in-flight work and suppresses late publication and further input", async () => {
  let finish!: () => void;
  let started = false;
  let aborted = false;
  const { service, cleanup } = workspace(async (input, signal) => {
    started = true;
    signal.addEventListener(
      "abort",
      () => {
        aborted = true;
      },
      { once: true },
    );
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return fixtureModel(input, new AbortController().signal);
  });
  try {
    const session = service.start({
      topic: "게임",
      provider: "fixture",
      maxCalls: 6,
    });
    service
      .current(session.id)
      .input(randomUUID(), "게임 어떻게 할까요?", "text");
    await until(() => started);
    service.current(session.id).stop();
    assert.equal(aborted, true);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(service.read(session.id).session.messages.length, 0);
    assert.equal(service.read(session.id).calls[0].error, "canceled");
    assert.throws(
      () => service.current(session.id).input(randomUUID(), "late", "text"),
      /진행 중/,
    );
  } finally {
    cleanup();
  }
});

test("call limits stop the test without fabricating a reviewed reply", async () => {
  const { service, cleanup } = workspace();
  try {
    const session = service.start({
      topic: "게임",
      provider: "fixture",
      maxCalls: 1,
    });
    service
      .current(session.id)
      .input(randomUUID(), "게임 어떻게 할까요?", "text");
    await until(
      () => service.read(session.id).session.state === "budget_exhausted",
    );
    assert.equal(service.read(session.id).session.calls, 1);
    assert.equal(service.read(session.id).session.messages.length, 0);
  } finally {
    cleanup();
  }
});

for (const { provider, keyName, endpoint, model, language } of [
  {
    provider: "groq",
    keyName: "GROQ_API_KEY",
    endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
    model: "whisper-large-v3-turbo",
    language: "",
  },
  {
    provider: "openai",
    keyName: "OPENAI_API_KEY",
    endpoint: "https://api.openai.com/v1/audio/transcriptions",
    model: "whisper-1",
    language: "ja",
  },
] as const) {
  test(`${provider} microphone route uses shared settings and admits only current-session speech`, async () => {
    const { service, cleanup } = workspace();
    const app = Fastify();
    registerExperimentErrors(app);
    let seen = 0;
    let finish: (() => void) | undefined;
    registerExperimentRoutes(app, service, { provider, language }, (async (
      url,
      init,
    ) => {
      seen++;
      assert.equal(url, endpoint);
      const body = init!.body as FormData;
      assert.equal(body.get("model"), model);
      assert.equal(body.get("language"), language || null);
      assert.equal(
        (init!.headers as Record<string, string>).Authorization,
        "Bearer fixture-only",
      );
      assert.equal((body.get("file") as File).name, "audio.wav");
      assert.equal((body.get("file") as File).type, "audio/wav");
      if (seen === 2)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      return Response.json({ text: "마이크로 전한 게임 이야기" });
    }) as typeof fetch);
    const prior = process.env[keyName];
    const otherKey =
      keyName === "GROQ_API_KEY" ? "OPENAI_API_KEY" : "GROQ_API_KEY";
    const priorOther = process.env[otherKey];
    process.env[otherKey] = "fixture-unselected";
    process.env[keyName] = "fixture-only";
    try {
      const missingIndex = (
        await app.inject({ url: "/api/admin/experiments" })
      ).json();
      assert.equal(missingIndex.microphone.provider, provider);
      assert.equal(missingIndex.microphone.keyName, keyName);
      assert.equal(missingIndex.microphone.language, language);
      assert.equal(missingIndex.microphoneReady, true);
      const session = service.start({
        topic: "게임",
        provider: "fixture",
        maxCalls: 6,
      });
      const pcm = Buffer.alloc(320000);
      for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(500, i);
      const payload = {
        id: randomUUID(),
        pcm: pcm.toString("base64"),
        capturedAt: Date.now(),
      };
      const upload = () =>
        app.inject({
          method: "POST",
          url: `/api/admin/experiments/${session.id}/audio`,
          payload,
        });
      delete process.env[keyName];
      assert.equal(
        (await app.inject({ url: "/api/admin/experiments" })).json()
          .microphoneReady,
        false,
      );
      const denied = await upload();
      assert.equal(denied.statusCode, 409);
      assert.ok(denied.json().error.includes(keyName));
      assert.equal(seen, 0);
      process.env[keyName] = "fixture-only";
      assert.equal((await upload()).statusCode, 200);
      assert.equal((await upload()).statusCode, 200);
      assert.equal(seen, 1);
      assert.equal(
        service.read(session.id).session.inputs[0].source,
        "microphone",
      );
      const pending = app.inject({
        method: "POST",
        url: `/api/admin/experiments/${session.id}/audio`,
        payload: { ...payload, id: randomUUID() },
      });
      const started = pending.then((result) => result);
      await until(() => !!finish);
      service.current(session.id).stop();
      finish!();
      assert.equal((await started).statusCode, 409);
      assert.equal(service.read(session.id).session.inputs.length, 1);
      assert.equal(service.read(session.id).session.microphoneCalls, 2);
    } finally {
      if (priorOther === undefined) delete process.env[otherKey];
      else process.env[otherKey] = priorOther;
      if (prior === undefined) delete process.env[keyName];
      else process.env[keyName] = prior;
      await app.close();
      cleanup();
    }
  });
}

test("experiment APIs require administrator auth and stay isolated from the broadcast", async () => {
  const directory = mkdtempSync(join(tmpdir(), "experiment-http-"));
  const instance = await createExperimentApp(
    experimentSettingsSchema.parse({ port: 3211 }),
    {
      directory,
      adminToken: "a".repeat(64),
      encryptionKey: "e".repeat(64),
    },
  );
  try {
    const { app } = instance;
    const headers = {
      host: "127.0.0.1:3211",
      authorization: `Bearer ${"a".repeat(64)}`,
    };
    assert.equal(
      (
        await app.inject({
          url: "/api/admin/experiments",
          headers: { host: headers.host },
        })
      ).statusCode,
      401,
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/experiments",
      headers,
      payload: { topic: "개발자 테스트", provider: "fixture", maxCalls: 6 },
    });
    assert.equal(response.statusCode, 200);
    const session = response.json();
    const input = await app.inject({
      method: "POST",
      url: `/api/admin/experiments/${session.id}/input`,
      headers,
      payload: { id: randomUUID(), text: "테스트 입력" },
    });
    assert.equal(input.statusCode, 200);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/admin/experiments",
      headers,
      payload: { topic: "", provider: "arbitrary" },
    });
    assert.equal(invalid.statusCode, 400);
    const trace = await app.inject({
      url: `/api/admin/experiments/${session.id}/trace`,
      headers,
    });
    assert.equal(trace.statusCode, 200);
  } finally {
    await instance.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resume restores the same cast, conversation, profile and cumulative usage after workspace restart", async ({
  mock,
}) => {
  const { service, directory, cleanup } = workspace();
  let reopened: ExperimentWorkspace | undefined;
  try {
    const first = service.start({
      topic: "퍼즐 게임",
      provider: "fixture",
      maxCalls: 2,
    });
    service.active!.input(
      randomUUID(),
      "퍼즐 게임 처음 하는데 어떤가요?",
      "text",
    );
    await until(() => service.active!.messages.length === 1);
    service.active!.stop();
    const original = structuredClone(service.read(first.id));
    const realNow = Date.now;
    mock.method(Date, "now", () => realNow() + 60000);
    service.close();
    const seen: Parameters<Model<Buffer>>[0][] = [];
    reopened = new ExperimentWorkspace(
      directory,
      loadPipelineProfile(),
      () => ({
        name: "fixture",
        model: async (input, signal) => {
          seen.push(input);
          return fixtureModel(input, signal);
        },
      }),
      () => 0,
    );
    const app = Fastify();
    registerExperimentErrors(app);
    registerExperimentRoutes(app, reopened, { provider: "groq", language: "" });
    try {
      const invalid = await app.inject({
        method: "POST",
        url: `/api/admin/experiments/${first.id}/resume`,
        payload: { additionalCalls: 0 },
      });
      assert.equal(invalid.statusCode, 400);
      assert.deepEqual(reopened.read(first.id), original);
      const response = await app.inject({
        method: "POST",
        url: `/api/admin/experiments/${first.id}/resume`,
        payload: { additionalCalls: 4 },
      });
      assert.equal(response.statusCode, 200, response.body);
      const resumed = response.json();
      assert.equal(resumed.id, first.id);
      assert.equal(resumed.startedAt, first.startedAt);
      assert.equal(resumed.endedAt, null);
      assert.equal(resumed.calls, 2);
      assert.equal(resumed.maxCalls, 6);
      assert.deepEqual(resumed.personas, original.session.personas);
      assert.deepEqual(resumed.messages, original.session.messages);
      assert.deepEqual(resumed.inputs, original.session.inputs);
      assert.deepEqual(
        reopened.read(first.id).personaProvenance,
        original.personaProvenance,
      );
      assert.deepEqual(
        reopened.active!.store.snapshot().messages,
        original.session.messages,
      );
      assert.deepEqual(reopened.read(first.id).calls, original.calls);
      await reopened.active!.coordinator.tick();
      assert.equal(
        seen.length,
        0,
        "old input must not trigger a new response on resume",
      );
      assert.throws(() => reopened!.resume(first.id), /먼저 종료/);
      reopened.active!.input(
        randomUUID(),
        "이번 퍼즐 게임은 어떻게 풀까요?",
        "text",
      );
      await until(() => reopened!.active!.messages.length === 2);
      assert.equal(reopened.active!.snapshot().calls, 4);
      assert.equal(reopened.list().length, 1);
      assert(seen.length >= 2);
      assert(
        JSON.stringify(seen).includes(original.session.messages[0].id),
        "model must receive restored conversation evidence",
      );
      assert.equal(
        reopened.active!.messages[1].sessionId,
        original.session.messages[0].sessionId,
      );
      reopened.active!.stop();
      assert.equal(reopened.read(first.id).calls.length, 4);
      assert(
        reopened.read(first.id).attempts.length > original.attempts.length,
      );
      reopened.resume(first.id, 2);
      assert.equal(reopened.active!.snapshot().calls, 4);
      assert.equal(reopened.active!.snapshot().maxCalls, 6);
      assert.equal(reopened.active!.inputs.length, 2);
    } finally {
      await app.close();
    }
  } finally {
    reopened?.close();
    cleanup();
  }
});

test("failed reconnect and another active test never alter saved sessions", () => {
  const { service, directory, cleanup } = workspace();
  let reopened: ExperimentWorkspace | undefined;
  try {
    const first = service.start({
      topic: "게임",
      provider: "fixture",
      maxCalls: 2,
    });
    service.active!.stop();
    const original = structuredClone(service.read(first.id));
    const other = service.start({
      topic: "다른 게임",
      provider: "fixture",
      maxCalls: 2,
    });
    assert.throws(() => service.resume(first.id), /먼저 종료/);
    assert.equal(service.active!.id, other.id);
    assert.deepEqual(service.read(first.id), original);
    service.close();
    reopened = new ExperimentWorkspace(directory, loadPipelineProfile(), () => {
      throw Error("Unavailable");
    });
    assert.throws(() => reopened!.resume(first.id), /다시 시도/);
    assert.deepEqual(reopened.read(first.id), original);
  } finally {
    reopened?.close();
    cleanup();
  }
});

test("interrupted legacy sessions use their saved prompts and receive a fresh time window", async () => {
  const { service, directory, cleanup } = workspace();
  let reopened: ExperimentWorkspace | undefined;
  try {
    const first = service.start({
      topic: "게임",
      provider: "fixture",
      maxCalls: 2,
    });
    const trace = structuredClone(service.read(first.id));
    service.close();
    // A pre-resume snapshot has neither end metadata nor a pipeline type field.
    const legacy: any = trace;
    delete legacy.session.pipelineType;
    delete legacy.session.pipelineRevision;
    legacy.session.startedAt = Date.now() - 2 * 60 * 60 * 1000;
    legacy.pipeline.prompts.answer = "Saved synthetic prompt";
    writeFileSync(join(directory, first.id + ".json"), JSON.stringify(legacy));
    const changed = loadPipelineProfile();
    changed.prompts = {
      ...changed.prompts,
      answer: "Current synthetic prompt",
    };
    reopened = new ExperimentWorkspace(
      directory,
      changed,
      (_provider, saved) => {
        assert.equal(saved.prompts.answer, "Saved synthetic prompt");
        return { name: "fixture", model: fixtureModel };
      },
    );
    assert.equal(reopened.read(first.id).session.state, "interrupted");
    const resumed = reopened.resume(first.id);
    assert.equal(resumed.pipelineType, "standard");
    assert.equal(resumed.startedAt, legacy.session.startedAt);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(reopened.active!.snapshot().state, "running");
    assert.equal(reopened.active!.endedAt, null);
    assert.equal(reopened.active!.calls.length, 0);
  } finally {
    reopened?.close();
    cleanup();
  }
});
