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

const priorSoopId = process.env.SOOP_CLIENT_ID,
  priorSoopSecret = process.env.SOOP_CLIENT_SECRET;
process.env.SOOP_CLIENT_ID = "fixture-client";
process.env.SOOP_CLIENT_SECRET = "fixture-secret";
const dir = mkdtempSync(join(tmpdir(), "ai-stream-browser-"));
const port = 33225,
  token = "a".repeat(64);
const runtime = await createApp(
  configSchema.parse({
    port,
    database: ":memory:",
    displayChat: {
      youtube: { enabled: false },
      chzzk: { enabled: false },
      soop: { enabled: false },
    },
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
runtime.displayChat.soop.token = {
  accessToken: "fixture-token",
  refreshToken: "fixture-refresh",
  expiresAt: Date.now() + 3600000,
};
runtime.scheduler.model = async (input, signal) => {
  assert(!JSON.stringify(input).includes("DISPLAY_ONLY"));
  return fixtureToolModel(input, signal);
};
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
  await context.route(
    "https://static.sooplive.com/asset/app/chat-sdk/sooplive-chat-sdk.js",
    (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'window.SOOP={ChatSDK:class{setAuth(){} handleReady(f){this.ready=f} handleMessageReceived(f){this.receive=f} handleChatClosed(){} handleError(){} async connect(){this.listener=e=>this.receive("MESSAGE",e.detail);window.addEventListener("fixture-soop",this.listener);queueMicrotask(()=>this.ready())} async getRoomInfo(){return {bjId:"fixture"}} disconnect(){window.removeEventListener("fixture-soop",this.listener)}}};',
      }),
  );
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
  await page.getByRole("tab", { name: "시청자 채팅", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "시청자 채팅", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("YouTube 채팅 수신", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("CHZZK 채팅 수신", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("SOOP 채팅 수신", { exact: true }),
  ).toBeVisible();
  await captureUIReview(page, "display-chat");
  // Persist a disabled-source setting without invoking any external platform.
  await page
    .getByLabel("채널 ID (영상 주소가 없을 때)", { exact: true })
    .fill("UC" + "a".repeat(22));
  await page.getByRole("button", { name: "설정 저장", exact: true }).click();
  await expect(
    page.getByText("채팅 설정을 저장했습니다.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("SOOP 채팅 수신", { exact: true }).check();
  await page.getByLabel("SOOP 방송 아이디", { exact: true }).fill("fixture");
  await page.getByRole("button", { name: "설정 저장", exact: true }).click();
  await expect(
    page.getByText("SOOP 채팅이 연결되었습니다. 관리자 탭을 열어 두세요.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "화면·음성", exact: true }).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("fixture-soop", {
        detail: {
          userId: "fixture-viewer",
          userNickname: "SDK 시청자",
          message: "DISPLAY_ONLY_SDK",
        },
      }),
    ),
  );
  await expect
    .poll(() =>
      runtime.display
        .snapshot()
        .messages.some((m) => m?.text === "DISPLAY_ONLY_SDK"),
    )
    .toBe(true);
  assert.equal(runtime.store.lastSeq(), 0);
  for (const platform of ["youtube", "chzzk", "soop"] as const)
    runtime.display.receive({
      platform,
      channel: "fixture",
      sourceId: platform,
      author: "DISPLAY_ONLY_ID",
      name: platform + " 시청자",
      text: "DISPLAY_ONLY_" + platform,
    });
  assert.equal(runtime.store.lastSeq(), 0);
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
  await expect(
    reader.getByText("DISPLAY_ONLY_SDK", { exact: true }),
  ).toBeVisible();
  await expect(
    overlay.getByText("DISPLAY_ONLY_SDK", { exact: true }),
  ).toBeVisible();
  const message = runtime.store.readerSnapshot().messages[0].text;
  await expect(reader.getByText(message, { exact: true })).toBeVisible();
  await expect(overlay.getByText(message, { exact: true })).toBeVisible();
  for (const platform of ["youtube", "chzzk", "soop"]) {
    await expect(
      reader.getByText("DISPLAY_ONLY_" + platform, { exact: true }),
    ).toBeVisible();
    await expect(
      overlay.getByText("DISPLAY_ONLY_" + platform, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("DISPLAY_ONLY_" + platform, { exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "youtube 시청자 채팅 숨기기", exact: true })
    .click();
  await expect(
    reader.getByText("DISPLAY_ONLY_youtube", { exact: true }),
  ).toHaveCount(0);
  await expect(
    overlay.getByText("DISPLAY_ONLY_youtube", { exact: true }),
  ).toHaveCount(0);
  assert.equal(runtime.store.snapshot().messages.length, 1);
  await captureUIReview(reader, "reader");
  await captureUIReview(overlay, "overlay");
  await expect(
    reader.getByText("AI가 생성한 채팅이 포함되어 있습니다.", { exact: false }),
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
    "AI stream browser PASS: dedicated media, display-only platform chat, isolated AI context, desktop/mobile, AI start, tool state, candidate publication, stop.",
  );
} finally {
  clearInterval(timer);
  await browser.close();
  await runtime.app.close();
  rmSync(dir, { recursive: true, force: true });
  if (priorSoopId === undefined) delete process.env.SOOP_CLIENT_ID;
  else process.env.SOOP_CLIENT_ID = priorSoopId;
  if (priorSoopSecret === undefined) delete process.env.SOOP_CLIENT_SECRET;
  else process.env.SOOP_CLIENT_SECRET = priorSoopSecret;
}
