import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../packages/config.ts";
import { createApp } from "../apps/server/app.ts";
const port = 33219;
const chatgptDir = mkdtempSync(join(tmpdir(), "mixed-chat-browser-"));
const admin = "a".repeat(64),
  reader = "r".repeat(64);
const { app, store, capture } = await createApp(
  configSchema.parse({
    port,
    database: ":memory:",
    chzzk: { redirectUri: `http://127.0.0.1:${port}/oauth/chzzk/callback` },
    soop: { redirectUri: `http://127.0.0.1:${port}/oauth/soop/callback` },
  }),
  {
    demo: true,
    adminToken: admin,
    readerToken: reader,
    encryptionKey: "e".repeat(64),
    chatgptTokenPath: join(chatgptDir, "tokens"),
    chzzkTokenPath: join(chatgptDir, "chzzk.tokens"),
    soopTokenPath: join(chatgptDir, "soop.tokens"),
    startInputs: false,
  },
);
await app.listen({ port, host: "127.0.0.1" });
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
const origin = `http://127.0.0.1:${port}`;
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
context.on("page", (page) => {
  page.on("pageerror", (e) => errors.push(e.message));
});
try {
  const adminPage = await context.newPage();
  await adminPage.goto(`${origin}/admin`);
  await adminPage.getByLabel("Access token").fill(admin);
  await adminPage.getByRole("button", { name: "Connect", exact: true }).click();
  await adminPage.getByRole("heading", { name: "Broadcast studio" }).waitFor();
  await adminPage.reload();
  await adminPage.getByRole("heading", { name: "Broadcast studio" }).waitFor();
  assert(
    (
      await adminPage.evaluate(async () =>
        document.fonts.load('16px "Noto Sans KR Variable"', "한글"),
      )
    ).length > 0,
  );
  const dashboard = adminPage.getByRole("region", {
    name: "방송 상태 및 AI 제어",
  });
  await expect(dashboard).toBeVisible();
  assert(
    await adminPage.evaluate(() =>
      document
        .querySelector("main.admin section")
        ?.classList.contains("operations-dashboard"),
    ),
  );
  for (const heading of ["송출 화면", "실제 채팅 정보", "음성 인식 transcript"])
    await expect(
      dashboard.getByRole("heading", { name: heading }),
    ).toBeVisible();
  const aiToggle = dashboard.getByRole("switch", { name: "AI 채팅 생성 사용" });
  await expect(aiToggle).toHaveAttribute("aria-checked", "false");
  const chatSummary = dashboard.locator("article").filter({
    has: adminPage.getByRole("heading", { name: "실제 채팅 정보" }),
  });
  const advanced = adminPage.locator("#advanced-settings");
  await expect(advanced).not.toHaveAttribute("open", "");
  await expect(adminPage.locator("#connection-details")).not.toBeVisible();
  await adminPage.route("**/api/admin/status", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.connectors = {
      youtube: { state: "subscribed:grpc", received: 123 },
      chzzk: { state: "subscribed" },
      soop: { state: "disabled" },
    };
    await route.fulfill({ json: body });
  });
  await dashboard.getByRole("button", { name: "상태 다시 확인" }).click();
  await expect(chatSummary.getByText("정상", { exact: true })).toBeVisible();
  assert(!/YOUTUBE|subscribed|grpc|123/.test(await chatSummary.innerText()));
  assert(
    !/requests|last frame|reserved|mock/.test(await dashboard.innerText()),
  );
  await adminPage.unroute("**/api/admin/status");
  await adminPage.route("**/api/admin/status", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.connectors = {
      youtube: { state: "permission_blocked" },
      chzzk: { state: "subscribed" },
      soop: { state: "disabled" },
    };
    await route.fulfill({ json: body });
  });
  await dashboard.getByRole("button", { name: "상태 다시 확인" }).click();
  await expect(
    chatSummary.getByText("확인 필요", { exact: true }),
  ).toBeVisible();
  await expect(
    chatSummary.getByText("유튜브: 계정의 접근 권한을 확인해 주세요."),
  ).toBeVisible();
  assert(!(await chatSummary.innerText()).includes("permission_blocked"));
  await chatSummary
    .getByRole("link", { name: "채팅 연결 및 수신 제어" })
    .click();
  await expect(advanced).toHaveAttribute("open", "");
  await expect(adminPage.locator("#connection-details")).toBeVisible();
  await advanced.locator(":scope > summary").click();
  await adminPage.unroute("**/api/admin/status");
  // Missing optional and nested status fields must not crash the admin page.
  await adminPage.route("**/api/admin/status", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    delete body.setup;
    delete body.audio;
    delete body.ai.input;
    delete body.ai.gate;
    await route.fulfill({ json: body });
  });
  await dashboard.getByRole("button", { name: "상태 다시 확인" }).click();
  await expect(
    dashboard.getByText("최신 자막 상태를 확인할 수 없습니다"),
  ).toBeVisible();
  await adminPage.unroute("**/api/admin/status");
  // An old response disables start but keeps emergency stop available.
  await adminPage.route("**/api/admin/status", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), generatedAt: Date.now() - 60000 },
    });
  });
  await dashboard.getByRole("button", { name: "상태 다시 확인" }).click();
  await expect(
    dashboard.getByText("상태 응답이 오래되었거나 확인되지 않았습니다"),
  ).toBeVisible();
  await expect(aiToggle).toBeDisabled();
  await expect(
    dashboard.getByRole("button", { name: "AI 긴급 중지" }),
  ).toBeEnabled();
  await adminPage.unroute("**/api/admin/status");
  await dashboard.getByRole("button", { name: "상태 다시 확인" }).click();
  await expect(aiToggle).toBeEnabled();
  const readerPage = await context.newPage(),
    overlay = await context.newPage();
  await readerPage.goto(`${origin}/reader#${reader}`);
  await overlay.goto(`${origin}/overlay#${reader}`);
  await readerPage.getByText("Connected", { exact: false }).waitFor();
  const timing: number[] = [];
  for (let i = 0; i < 12; i++) {
    const start = performance.now();
    store.grantConsent(
      (["youtube", "chzzk", "soop"] as const)[i % 3],
      "fixture",
      `fixture-${i % 3}`,
    );
    store.ingestBatch([
      {
        platform: (["youtube", "chzzk", "soop"] as const)[i % 3],
        channel: "fixture",
        author: `fixture-${i % 3}`,
        name: `Demo viewer ${i % 3}`,
        sourceId: `fixture-${i}`,
        text:
          i === 11
            ? "<script>window.untrusted=true</script>"
            : `[DEMO] Shared message ${i + 1} · 안녕 🎨`,
      },
    ]);
    await readerPage.locator(".message").nth(i).waitFor();
    await overlay.locator(".message").nth(i).waitFor();
    timing.push(performance.now() - start);
  }
  const readerText = await readerPage
    .locator(".message-main p")
    .allTextContents();
  assert.deepEqual(
    readerText,
    await overlay.locator(".message-main p").allTextContents(),
  );
  assert.equal(
    await readerPage.evaluate(() => Object.hasOwn(window, "untrusted")),
    false,
  );
  assert.equal(
    await readerPage.locator("input:not([type=checkbox]),textarea").count(),
    0,
  );
  assert.equal(
    await overlay.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    ),
    "rgba(0, 0, 0, 0)",
  );
  assert.equal(
    await overlay.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    ),
    "rgba(0, 0, 0, 0)",
  );
  const notice = await overlay.locator(".disclosure").boundingBox();
  assert(notice && notice.y >= 0 && notice.y + notice.height < 1000);
  const hidden = store.snapshot().messages[4]!.id;
  store.hide(hidden);
  await readerPage
    .locator(`[data-message-id="${hidden}"]`)
    .waitFor({ state: "detached" });
  await overlay.reload();
  await overlay.locator(".message").nth(10).waitFor();
  assert.equal(
    await overlay.locator(`[data-message-id="${hidden}"]`).count(),
    0,
  );
  capture.start();
  for (let i = 0; i < 50 && !capture.latest(); i++)
    await new Promise((r) => setTimeout(r, 50));
  await dashboard.getByRole("link", { name: "영상 설정 및 제어" }).click();
  await adminPage
    .getByRole("button", { name: "Confirm masked Program", exact: true })
    .click();
  await adminPage.getByText("Preview confirmed", { exact: false }).waitFor();
  await aiToggle.focus();
  await adminPage.keyboard.press("Space");
  await expect(aiToggle).toHaveAttribute("aria-checked", "true");

  await readerPage
    .getByText("[DEMO] 도형이 움직이는 인공 화면이에요.", { exact: true })
    .waitFor();
  await overlay
    .getByText("[DEMO] 도형이 움직이는 인공 화면이에요.", { exact: true })
    .waitFor();
  assert.equal(await adminPage.getByText("AWAITING REVIEW").count(), 0);
  for (const page of [readerPage, overlay]) {
    assert.equal(await page.locator(".message .badge").count(), 0);
    for (const name of await page
      .locator(".message-meta strong")
      .allTextContents())
      assert.match(name, /^시청자-[0-9a-f]{8}$/);
  }
  await overlay.reload();
  await overlay
    .getByText("[DEMO] 도형이 움직이는 인공 화면이에요.", { exact: true })
    .waitFor();
  assert.equal(await overlay.locator(".message .badge").count(), 0);
  await aiToggle.click();
  await expect(aiToggle).toHaveAttribute("aria-checked", "false");
  store.grantConsent("youtube", "fixture", "viewer");
  store.ingestBatch([
    {
      platform: "youtube",
      channel: "fixture",
      author: "viewer",
      name: "Demo viewer",
      text: "[DEMO] Receiver continues after AI stop",
    },
  ]);
  await readerPage
    .getByText("[DEMO] Receiver continues after AI stop")
    .waitFor();
  adminPage.once("dialog", (dialog) => void dialog.dismiss());
  await dashboard
    .getByRole("button", { name: "AI 채팅에 ‘AI 생성’ 표시하기" })
    .click();
  assert.equal(store.originsRevealed(), false);
  adminPage.once("dialog", (dialog) => void dialog.accept());
  await dashboard
    .getByRole("button", { name: "AI 채팅에 ‘AI 생성’ 표시하기" })
    .click();
  await expect(
    dashboard.getByText("AI 채팅에 ‘AI 생성’ 표시 중", { exact: true }),
  ).toBeVisible();
  await expect(
    dashboard.getByRole("button", { name: "AI 채팅에 ‘AI 생성’ 표시하기" }),
  ).toHaveCount(0);
  await readerPage.getByText("AI 생성", { exact: true }).waitFor();
  await overlay.getByText("AI 생성", { exact: true }).waitFor();
  assert((await readerPage.locator(".message .badge.experiment").count()) > 0);
  await advanced.locator(":scope > summary").click();
  mkdirSync("test-results", { recursive: true });
  await adminPage.evaluate(() => scrollTo(0, 0));
  await adminPage.screenshot({ path: "test-results/admin-dashboard.png" });
  await adminPage.screenshot({
    path: "test-results/admin.png",
    fullPage: true,
  });
  await readerPage.screenshot({
    path: "test-results/reader.png",
    fullPage: true,
  });
  await overlay.screenshot({
    path: "test-results/overlay.png",
    omitBackground: true,
  });
  await adminPage.setViewportSize({ width: 390, height: 844 });
  await adminPage.evaluate(() => scrollTo(0, 0));
  await expect(aiToggle).toBeInViewport();
  await expect(
    dashboard.getByText("AI 채팅에 ‘AI 생성’ 표시 중", { exact: true }),
  ).toBeInViewport();
  assert(
    await adminPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await adminPage.screenshot({
    path: "test-results/admin-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  const sorted = timing.sort((a, b) => a - b);
  const report = {
    status: "PASS",
    browser: browser.version(),
    messages: 12,
    receiveToBothDomP95Ms: Math.round(
      sorted[Math.ceil(sorted.length * 0.95) - 1],
    ),
    errors,
    screenshots: [
      "admin",
      "admin-dashboard",
      "reader",
      "overlay",
      "admin-mobile",
    ],
  };
  writeFileSync(
    "test-results/browser-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await app.close();
  rmSync(chatgptDir, { recursive: true, force: true });
}
