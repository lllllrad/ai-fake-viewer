import "./browser-ai-service.ts";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../packages/config.ts";
import { createApp } from "../apps/server/app.ts";
import { renderDemoFrame } from "../packages/infrastructure/reference/demo-frame.ts";
import { fixtureToolModel } from "../packages/infrastructure/experiments/models.ts";
import { captureUIReview } from "./ui-review.ts";

const dir = mkdtempSync(join(tmpdir(), "ai-stream-browser-"));
const port = 33225,
  token = "a".repeat(64);
const runtime = await createApp(
  configSchema.parse({
    port,
    database: ":memory:",
    input: {
      mode: "ai_stream",
      streamUrl: "rtmp://127.0.0.1:1935/synthetic-ai",
    },
    ai: { manualApproval: true },
  }),
  {
    demo: false,
    adminToken: token,
    readerToken: "r".repeat(64),
    encryptionKey: "e".repeat(64),
    chatgptTokenPath: join(dir, "chatgpt"),
    startInputs: false,
  },
);
runtime.scheduler.model = fixtureToolModel;
runtime.scheduler.providerReady = () => true;
runtime.scheduler.random = () => 0;
// Isolated synthetic media; never subscribe to the shared broadcast stream.
runtime.transcriber.state = "listening";
let index = 0;
const feed = async () =>
  runtime.capture.add(await renderDemoFrame(index++), "demo");
await feed();
const timer = setInterval(() => void feed(), 1500);
await runtime.app.listen({ port, host: "127.0.0.1" });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/admin`);
  await page.getByLabel("관리자 접속 토큰").fill(token);
  await page.getByRole("button", { name: "연결하기", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "운영 화면" });
  await nav.getByRole("link", { name: "방송 준비", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "AI 전용 스트림", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "채팅 플랫폼", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByAltText("AI가 보는 전용 스트림 화면")).toBeVisible();
  await captureUIReview(page, "ai-stream");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "AI 전용 스트림", exact: true }),
  ).toBeVisible();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav.getByRole("link", { name: "라이브", exact: true }).click();
  assert.equal(await nav.getByRole("link").count(), 2);
  const toggle = page.getByRole("switch", { name: "AI 채팅 생성 사용" });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(
    page.getByRole("button", { name: "AI 채팅 게시", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "AI 채팅 게시", exact: true }).click();
  await expect
    .poll(() => runtime.store.readerSnapshot().messages.length, {
      timeout: 15000,
    })
    .toBe(1);
  assert.equal(runtime.store.viewerMemory.list().length, 1);
  const reader = await context.newPage();
  const overlay = await context.newPage();
  await reader.goto("http://127.0.0.1:" + port + "/reader#" + "r".repeat(64));
  await overlay.goto("http://127.0.0.1:" + port + "/overlay#" + "r".repeat(64));
  const message = runtime.store.readerSnapshot().messages[0].text;
  await expect(reader.getByText(message, { exact: true })).toBeVisible();
  await expect(overlay.getByText(message, { exact: true })).toBeVisible();
  await captureUIReview(reader, "reader");
  await captureUIReview(overlay, "overlay");
  await expect(
    reader.getByText("AI 시청자가 생성한 채팅입니다.", { exact: false }),
  ).toBeVisible();

  await page.getByRole("button", { name: "AI 긴급 중지", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await nav.getByRole("link", { name: "방송 준비", exact: true }).click();
  await page.getByRole("tab", { name: "AI 계정·모델", exact: true }).click();
  await captureUIReview(page, "ai");
  await page.getByRole("tab", { name: "리더·OBS", exact: true }).click();
  await captureUIReview(page, "output");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.getByLabel("관리자 접속 토큰")).toBeVisible();
  assert.deepEqual(errors, []);

  console.log(
    "AI stream browser PASS: dedicated media, no chat/consent setup, desktop/mobile, AI start, tool state, candidate publication, stop.",
  );
} finally {
  clearInterval(timer);
  await browser.close();
  await runtime.app.close();
  rmSync(dir, { recursive: true, force: true });
}
