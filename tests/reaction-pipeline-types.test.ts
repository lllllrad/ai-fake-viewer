import { standardPipeline } from "./helpers/local-pipeline.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ReactionPipelineRegistry,
  reactionPipelines,
} from "../packages/application/reactions/pipelines.ts";
import { createScheduler } from "../packages/infrastructure/reactions/scheduler.ts";
import { Store } from "../packages/storage.ts";
import { Capture } from "../packages/infrastructure/inputs/screen-input.ts";
import { configSchema } from "../packages/config.ts";
import { ExperimentWorkspace } from "../packages/infrastructure/experiments/interactive.ts";
import { fixtureModel } from "../packages/infrastructure/experiments/models.ts";
import { loadPipelineProfile } from "../packages/infrastructure/reactions/pipeline-profile.ts";
import { runExperiment } from "../packages/infrastructure/experiments/runner.ts";
import { scenarioSchema } from "../packages/infrastructure/experiments/scenario.ts";

test("registry rejects unknown/duplicate implementations instead of substituting a provider", () => {
  const registry = new ReactionPipelineRegistry([standardPipeline]);
  assert.deepEqual(
    registry.list().map((entry) => entry.id),
    ["standard"],
  );
  assert.throws(() => registry.get("missing"), /Unknown AI pipeline/);
  assert.throws(() => registry.register(standardPipeline), /duplicate/);
});
test("live, interactive, replay and draft select the same alternate implementation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pipeline-types-"));
  let creations = 0,
    ticks = 0,
    drafts = 0;
  reactionPipelines.register({
    ...standardPipeline,
    id: "fixture-algorithm",
    revision: 2,
    label: "Fixture algorithm",
    description: "Synthetic no-model control flow",
    create(...args) {
      creations++;
      const engine = standardPipeline.create(...args);
      engine.tick = async () => {
        ticks++;
      };
      return engine;
    },
    inspect: (engine) =>
      (engine.store.personaRuntime()?.members ?? []).map((member) => ({
        memberId: member.id,
        status: "Synthetic state",
        updatedAt: null,
        sections: [
          {
            label: "Algorithm-specific memory",
            value: { score: 0.7, mode: "fixture" },
          },
        ],
      })),
    draft: async () => {
      drafts++;
      return { kind: "canceled" };
    },
  });
  const config = configSchema.parse({
    ai: { pipelineType: "fixture-algorithm" },
  });
  const store = new Store(":memory:");
  const capture = new Capture(config.capture, true);
  const live = createScheduler(store, capture, config, async () => {
    throw Error("Alternate algorithm must not call standard generation");
  });
  const profilePath = join(directory, "pipeline.json");
  writeFileSync(
    profilePath,
    JSON.stringify({
      schemaVersion: 1,
      id: "fixture-type",
      revision: 1,
      ai: { pipelineType: "fixture-algorithm" },
    }),
  );
  const pipeline = loadPipelineProfile(profilePath);
  const workspace = new ExperimentWorkspace(
    join(directory, "sessions"),
    pipeline,
    () => ({ model: fixtureModel, name: "fixture" }),
  );
  try {
    await live.tick();
    assert.equal(creations, 1);
    assert.equal(ticks, 1);
    const session = workspace.start({
      topic: "합성 테스트",
      provider: "fixture",
    });
    assert.equal(session.pipelineType, "fixture-algorithm");
    assert.equal(session.pipelineRevision, 2);
    assert.equal(session.viewerStates.length, 6);
    assert.equal(session.viewerStates[0].status, "Synthetic state");
    assert.deepEqual(session.viewerStates[0].sections[0].value, {
      score: 0.7,
      mode: "fixture",
    });
    await workspace.active!.coordinator.tick();
    assert(ticks >= 2);
    assert.equal(creations, 2);
    workspace.active!.stop();
    assert.throws(
      () =>
        workspace.start({
          topic: "Unknown",
          provider: "fixture",
          pipelineType: "missing",
        }),
      /등록되지 않은/,
    );
    const options = {
      pipeline,
      scenario: scenarioSchema.parse({
        schemaVersion: 1,
        id: "fixture",
        description: "Synthetic",
        topic: "합성 테스트",
        durationMs: 5000,
        events: [{ kind: "speech", atMs: 0, text: "테스트" }],
      }),
      directory,
      seed: 1,
      provider: "fixture",
      modelName: "fixture",
      model: fixtureModel,
    };
    const replay = await runExperiment({ ...options, mode: "replay" });
    assert.equal(replay.calls.length, 0);
    assert.equal(creations, 3);
    await runExperiment({ ...options, mode: "draft" });
    assert.equal(drafts, 1);
    assert.equal(creations, 4);
  } finally {
    live.stop();
    workspace.close();
    capture.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed optional inspector cannot block test startup or saving", () => {
  const directory = mkdtempSync(join(tmpdir(), "pipeline-inspection-"));
  reactionPipelines.register({
    ...standardPipeline,
    id: "fixture-inspection-failure",
    inspect() {
      throw Error("Synthetic inspection failure");
    },
  });
  const workspace = new ExperimentWorkspace(
    directory,
    loadPipelineProfile(),
    () => ({ model: fixtureModel, name: "fixture" }),
  );
  try {
    const session = workspace.start({
      topic: "게임",
      provider: "fixture",
      pipelineType: "fixture-inspection-failure",
    });
    assert.equal(session.state, "running");
    assert.deepEqual(session.viewerStates, []);
    workspace.active!.stop();
    assert(workspace.read(session.id).session.endedAt);
    assert.deepEqual(workspace.read(session.id).session.viewerStates, []);
  } finally {
    workspace.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
