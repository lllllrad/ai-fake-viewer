import { chromium } from "@playwright/test";
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
  await adminPage.getByRole("button", { name: "Authorize CHZZK" }).click();
  await adminPage
    .getByRole("alert")
    .getByText("Demo mode uses artificial inputs", { exact: false })
    .waitFor();
  await adminPage.getByRole("button", { name: "Dismiss" }).click();
  const readerPage = await context.newPage(),
    overlay = await context.newPage();
  await readerPage.goto(`${origin}/reader#${reader}`);
  await overlay.goto(`${origin}/overlay#${reader}`);
  await readerPage.getByText("Connected", { exact: false }).waitFor();
  const timing: number[] = [];
  for (let i = 0; i < 12; i++) {
    const start = performance.now();
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
  await adminPage
    .getByRole("button", { name: "Confirm masked Program", exact: true })
    .click();
  await adminPage.getByText("Preview confirmed", { exact: false }).waitFor();
  await adminPage
    .getByRole("button", { name: "Start AI", exact: true })
    .click();

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
  await adminPage.getByRole("button", { name: "■ Stop AI now" }).click();
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
  await adminPage
    .getByRole("button", { name: "Stop AI & reveal origins", exact: true })
    .click();
  await readerPage.getByText("System generated", { exact: true }).waitFor();
  await overlay.getByText("System generated", { exact: true }).waitFor();
  assert((await readerPage.locator(".message .badge.experiment").count()) > 0);
  mkdirSync("test-results", { recursive: true });
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
    screenshots: ["admin", "reader", "overlay", "admin-mobile"],
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
