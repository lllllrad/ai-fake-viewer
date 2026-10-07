import "./browser-ai-service.ts";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadPipelineProfile } from "../packages/infrastructure/reactions/pipeline-profile.ts";
import { scenarioSchema } from "../packages/infrastructure/experiments/scenario.ts";
import { runExperiment } from "../packages/infrastructure/experiments/runner.ts";
import { fixtureModel } from "../packages/infrastructure/experiments/models.ts";
import { renderExperimentReport } from "../packages/infrastructure/experiments/report.ts";

const dir = mkdtempSync(join(tmpdir(), "experiment-browser-"));
const browser = await chromium.launch({ headless: true });
try {
  const result = await runExperiment({
    pipeline: loadPipelineProfile("experiments/profiles/baseline.json"),
    scenario: scenarioSchema.parse({
      schemaVersion: 1,
      id: "browser",
      description: "<script>window.fixtureInjected=true</script>",
      topic: "선택 이유",
      durationMs: 10000,
      events: [{ kind: "speech", atMs: 1000, text: "선택 이유가 뭔가요?" }],
    }),
    directory: dir,
    seed: 1,
    mode: "replay",
    provider: "fixture",
    modelName: "fixture",
    model: fixtureModel,
    maxCalls: 4,
  });
  const other = structuredClone(result);
  other.pipeline.profile.id = "comparison";
  other.summary.failedChecks = 1;
  const file = join(dir, "report.html");
  writeFileSync(file, renderExperimentReport([result, other]));
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(file).href);
  assert.equal(await page.locator(".run:visible").count(), 2);
  assert.equal(await page.evaluate(() => "fixtureInjected" in window), false);
  await page.selectOption("#filter", "failed");
  assert.equal(await page.locator(".run:visible").count(), 1);
  await page.selectOption("#filter", "all");
  await page
    .locator(".run")
    .first()
    .locator("summary")
    .filter({ hasText: "AI 시청자 페르소나" })
    .click();
  assert(
    await page.locator(".run").first().locator("details[open] pre").isVisible(),
  );
  await page
    .locator("textarea")
    .first()
    .fill("문맥은 맞지만 표현 반복을 확인해야 함");
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#export").click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "experiment-notes.json");
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Experiment report: comparison, filter, details, notes export, escaping and mobile layout passed.",
  );
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
