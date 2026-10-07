import { captureUIReview } from "./ui-review.ts";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../packages/config.ts";
import { createApp } from "../apps/server/app.ts";
import { checkPrivacyUI } from "./privacy-browser-check.ts";
const port = 33219;
const chatgptDir = mkdtempSync(join(tmpdir(), "mixed-chat-browser-"));
const admin = "a".repeat(64),
  reader = "r".repeat(64);
const { app, store, capture, scheduler } = await createApp(
  configSchema.parse({
    port,
    youtube: { redirectUri: `http://127.0.0.1:${port}/oauth/youtube/callback` },
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
    youtubeTokenPath: join(chatgptDir, "youtube.tokens"),
    chzzkTokenPath: join(chatgptDir, "chzzk.tokens"),
    soopTokenPath: join(chatgptDir, "soop.tokens"),
    startInputs: false,
  },
);
// The browser fixture exercises publication, not probabilistic participation.
scheduler.random = () => 0;
await app.listen({ port, host: "127.0.0.1" });
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
const origin = `http://127.0.0.1:${port}`;
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
context.on("page", (page) => {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (/Content.Security.Policy|invalid source/i.test(message.text()))
      errors.push(message.text());
  });
});
try {
  const adminPage = await context.newPage();
  await adminPage.route("**/api/admin/status", (route) =>
    route.fulfill({
      status: 503,
      contentType: "text/html",
      body: "<html>Synthetic service unavailable</html>",
    }),
  );
  await adminPage.goto(`${origin}/admin`);
  await expect(
    adminPage.getByRole("button", { name: "연결 다시 확인" }),
  ).toBeVisible();
  await expect(adminPage.getByLabel("관리자 접속 토큰")).toHaveCount(0);
  await adminPage.unroute("**/api/admin/status");
  await adminPage.getByRole("button", { name: "연결 다시 확인" }).click();
  // Authentication uses the same single-flight action ownership as workspace commands.
  await captureUIReview(adminPage, "login");
  await adminPage.getByLabel("관리자 접속 토큰").fill("invalid-fixture");
  await adminPage
    .getByRole("button", { name: "연결하기", exact: true })
    .click();
  await expect(adminPage.getByRole("alert")).toBeVisible();
  await adminPage.getByLabel("관리자 접속 토큰").fill(admin);
  let releaseLogin!: () => void;
  const loginPending = new Promise<void>((resolve) => {
    releaseLogin = resolve;
  });
  let logins = 0;
  await adminPage.route("**/api/admin/login", async (route) => {
    logins++;
    await loginPending;
    await route.continue();
  });
  try {
    await adminPage
      .getByRole("button", { name: "연결하기", exact: true })
      .click();
    await expect.poll(() => logins).toBe(1);
    await expect(
      adminPage.getByRole("button", { name: "연결 중…" }),
    ).toBeDisabled();
    await expect(adminPage.getByLabel("관리자 접속 토큰")).toBeDisabled();
    await adminPage.locator("form").evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    releaseLogin();
    await adminPage
      .getByRole("heading", { name: "방송 운영", exact: true })
      .waitFor();
    assert.equal(logins, 1);
  } finally {
    releaseLogin();
    await adminPage.unroute("**/api/admin/login");
  }
  let releaseLogout!: () => void;
  const logoutPending = new Promise<void>((resolve) => {
    releaseLogout = resolve;
  });
  let logouts = 0;
  await adminPage.route("**/api/admin/logout", async (route) => {
    logouts++;
    await logoutPending;
    await route.continue();
  });
  try {
    await adminPage
      .getByRole("button", { name: "로그아웃", exact: true })
      .click();
    await expect.poll(() => logouts).toBe(1);
    const logoutButton = adminPage.getByRole("button", {
      name: "로그아웃 중…",
    });
    await expect(logoutButton).toBeDisabled();
    await logoutButton.evaluate((button: HTMLButtonElement) => button.click());
    releaseLogout();
    await expect(adminPage.getByLabel("관리자 접속 토큰")).toBeVisible();
    await expect(adminPage.getByLabel("관리자 접속 토큰")).toHaveValue("");
    await expect(
      adminPage.getByRole("navigation", { name: "운영 화면" }),
    ).toHaveCount(0);
    assert.equal(logouts, 1);
  } finally {
    releaseLogout();
    await adminPage.unroute("**/api/admin/logout");
  }
  await adminPage.getByLabel("관리자 접속 토큰").fill(admin);
  await adminPage
    .getByRole("button", { name: "연결하기", exact: true })
    .click();
  await adminPage
    .getByRole("heading", { name: "방송 운영", exact: true })
    .waitFor();
  await adminPage.reload();
  await adminPage.getByRole("heading", { name: "방송 운영" }).waitFor();
  // Keyboard navigation and direct details links move focus after status has loaded.
  const workspaceNavigation = adminPage.getByRole("navigation", {
    name: "운영 화면",
  });
  await workspaceNavigation
    .getByRole("link", { name: "방송 준비", exact: true })
    .focus();
  await adminPage.keyboard.press("Enter");
  await expect(
    adminPage.getByRole("heading", { name: "연결 및 입력 설정" }),
  ).toBeFocused();
  const setupTabs = adminPage.getByRole("tablist", { name: "방송 준비 항목" });
  await setupTabs
    .getByRole("tab", { name: "채팅 플랫폼", exact: true })
    .focus();
  await adminPage.keyboard.press("ArrowRight");
  await expect(
    setupTabs.getByRole("tab", { name: "화면·음성", exact: true }),
  ).toBeFocused();
  await expect(
    setupTabs.getByRole("tab", { name: "화면·음성", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await adminPage.keyboard.press("ArrowRight");
  await expect(
    setupTabs.getByRole("tab", { name: "AI 계정·모델", exact: true }),
  ).toBeFocused();
  await adminPage.goto(`${origin}/admin#audio-details`);
  await adminPage.reload();
  await expect(
    adminPage.getByRole("heading", { name: "음성 전사 · Groq" }),
  ).toBeFocused();
  await adminPage.goto(`${origin}/admin#program-details`);
  await expect(
    adminPage.getByRole("heading", { name: "송출 화면 입력", exact: true }),
  ).toBeFocused();
  await workspaceNavigation
    .getByRole("link", { name: "라이브", exact: true })
    .focus();
  await adminPage.keyboard.press("Enter");
  await expect(
    adminPage.getByRole("heading", { name: "AI 채팅 생성", exact: true }),
  ).toBeFocused();
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
        .querySelector("#broadcast section")
        ?.classList.contains("operations-dashboard"),
    ),
  );
  for (const heading of ["송출 화면", "실제 채팅 정보", "음성 자막"])
    await expect(
      dashboard.getByRole("heading", { name: heading }),
    ).toBeVisible();
  const aiToggle = dashboard.getByRole("switch", { name: "AI 채팅 생성 사용" });
  await expect(aiToggle).toHaveAttribute("aria-checked", "false");
  // Status updates must not restart a slow preview request or retain stale images.
  let releasePreview!: () => void;
  const previewPending = new Promise<void>((resolve) => {
    releasePreview = resolve;
  });
  let previewRequests = 0;
  let previewStale = false;
  await adminPage.route("**/api/admin/status", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.capture.lastFrameAt = Date.now();
    body.capture.lastFrameAgeMs = 0;
    if (previewStale) body.generatedAt = Date.now() - 60000;
    await route.fulfill({ json: body });
  });
  await adminPage.route("**/api/admin/preview", async (route) => {
    previewRequests++;
    await previewPending;
    await route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  });
  try {
    await dashboard.getByRole("button", { name: "상태 다시 확인" }).click();
    await expect.poll(() => previewRequests).toBe(1);
    for (let i = 0; i < 3; i++) {
      const received = adminPage.waitForResponse("**/api/admin/status");
      await dashboard.getByRole("button", { name: "상태 다시 확인" }).click();
      await received;
    }
    releasePreview();
    const previewImage = adminPage.getByAltText("송출 화면 미리보기");
    await expect(previewImage).toBeVisible();
    await expect
      .poll(() =>
        previewImage.evaluate(
          (node) => (node as HTMLImageElement).naturalWidth,
        ),
      )
      .toBe(1);
    assert.equal(previewRequests, 1);
    previewStale = true;
    await dashboard.getByRole("button", { name: "상태 다시 확인" }).click();
    await expect(previewImage).toHaveCount(0);
  } finally {
    releasePreview();
    await adminPage.unroute("**/api/admin/status");
    await adminPage.unroute("**/api/admin/preview");
  }
  const chatSummary = dashboard.locator("article").filter({
    has: adminPage.getByRole("heading", { name: "실제 채팅 정보" }),
  });
  const navigation = adminPage.getByRole("navigation", { name: "운영 화면" });
  await expect(
    navigation.getByRole("link", { name: "라이브", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(adminPage.locator("#connection-details")).not.toBeVisible();
  await adminPage.route("**/api/admin/status", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.connectors = {
      youtube: {
        ...body.connectors.youtube,
        state: "subscribed:grpc",
        received: 123,
      },
      chzzk: { ...body.connectors.chzzk, state: "subscribed" },
      soop: { ...body.connectors.soop, state: "disabled" },
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
      youtube: { ...body.connectors.youtube, state: "permission_blocked" },
      chzzk: { ...body.connectors.chzzk, state: "subscribed" },
      soop: { ...body.connectors.soop, state: "disabled" },
    };
    await route.fulfill({ json: body });
  });
  await dashboard.getByRole("button", { name: "상태 다시 확인" }).click();
  await expect(
    chatSummary.getByText("확인 필요", { exact: true }),
  ).toBeVisible();
  await chatSummary.locator("summary").click();
  await expect(
    chatSummary.getByText("유튜브: 계정의 접근 권한을 확인해 주세요."),
  ).toBeVisible();
  assert(!(await chatSummary.innerText()).includes("permission_blocked"));
  await chatSummary
    .getByRole("link", { name: "채팅 연결 및 수신 제어" })
    .click();
  await expect(
    navigation.getByRole("link", { name: "방송 준비", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(adminPage.locator("#connection-details")).toBeVisible();
  await navigation.getByRole("link", { name: "라이브", exact: true }).click();
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
  await dashboard
    .locator("article")
    .filter({
      has: adminPage.getByRole("heading", { name: "음성 자막", exact: true }),
    })
    .locator("summary")
    .click();
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
  // Emergency stop remains usable during another command, without duplicate writes
  // or clearing the other command's pending state when stop finishes first.
  let releaseInput!: () => void;
  let releaseStop!: () => void;
  const inputPending = new Promise<void>((resolve) => {
    releaseInput = resolve;
  });
  const stopPending = new Promise<void>((resolve) => {
    releaseStop = resolve;
  });
  let inputCommands = 0;
  let stopCommands = 0;
  await adminPage.route("**/api/admin/pipeline/start", async (route) => {
    inputCommands++;
    await inputPending;
    await route.fulfill({ json: { ok: true } });
  });
  await adminPage.route("**/api/admin/ai/stop", async (route) => {
    stopCommands++;
    await stopPending;
    await route.fulfill({ json: { ok: true } });
  });
  const startInputs = dashboard.getByRole("button", {
    name: "필수 입력 시작",
    exact: true,
  });
  const emergencyStop = dashboard.getByRole("button", {
    name: "AI 긴급 중지",
    exact: true,
  });
  try {
    await startInputs.click();
    await expect.poll(() => inputCommands).toBe(1);
    await expect(startInputs).toBeDisabled();
    await expect(emergencyStop).toBeEnabled();
    await emergencyStop.dblclick();
    await expect.poll(() => stopCommands).toBe(1);
    const stopResponse = adminPage.waitForResponse("**/api/admin/ai/stop");
    releaseStop();
    await stopResponse;
    await dashboard.getByRole("button", { name: "상태 다시 확인" }).click();
    await expect(startInputs).toBeDisabled();
    releaseInput();
    await expect(startInputs).toBeEnabled();
    assert.equal(inputCommands, 1);
    assert.equal(stopCommands, 1);
  } finally {
    releaseInput();
    releaseStop();
    await adminPage.unroute("**/api/admin/pipeline/start");
    await adminPage.unroute("**/api/admin/ai/stop");
  }
  // Pending drafts are operated from the broadcast screen, independently of connection details.
  let rejected = false;
  await adminPage.route("**/api/admin/status", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.ai.pending = rejected
      ? null
      : { text: "Synthetic pending draft", expires: Date.now() + 30_000 };
    await route.fulfill({ json: body });
  });
  await adminPage.route("**/api/admin/ai/reject", (route) => {
    rejected = true;
    return route.fulfill({ json: { ok: true } });
  });
  await dashboard.getByRole("button", { name: "상태 다시 확인" }).click();
  await expect(
    adminPage.getByRole("region", { name: "AI 메시지 검토" }),
  ).toBeVisible();
  await adminPage
    .getByRole("button", { name: "초안 버리기", exact: true })
    .click();
  await expect(
    adminPage.getByRole("region", { name: "AI 메시지 검토" }),
  ).toHaveCount(0);
  assert(rejected);
  await adminPage.unroute("**/api/admin/status");
  await adminPage.unroute("**/api/admin/ai/reject");
  const readerPage = await context.newPage(),
    overlay = await context.newPage();
  await readerPage.goto(`${origin}/reader#${reader}`);
  await overlay.goto(`${origin}/overlay#${reader}`);
  await readerPage.getByText("연결됨", { exact: true }).waitFor();
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
            : `[DEMO] Shared message ${i + 1} · 코드 오류? 안녕 🎨`,
      },
    ]);
    await readerPage.locator("[data-message-id]").nth(i).waitFor();
    await overlay.locator("[data-message-id]").nth(i).waitFor();
    timing.push(performance.now() - start);
  }
  await adminPage.getByRole("tab", { name: "대화 요약", exact: true }).click();
  const summaryCard = adminPage.getByRole("region", { name: "익명 채팅 요약" });
  await expect(
    summaryCard.getByText("주제: 개발·기술", { exact: true }),
  ).toBeVisible();
  await expect(
    summaryCard.getByText("분위기: 질문이 오감", { exact: true }),
  ).toBeVisible();
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/admin/chat-summary/clear",
        headers: { host: `127.0.0.1:${port}` },
      })
    ).statusCode,
    401,
  );
  await summaryCard.getByRole("button", { name: "채팅 요약 초기화" }).click();
  await expect(
    summaryCard.getByText("공통 분위기를 요약할 채팅이 아직 부족합니다.", {
      exact: true,
    }),
  ).toBeVisible();
  await captureUIReview(adminPage, "live");
  await captureUIReview(readerPage, "reader");
  await captureUIReview(overlay, "overlay");
  const readerText = await readerPage
    .locator(".conversation-content p")
    .allTextContents();
  assert.deepEqual(
    readerText,
    await overlay.locator(".conversation-content p").allTextContents(),
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
  const notice = await overlay
    .locator(".conversation-disclosure")
    .boundingBox();
  assert(notice && notice.y >= 0 && notice.y + notice.height < 1000);
  const hidden = store.snapshot().messages[4]!.id;
  await adminPage
    .locator(".operator-message")
    .filter({ hasText: "[DEMO] Shared message 5 ·" })
    .getByRole("button", { name: /채팅 숨기기/ })
    .click();
  assert(!store.snapshot().messages.some((message) => message?.id === hidden));
  await readerPage
    .locator(`[data-message-id="${hidden}"]`)
    .waitFor({ state: "detached" });
  await overlay.reload();
  await overlay.locator("[data-message-id]").nth(10).waitFor();
  assert.equal(
    await overlay.locator(`[data-message-id="${hidden}"]`).count(),
    0,
  );
  capture.start();
  for (let i = 0; i < 50 && !capture.latest(); i++)
    await new Promise((r) => setTimeout(r, 50));
  await expect(
    adminPage.getByRole("button", {
      name: /마스크 확인|Confirm masked Program/,
    }),
  ).toHaveCount(0);
  await aiToggle.focus();
  await adminPage.keyboard.press("Space");
  await expect(aiToggle).toHaveAttribute("aria-checked", "true");
  await adminPage.getByRole("tab", { name: "AI 시청자", exact: true }).click();
  await expect(
    adminPage.getByRole("heading", { name: "자동 시청자 페르소나" }),
  ).toBeVisible();
  const castSummary = adminPage.getByText("페르소나 6명 보기", { exact: true });
  await expect(castSummary).toBeVisible();
  await castSummary.click();
  await expect(adminPage.locator(".persona-candidate")).toHaveCount(6);
  await expect(
    adminPage.getByRole("button", { name: /후보 생성|오디션|새 브리프/ }),
  ).toHaveCount(0);
  await castSummary.click();

  await readerPage
    .getByText("[DEMO] 도형이 움직이는 인공 화면이에요.", { exact: true })
    .waitFor();
  await overlay
    .getByText("[DEMO] 도형이 움직이는 인공 화면이에요.", { exact: true })
    .waitFor();
  await expect(adminPage.getByText("AWAITING REVIEW")).toHaveCount(0);
  for (const page of [readerPage, overlay]) {
    assert.equal(await page.locator(".conversation-origin").count(), 0);
    for (const name of await page
      .locator(".conversation-meta strong")
      .allTextContents())
      assert(name.length > 0 && !/^시청자-[0-9a-f]{8}$/.test(name));
  }
  await overlay.reload();
  await overlay
    .getByText("[DEMO] 도형이 움직이는 인공 화면이에요.", { exact: true })
    .waitFor();
  assert.equal(await overlay.locator(".conversation-origin").count(), 0);
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
  await dashboard
    .getByRole("button", { name: "AI 채팅에 ‘AI 생성’ 표시하기" })
    .click();
  await expect(adminPage.getByRole("alertdialog")).toBeVisible();
  await captureUIReview(adminPage, "disclosure-dialog");
  await expect(
    adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "취소", exact: true }),
  ).toBeFocused();
  await adminPage.keyboard.press("Escape");
  await expect(adminPage.getByRole("alertdialog")).toHaveCount(0);
  await expect(
    dashboard.getByRole("button", { name: "AI 채팅에 ‘AI 생성’ 표시하기" }),
  ).toBeFocused();
  assert.equal(store.originsRevealed(), false);
  await dashboard
    .getByRole("button", { name: "AI 채팅에 ‘AI 생성’ 표시하기" })
    .click();
  await adminPage
    .getByRole("alertdialog")
    .getByRole("button", { name: "AI 생성 표시하기", exact: true })
    .click();
  await expect(
    dashboard.getByText("AI 채팅에 ‘AI 생성’ 표시 중", { exact: true }),
  ).toBeVisible();
  await expect(
    dashboard.getByRole("button", { name: "AI 채팅에 ‘AI 생성’ 표시하기" }),
  ).toHaveCount(0);
  await readerPage.getByText("AI 생성", { exact: true }).waitFor();
  await overlay.getByText("AI 생성", { exact: true }).waitFor();
  assert((await readerPage.locator(".conversation-origin").count()) > 0);
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
  // The latest entry must stay on the OBS canvas even when older rows overflow.
  await expect(
    overlay.getByText("[DEMO] Receiver continues after AI stop"),
  ).toBeInViewport();
  await overlay.setViewportSize({ width: 390, height: 600 });
  await expect(
    overlay.getByText("[DEMO] Receiver continues after AI stop"),
  ).toBeInViewport();
  await readerPage.setViewportSize({ width: 390, height: 844 });
  assert(
    await readerPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await readerPage.screenshot({
    path: "test-results/reader-mobile.png",
    fullPage: true,
  });
  const accessPage = await context.newPage();
  await accessPage.goto(`${origin}/reader`);
  await accessPage.getByLabel("리더 접속 토큰").fill("invalid-fixture-token");
  await accessPage.getByRole("button", { name: "채팅 열기" }).click();
  await expect(accessPage.getByRole("alert")).toContainText("접속 권한");
  await accessPage.getByLabel("리더 접속 토큰").fill(reader);
  await accessPage.getByRole("button", { name: "채팅 열기" }).click();
  await expect(accessPage.getByText("연결됨", { exact: true })).toBeVisible();
  await expect(
    accessPage.getByText("[DEMO] Receiver continues after AI stop"),
  ).toBeVisible();
  await accessPage.close();
  await navigation
    .getByRole("link", { name: "방송 준비", exact: true })
    .click();
  await adminPage.getByRole("tab", { name: "리더·OBS", exact: true }).click();
  const readerLinks = adminPage.getByRole("region", {
    name: "리더와 OBS 연결",
  });
  await readerLinks.getByRole("button", { name: "리더·OBS 링크 보기" }).click();
  await expect(
    readerLinks.getByLabel("리더 링크", { exact: true }),
  ).toHaveValue(`${origin}/reader#${reader}`);
  await expect(
    readerLinks.getByLabel("OBS 오버레이 링크", { exact: true }),
  ).toHaveValue(`${origin}/overlay#${reader}`);
  await adminPage.screenshot({
    path: "test-results/admin-connections.png",
    fullPage: true,
  });
  await captureUIReview(adminPage, "output");
  for (const [tab, file] of [
    ["채팅 플랫폼", "platforms"],
    ["화면·음성", "media"],
    ["AI 계정·모델", "ai"],
  ] as const) {
    await adminPage.getByRole("tab", { name: tab, exact: true }).click();
    await captureUIReview(adminPage, file);
  }
  await navigation.getByRole("link", { name: "라이브", exact: true }).click();
  await adminPage.setViewportSize({ width: 390, height: 844 });
  await adminPage.evaluate(() => scrollTo(0, 0));
  await expect(aiToggle).toBeInViewport();
  await expect(
    adminPage.getByRole("button", { name: "AI 긴급 중지" }),
  ).toBeInViewport();
  assert(
    await adminPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await adminPage.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect(
    adminPage.getByRole("button", { name: "AI 긴급 중지" }),
  ).toBeInViewport();
  await navigation
    .getByRole("link", { name: "기록·권리", exact: true })
    .click();
  await expect(
    adminPage.getByRole("button", { name: "AI 긴급 중지" }),
  ).toBeInViewport();
  await adminPage.getByRole("button", { name: "AI 긴급 중지" }).click();
  await navigation.getByRole("link", { name: "라이브", exact: true }).click();
  await adminPage.evaluate(() => scrollTo(0, 0));
  await adminPage.screenshot({
    path: "test-results/admin-mobile.png",
    fullPage: true,
  });

  await adminPage
    .getByRole("button", { name: "방송 종료", exact: true })
    .click();
  await adminPage
    .getByRole("alertdialog")
    .getByRole("button", { name: "취소", exact: true })
    .click();
  assert.equal(store.closed(), false);

  await adminPage
    .getByRole("button", { name: "방송 종료", exact: true })
    .click();
  await adminPage
    .getByRole("alertdialog")
    .getByRole("button", { name: "방송 종료", exact: true })
    .click();
  await expect(
    adminPage
      .getByRole("region", { name: "최근 방송 대화" })
      .getByText("방송이 종료되어 대화 기록을 비웠습니다."),
  ).toBeVisible();
  await expect(readerPage.locator("[data-message-id]")).toHaveCount(0);
  await expect(overlay.locator("[data-message-id]")).toHaveCount(0);
  await expect(aiToggle).toHaveAttribute("aria-checked", "false");
  const endedSessionId = store.sessionId;
  await dashboard
    .getByRole("button", { name: "새 방송 세션", exact: true })
    .click();
  await expect(aiToggle).toHaveAttribute("aria-checked", "false");
  await expect(
    dashboard.getByRole("button", { name: "새 방송 세션", exact: true }),
  ).toHaveCount(0);
  assert.notEqual(store.sessionId, endedSessionId);
  await expect(
    adminPage.getByText("[DEMO] Receiver continues after AI stop", {
      exact: true,
    }),
  ).toHaveCount(0);
  await checkPrivacyUI(browser, chatgptDir);
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
      "privacy-admin",
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
