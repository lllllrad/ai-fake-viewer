import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExperimentApp } from "../apps/experiments/app.ts";
import { experimentSettingsSchema } from "../apps/experiments/settings.ts";
import { captureUIReview } from "./ui-review.ts";
const directory = mkdtempSync(join(tmpdir(), "interactive-browser-"));
const speechProvider =
  process.env.EXPERIMENT_TEST_SPEECH_PROVIDER === "openai" ? "openai" : "groq";
const keyName = speechProvider === "openai" ? "OPENAI_API_KEY" : "GROQ_API_KEY";
const endpoint =
  speechProvider === "openai"
    ? "https://api.openai.com/v1/audio/transcriptions"
    : "https://api.groq.com/openai/v1/audio/transcriptions";
const priorKey = process.env[keyName];
process.env[keyName] = "fixture-whisper";
const port = 33221;
const { app, experiments } = await createExperimentApp(
  experimentSettingsSchema.parse({
    port,
    audio: { provider: speechProvider, language: "ko" },
  }),
  {
    directory,
    adminToken: "a".repeat(64),
    encryptionKey: "e".repeat(64),
    speechRequest: (async (url, init) => {
      assert.equal(url, endpoint);
      const file = (init!.body as FormData).get("file") as File;
      assert.equal(file.name, "audio.wav");
      assert.equal(file.size, 44 + 16000 * 2 * 10);
      return Response.json({ text: "이 퍼즐 게임 다음에는 무엇을 해볼까요?" });
    }) as typeof fetch,
  },
);
await app.listen({ port, host: "127.0.0.1" });
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["microphone"],
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/admin#experiments`);
  await page.getByLabel("관리자 접속 토큰").fill("a".repeat(64));
  await page.getByRole("button", { name: "연결하기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "AI 시청자와 대화하기" }),
  ).toBeVisible();
  await expect(page.getByLabel("AI 유형", { exact: true })).toHaveValue(
    "standard",
  );
  await captureUIReview(page, "experiment-setup");
  await page
    .getByLabel("방송 주제", { exact: true })
    .fill("처음 해 보는 퍼즐 게임");
  await page.getByLabel("AI 연결", { exact: true }).selectOption("fixture");
  await page.getByRole("button", { name: "테스트 시작", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "시청자에게 할 말" }),
  ).toBeEnabled();
  const nicknames = experiments
    .active!.snapshot()
    .personas.map((persona) => persona.displayName);
  assert.equal(new Set(nicknames).size, 6);
  for (const name of nicknames) {
    assert.match(name, /^[A-Za-z0-9가-힣_.]{1,20}$/u);
    await expect(
      page
        .locator(".experiment-personas > details > summary")
        .filter({ hasText: name }),
    ).toBeVisible();
  }
  experiments.active!.coordinator.random = () => 0;
  await page
    .getByRole("textbox", { name: "시청자에게 할 말" })
    .fill("퍼즐 게임 처음인데 어디부터 해볼까요?");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.locator(".experiment-message:not(.own)")).toHaveCount(1, {
    timeout: 10000,
  });
  await expect(
    page.getByRole("heading", { name: "실행 기록", exact: true }),
  ).toHaveCount(0);
  await page
    .locator(".experiment-personas > details > summary")
    .first()
    .click();
  await expect(
    page.locator(".experiment-personas > details").first(),
  ).toHaveAttribute("open", "");
  await page
    .getByRole("button", { name: "마이크로 말하기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "마이크 중지", exact: true }),
  ).toBeVisible();
  // Real browser audio worklet: a complete live-sized chunk is sent automatically.
  await expect
    .poll(() => experiments.active!.microphoneCalls, { timeout: 20000 })
    .toBe(1);
  await expect(
    page
      .locator(".experiment-message.own")
      .filter({ hasText: "다음에는 무엇을" }),
  ).toBeVisible();
  assert.equal(experiments.active!.microphoneCalls, 1);
  await page.getByRole("button", { name: "마이크 중지", exact: true }).click();

  await captureUIReview(page, "experiment-conversation");
  delete process.env[keyName];
  await page.reload();
  await expect(page.locator(".experiment-composer")).toContainText(
    `서버의 ${keyName}가 필요합니다`,
  );
  await expect(
    page.getByRole("button", { name: "마이크로 말하기", exact: true }),
  ).toBeDisabled();
  process.env[keyName] = "fixture-whisper";
  await page.reload();
  const sessionId = experiments.active!.id;
  await page.getByRole("button", { name: "테스트 종료", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "시청자에게 할 말" }),
  ).toBeDisabled();
  await expect(page.locator(".experiment-footer")).toContainText(
    "종료된 테스트입니다.",
  );
  await page.reload();
  await expect(page.locator(".experiment-message:not(.own)")).toHaveCount(1);
  await page
    .getByRole("button", { name: "실행 기록 보기", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "실행 기록", exact: true }),
  ).toBeVisible();
  await page.locator(".experiment-trace > details > summary").first().click();
  await expect(
    page.getByRole("heading", { name: "모델에 보낸 요청" }),
  ).toBeVisible();
  await captureUIReview(page, "experiment-trace");
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "전체 기록 내려받기" }).click();
  const download = await downloading;
  assert.equal(download.suggestedFilename(), "ai-viewer-test.json");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  assert.deepEqual(
    exported.session.personas.map(
      (persona: { displayName: string }) => persona.displayName,
    ),
    nicknames,
  );
  assert.equal(exported.personaProvenance.length, 6);
  assert.deepEqual(
    new Set(
      exported.personaProvenance.map(
        (entry: any) => entry.provenance.nickname.display_name,
      ),
    ),
    new Set(nicknames),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await captureUIReview(page, "experiment-resume");
  const beforeResume = structuredClone(experiments.read(sessionId).session);
  await page.getByLabel("추가 AI 호출 한도", { exact: true }).fill("4");
  await page
    .getByRole("button", { name: "이어서 테스트", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "시청자에게 할 말" }),
  ).toBeEnabled();
  experiments.active!.coordinator.random = () => 0;
  assert.equal(experiments.active!.id, sessionId);
  assert.equal(experiments.active!.snapshot().maxCalls, beforeResume.calls + 4);
  assert.deepEqual(
    experiments.active!.snapshot().personas.map((p) => p.id),
    beforeResume.personas.map((p) => p.id),
  );
  assert.deepEqual(experiments.active!.messages, beforeResume.messages);
  await page
    .getByRole("textbox", { name: "시청자에게 할 말" })
    .fill("이어서 다른 퍼즐 게임에 도전해 볼까요?");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(
    page
      .locator(".experiment-message.own")
      .filter({ hasText: "이어서 다른 퍼즐" }),
  ).toBeVisible();
  await expect(page.locator(".experiment-message:not(.own)")).toHaveCount(2, {
    timeout: 15000,
  });
  await page.getByRole("button", { name: "테스트 종료", exact: true }).click();
  await page.reload();
  await expect(page.locator(".experiment-message:not(.own)")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "이어서 테스트", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "테스트 기록 삭제", exact: true })
    .click();
  await page.getByRole("button", { name: "기록 삭제", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "AI 시청자와 대화하기" }),
  ).toBeVisible();
  assert.throws(() => experiments.read(sessionId), /찾을 수/);
  // Mock only account HTTP operations; the test still runs the real fixture pipeline.
  // No OAuth connection, model-list request or paid inference leaves this process.
  let selectedModel: string | null = null;
  let releaseSave: (() => void) | undefined;
  let postedProvider = "";
  await page.route("**/api/admin/session", async (route) =>
    route.fulfill({
      json: {
        chatgpt: {
          active: "fixture-account",
          accounts: [
            {
              clientId: "fixture-account",
              email: null,
              connected: true,
              model: selectedModel,
            },
          ],
        },
      },
    }),
  );
  await page.route("**/api/admin/chatgpt/models", async (route) =>
    route.fulfill({
      json: {
        models: [
          { slug: "fixture-one", name: "Fixture one" },
          { slug: "fixture-two", name: "Fixture two" },
        ],
      },
    }),
  );
  await page.route("**/api/admin/chatgpt/select-model", async (route) => {
    const slug = route.request().postDataJSON().slug;
    await new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    selectedModel = slug;
    experiments.active?.stop("chatgpt_account_changed");
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/admin/experiments", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON();
    postedProvider = body.provider;
    if (body.provider === "openai_api")
      return route.fulfill({
        status: 409,
        json: {
          error: "Responses API가 선택되어 있습니다. AI 연결을 확인해 주세요.",
        },
      });
    const snapshot = experiments.start({ ...body, provider: "fixture" });
    return route.fulfill({ json: snapshot });
  });
  // A callback redirect loads the document, even when the UI was already open.
  await page.goto("about:blank");
  await page.goto(`http://127.0.0.1:${port}/admin#ai-connection`);
  await expect(page.locator(".test-account")).toHaveAttribute("open", "");
  await page.getByLabel("방송 주제", { exact: true }).fill("연결 직후 테스트");
  await expect(page.getByLabel("AI 연결", { exact: true })).toHaveValue(
    "openai_api",
  );
  await page.getByRole("button", { name: "테스트 시작", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Responses API가 선택");
  await page.getByRole("button", { name: "모델 목록 새로고침" }).click();
  await page
    .getByLabel("테스트 모델", { exact: true })
    .selectOption("fixture-one");
  await expect(
    page.getByRole("button", { name: "AI 연결 저장 중…" }),
  ).toBeDisabled();
  await expect.poll(() => !!releaseSave).toBe(true);
  releaseSave!();
  await expect(page.getByLabel("AI 연결", { exact: true })).toHaveValue(
    "chatgpt_subscription",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "테스트 시작", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "시청자에게 할 말" }),
  ).toBeEnabled();
  assert.equal(postedProvider, "chatgpt_subscription");
  await page.getByRole("button", { name: "테스트 종료", exact: true }).click();
  await page.getByRole("button", { name: "새 테스트", exact: true }).click();
  await page.getByLabel("AI 연결", { exact: true }).selectOption("fixture");
  releaseSave = undefined;
  await page
    .getByLabel("테스트 모델", { exact: true })
    .selectOption("fixture-two");
  await expect.poll(() => !!releaseSave).toBe(true);
  releaseSave!();
  await expect(
    page.getByRole("button", { name: "테스트 시작", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("AI 연결", { exact: true })).toHaveValue(
    "fixture",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Interactive experiments PASS: text -> AI reply, persona, recorded microphone -> mocked Whisper -> transcript, stop, reload, resume -> preserved cast/history -> new reply, trace, export, deletion, isolation, mobile, account/model save -> immediate start and explicit provider preservation.",
  );
} finally {
  await browser.close();
  await app.close();
  if (priorKey === undefined) delete process.env[keyName];
  else process.env[keyName] = priorKey;
  rmSync(directory, { recursive: true, force: true });
}
