import { parseArgs } from "node:util";
import {
  experimentDirectory,
  loadExperimentEnvironment,
} from "../apps/experiments/settings.ts";
import { ChatgptAuth } from "../packages/infrastructure/accounts/chatgpt-auth.ts";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { loadPipelineProfile } from "../packages/infrastructure/reactions/pipeline-profile.ts";
import { scenarioSchema } from "../packages/infrastructure/experiments/scenario.ts";
import {
  runExperiment,
  type ExperimentResult,
} from "../packages/infrastructure/experiments/runner.ts";
import { experimentModel } from "../packages/infrastructure/experiments/models.ts";
import { renderExperimentReport } from "../packages/infrastructure/experiments/report.ts";

const { values } = parseArgs({
  options: {
    profile: { type: "string", multiple: true },
    scenario: { type: "string", multiple: true },
    mode: { type: "string", default: "replay" },
    provider: { type: "string", default: "fixture" },
    seed: { type: "string", default: "1" },
    repeat: { type: "string", default: "1" },
    "max-calls": { type: "string", default: "12" },
    "total-calls": { type: "string", default: "100" },
    persona: { type: "string", default: "0" },
    out: { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(`Usage: sh run-command.sh npm run experiment -- [options]
  --profile FILE       Versioned pipeline JSON (repeat to compare)
  --scenario FILE      Synthetic timeline JSON (repeat for a suite)
  --mode replay|draft  Full production coordinator or one persona draft
  --provider fixture|openai_api|chatgpt_subscription (default: fixture, offline)
  --seed N --repeat N  Paired seeds across every profile (repeat: 1..10)
  --persona 0..5       Persona for draft mode
  --max-calls N        Per-run model call cap (default: 12)
  --total-calls N      Whole-command cap (default: 100)
  --out DIRECTORY     New report directory; existing directories are refused
Outputs: report.html, results.json, manifest.json. No live DB/platform writes.`);
} else {
  const integer = (text: string, min: number, max: number) => {
    const n = Number(text);
    if (!Number.isSafeInteger(n) || n < min || n > max)
      throw Error(`Expected integer ${min}..${max}`);
    return n;
  };
  const mode = values.mode;
  const provider = values.provider;
  if (mode !== "replay" && mode !== "draft")
    throw Error("Unknown experiment mode");
  if (
    provider !== "fixture" &&
    provider !== "openai_api" &&
    provider !== "chatgpt_subscription"
  )
    throw Error("Unknown provider");
  const seed = integer(values.seed, 0, 0xffffffff - 10),
    repeats = integer(values.repeat, 1, 10);
  const maxCalls = integer(values["max-calls"], 1, 1000),
    totalLimit = integer(values["total-calls"], 1, 1000),
    personaIndex = integer(values.persona, 0, 5);
  const profiles = (
    values.profile ?? ["experiments/profiles/baseline.json"]
  ).map(loadPipelineProfile);
  const scenarios = (
    values.scenario ?? ["experiments/scenarios/direct-question.json"]
  ).map((path) => ({
    path,
    scenario: scenarioSchema.parse(JSON.parse(readFileSync(path, "utf8"))),
  }));
  if (profiles.length * scenarios.length * repeats > 100)
    throw Error("Maximum 100 runs per command");
  const environment =
    provider === "fixture" ? undefined : loadExperimentEnvironment();
  const testAuth = environment
    ? new ChatgptAuth(
        environment.encryptionKey,
        join(experimentDirectory, "chatgpt.tokens"),
      )
    : undefined;
  const output = resolve(
    values.out ??
      `.local/experiments/${new Date().toISOString().replaceAll(":", "-")}`,
  );
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  mkdirSync(output, { mode: 0o700 });
  let source: unknown = null;
  try {
    source = {
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      dirty: !!execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim(),
      diffHash: createHash("sha256")
        .update(execFileSync("git", ["diff", "HEAD"]))
        .digest("hex"),
    };
  } catch {
    /* Non-Git distribution. */
  }
  const results: ExperimentResult[] = [];
  let totalCalls = 0;
  const save = () => {
    writeFileSync(
      join(output, "results.json"),
      JSON.stringify(results, null, 2),
      { mode: 0o600 },
    );
    writeFileSync(
      join(output, "report.html"),
      renderExperimentReport(results),
      { mode: 0o600 },
    );
    writeFileSync(
      join(output, "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          source,
          provider,
          mode,
          maxCalls,
          totalLimit,
          totalCalls,
          runs: results.length,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  };
  try {
    for (const { path, scenario } of scenarios)
      for (let repeat = 0; repeat < repeats; repeat++)
        for (const pipeline of profiles) {
          const adapter = experimentModel(provider, pipeline, testAuth);
          const result = await runExperiment({
            pipeline,
            scenario,
            directory: dirname(resolve(path)),
            seed: seed + repeat,
            mode,
            provider,
            modelName: adapter.name,
            maxCalls,
            personaIndex,
            model: async (input, signal) => {
              if (totalCalls >= totalLimit) throw Error("budget_exhausted");
              totalCalls++;
              return adapter.model(input, signal);
            },
          });
          results.push(result);
          save();
          console.log(
            `${pipeline.profile.id}@${pipeline.profile.revision} / ${scenario.id} / seed ${seed + repeat}: ${result.summary.calls} calls, ${result.summary.published} published, ${result.summary.failedChecks} failed checks`,
          );
          if (result.summary.failedChecks || result.summary.failed)
            process.exitCode = 1;
        }
  } finally {
    save();
    console.log(`Report: ${join(output, "report.html")}`);
  }
}
