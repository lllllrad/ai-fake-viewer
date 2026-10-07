import { test } from "node:test";
import assert from "node:assert/strict";
import { startAiServiceFixture } from "../scripts/ai-service-fixture.ts";
import { AiServiceClient } from "../packages/infrastructure/ai-service/client.ts";
import { fixtureToolModel as fixtureModel } from "../packages/infrastructure/experiments/models.ts";
import { createAiService } from "../services/viewer-ai/app.ts";

test("a separate AI process performs generation and review through host model callbacks", async () => {
  const service = await startAiServiceFixture();
  try {
    const client = new AiServiceClient(service);
    assert.equal((await client.json("/v1/pipelines")).protocol, 1);
    const input = {
      frames: [],
      messages: [],
      transcripts: [
        { id: "speech", capturedAt: Date.now(), text: "합성 퍼즐 게임" },
      ],
      persona: { name: "합성 시청자", style: "fixture" },
      description: "합성 테스트",
    };
    const phases: string[] = [];
    let calls = 0;
    const outcome = await client.program("standard").draft<Buffer>({
      input,
      signal: new AbortController().signal,
      isCurrent: () => true,
      inspectAllowed: true,
      review: true,
      latestFrames: () => [],
      hasTranscript: () => true,
      model: async (request, signal) => {
        calls++;
        return fixtureModel(request, signal);
      },
      updateState: async (values) => ({
        memberId: "fixture",
        binding: "fixture",
        revision: 1,
        updatedAt: Date.now(),
        expiresAt: Date.now() + 60000,
        values,
      }),
      active() {},
      phase: (phase) => phases.push(phase),
      trace() {},
    });
    assert.equal(calls, 2);
    assert.equal(outcome.kind, "candidate");
    assert(phases.includes("ai_review"));
    const controller = new AbortController();
    const canceled = client.program("standard").draft<Buffer>({
      input,
      signal: controller.signal,
      isCurrent: () => !controller.signal.aborted,
      inspectAllowed: true,
      review: true,
      latestFrames: () => [],
      hasTranscript: () => true,
      model: async (request, signal) => {
        controller.abort();
        return fixtureModel(request, new AbortController().signal);
      },
      updateState: async (values) => ({
        memberId: "fixture",
        binding: "fixture",
        revision: 1,
        updatedAt: Date.now(),
        expiresAt: Date.now() + 60000,
        values,
      }),
      active() {},
      phase() {},
      trace() {},
    });
    await assert.rejects(canceled, /abort/i);
  } finally {
    service.stop();
  }
});

test("service authentication, unknown types, stale job steps and shutdown stay bounded", async () => {
  const token = "s".repeat(64);
  const app = createAiService(token);
  try {
    assert.equal((await app.inject({ url: "/v1/pipelines" })).statusCode, 401);
    const headers = { authorization: `Bearer ${token}` };
    assert.equal(
      (await app.inject({ url: "/v1/pipelines", headers })).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/select",
          headers,
          payload: { pipelineType: "missing", input: {} },
        })
      ).statusCode,
      502,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/runs/missing/continue",
          headers,
          payload: { step: 1 },
        })
      ).statusCode,
      409,
    );
    assert.throws(
      () => new AiServiceClient({ url: "https://example.com", token }),
      /local HTTP/,
    );
  } finally {
    await app.close();
  }
});

test("a canceled remote job cannot continue and a changed revision is rejected", async () => {
  const token = "c".repeat(64);
  const app = createAiService(token);
  const headers = { authorization: `Bearer ${token}` };
  const payload = {
    pipelineType: "standard",
    revision: 1,
    input: {
      persona: { name: "Synthetic", style: "fixture" },
      description: "fixture",
      messages: [],
      frames: [],
    },
    frames: [],
    validTranscripts: [],
    review: true,
    inspectAllowed: false,
  };
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload,
    });
    assert.equal(response.statusCode, 200);
    const packet = response.json();
    assert.equal(packet.kind, "model");
    await app.inject({
      method: "DELETE",
      url: `/v1/runs/${packet.id}`,
      headers,
    });
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/v1/runs/${packet.id}/continue`,
          headers,
          payload: {
            step: packet.step,
            frames: [],
            validTranscripts: [],
            result: {},
          },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/runs",
          headers,
          payload: { ...payload, revision: 999 },
        })
      ).statusCode,
      502,
    );
  } finally {
    await app.close();
  }
});
