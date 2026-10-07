import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../packages/config.ts";
import { createApp } from "../apps/server/app.ts";
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
const { app, experiments, store } = await createApp(
  configSchema.parse({
    port,
    database: ":memory:",
    audio: { provider: speechProvider, language: "ko" },
    youtube: { redirectUri: `http://127.0.0.1:${port}/oauth/youtube/callback` },
    chzzk: { redirectUri: `http://127.0.0.1:${port}/oauth/chzzk/callback` },
    soop: { redirectUri: `http://127.0.0.1:${port}/oauth/soop/callback` },
  }),
  {
    demo: true,
    adminToken: "a".repeat(64),
    readerToken: "r".repeat(64),
    encryptionKey: "e".repeat(64),
    startInputs: false,
    experimentDirectory: join(directory, "experiments"),
    chatgptTokenPath: join(directory, "chatgpt"),
    youtubeTokenPath: join(directory, "youtube"),
    chzzkTokenPath: join(directory, "chzzk"),
    soopTokenPath: join(directory, "soop"),
    experimentSpeechRequest: (async (url, init) => {
      assert.equal(url, endpoint);
      const file = (init!.body as FormData).get("file") as File;
      assert(file.size > 0);
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
  await captureUIReview(page, "experiment-setup");
  await page
    .getByLabel("방송 주제", { exact: true })
    .fill("처음 해 보는 퍼즐 게임");
  await page.getByLabel("AI 연결", { exact: true }).selectOption("fixture");
  await page.getByRole("button", { name: "테스트 시작", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "시청자에게 할 말" }),
  ).toBeEnabled();
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
  await expect(page.getByRole("button", { name: /녹음 전송/ })).toBeVisible();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /녹음 전송/ }).click();
  await expect(
    page
      .locator(".experiment-message.own")
      .filter({ hasText: "다음에는 무엇을" }),
  ).toBeVisible();
  assert.equal(experiments.active!.microphoneCalls, 1);
  assert.equal(store.transcriptRows().length, 0);
  assert.equal(store.snapshot().messages.length, 0);
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
  assert.equal((await downloading).suggestedFilename(), "ai-viewer-test.json");
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page
    .getByRole("button", { name: "테스트 기록 삭제", exact: true })
    .click();
  await page.getByRole("button", { name: "기록 삭제", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "AI 시청자와 대화하기" }),
  ).toBeVisible();
  assert.throws(() => experiments.read(sessionId), /찾을 수/);
  assert.deepEqual(errors, []);
  console.log(
    "Interactive experiments PASS: text -> AI reply, persona, recorded microphone -> mocked Whisper -> transcript, stop, reload, trace, export, deletion, isolation, mobile.",
  );
} finally {
  await browser.close();
  await app.close();
  if (priorKey === undefined) delete process.env[keyName];
  else process.env[keyName] = priorKey;
  rmSync(directory, { recursive: true, force: true });
}
