import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { configSchema } from "../packages/config.ts";
import { createApp } from "../apps/server/app.ts";
const port = 33219;
const admin = "a".repeat(64),
  reader = "r".repeat(64);
const { app, store, capture } = await createApp(
  configSchema.parse({ port, database: ":memory:" }),
  {
    demo: true,
    adminToken: admin,
    readerToken: reader,
    encryptionKey: "e".repeat(64),
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
  await adminPage.getByText("AWAITING REVIEW").waitFor();
  await adminPage.getByRole("button", { name: "Publish locally" }).click();
  await readerPage
    .getByText("[DEMO] 도형이 움직이는 인공 화면이에요.", { exact: true })
    .waitFor();
  await overlay
    .getByText("[DEMO] 도형이 움직이는 인공 화면이에요.", { exact: true })
    .waitFor();
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
}
