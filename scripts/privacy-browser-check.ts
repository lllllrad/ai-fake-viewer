import type { Browser } from "@playwright/test";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createApp } from "../apps/server/app.ts";
import { configSchema } from "../packages/config.ts";
import { approvedProfile, privacyMessage } from "../tests/privacy-fixtures.ts";

export async function checkPrivacyUI(browser: Browser, dir: string) {
  const port = 33220,
    token = "p".repeat(64);
  const { app, store } = await createApp(
    configSchema.parse({
      port,
      privacy: {
        ...approvedProfile(),
        processing: {
          ...approvedProfile().processing,
          provider: "chatgpt_subscription",
          contract: "ChatGPT subscription",
        },
      },
      ai: { provider: "chatgpt_subscription" },
      chzzk: { redirectUri: `http://127.0.0.1:${port}/oauth/chzzk/callback` },
      soop: {
        mode: "official",
        streamerId: "fixture",
        redirectUri: `http://127.0.0.1:${port}/oauth/soop/callback`,
      },
    }),
    {
      demo: false,
      startInputs: false,
      adminToken: token,
      readerToken: "q".repeat(64),
      encryptionKey: "e".repeat(64),
      chatgptTokenPath: join(dir, "live-chatgpt"),
      chzzkTokenPath: join(dir, "live-chzzk"),
      soopTokenPath: join(dir, "live-soop"),
    },
  );
  const context = await browser.newContext();
  const errors: string[] = [];
  try {
    await app.listen({ port, host: "127.0.0.1" });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/admin`);
    await page.getByLabel("Access token").fill(token);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    const panel = page.getByRole("region", { name: "개인정보 및 참여 관리" });
    await expect(panel).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Continue with ChatGPT",
        includeHidden: true,
      }),
    ).toHaveCount(1);
    await page.route("**/api/admin/soop/chat-session", (route) =>
      route.fulfill({
        json: {
          clientId: "synthetic",
          accessToken: "synthetic",
          streamerId: "fixture",
        },
      }),
    );
    await page.route("**/api/admin/status", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.setup.soop.tokenConfigured = true;
      data.setup.soop.credentialsConfigured = true;
      await route.fulfill({ json: data });
    });
    await page.getByRole("button", { name: "상태 다시 확인" }).click();
    await page.route(
      "https://static.sooplive.com/asset/app/chat-sdk/sooplive-chat-sdk.js",
      (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: `
      window.__fixedNotices = [];
      window.SOOP = {ChatSDK: class {
        setAuth() {} handleReady(fn) {this.ready=fn;}
        handleMessageReceived(fn) {this.message=fn;}
        handleChatClosed() {} handleError() {} disconnect() {}
        async connect(){this.ready?.();} async getRoomInfo(){return {bjId:"fixture"};}
        sendMessage(text){window.__fixedNotices.push(text);this.message?.("MESSAGE",{userId:"fixture",userNickname:"Synthetic broadcaster",message:text});}
      }};
    `,
        }),
    );
    await page.locator("#advanced-settings > summary").click();
    await expect(
      page.getByRole("button", { name: "Continue with ChatGPT" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Connect SOOP chat", exact: true })
      .click();
    await page.locator("#advanced-settings > summary").click();
    store.ingestBatch([
      privacyMessage(
        "browser-viewer",
        "PRIVATE_UNCONSENTED_FIXTURE",
        Date.now(),
        { platform: "soop" },
      ),
    ]);
    assert.equal(store.snapshot().messages.length, 0);
    await expect
      .poll(() => page.evaluate(() => (window as any).__fixedNotices.length))
      .toBe(1);
    assert(
      (await page.evaluate(() => (window as any).__fixedNotices[0])).includes(
        "방송 화면에 표시되거나 AI 입력으로 사용되지 않습니다",
      ),
    );

    store.ingestBatch([
      {
        ...privacyMessage("browser-viewer", "!동의", Date.now(), {
          platform: "soop",
        }),
        sourceId: undefined,
        publishedAt: undefined,
      },
    ]);
    await panel.getByText(/참여 안내·현재 동의 상태/).click();
    const confirm = panel.getByRole("button", {
      name: "수신된 새 동의 명령 확인",
    });
    await expect(confirm).toBeVisible({ timeout: 10000 });
    page.once("dialog", (d) => void d.accept());
    await confirm.click();
    await expect(panel.getByText(/단계별 동의 대기/)).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "안내 전달 완료 확인" }),
    ).toHaveCount(0);
    // Advance only the fixture account's send allowance, without sleeping through a real 30s limit.
    store.participation!.get(
      "soop",
      "fixture",
      "browser-viewer",
    )!.lastNoticeAt = 0;
    await expect
      .poll(
        () =>
          store.participation!.get("soop", "fixture", "browser-viewer")!
            .deliveredAt,
      )
      .not.toBeNull();
    assert.equal(
      store.participation!.get("soop", "fixture", "browser-viewer")!.state,
      "WAITING_CONSENT",
    );
    await panel
      .getByRole("button", { name: "14세 미만·신고 모순으로 참여 차단" })
      .click();
    await expect(panel.getByText(/철회됨 · 단계/)).toBeVisible();
    await panel.getByText(/권리행사·영상 후속 조치 \(/).click();
    await panel.getByLabel("대상 계정", { exact: true }).fill("browser-viewer");
    await panel
      .getByLabel("방송 세션", { exact: true })
      .fill("previous-synthetic-session");
    await panel.getByRole("button", { name: "요청 접수", exact: true }).click();
    const item = panel.locator("article").filter({
      has: page.getByRole("heading", {
        name: "soop · browser-viewer · 접수",
      }),
    });
    await expect(item).toBeVisible();
    await item.getByLabel("앱 조치 확인", { exact: true }).check();
    await item.getByLabel("진행 상태").selectOption("completed");
    await item.getByRole("button", { name: "처리 상태 저장" }).click();
    await expect(panel.getByRole("alert")).toContainText("각각 확인");
    await item.getByLabel("진행 상태").selectOption("external_pending");
    await item.getByRole("button", { name: "처리 상태 저장" }).click();
    await expect(
      panel.getByRole("heading", {
        name: "soop · browser-viewer · 외부·영상 조치 확인 중",
      }),
    ).toBeVisible();
    assert(
      !(await page.locator("body").innerText()).includes(
        "PRIVATE_UNCONSENTED_FIXTURE",
      ),
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
      })),
      { local: [], session: [] },
    );
    await page.screenshot({
      path: "test-results/privacy-admin.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.locator("#advanced-settings > summary").click();
    await page
      .getByRole("button", { name: "Disconnect SOOP", exact: true })
      .click();
    await expect
      .poll(() =>
        app
          .inject({
            method: "POST",
            url: "/api/admin/soop/notices/next",
            headers: { host: `127.0.0.1:${port}` },
          })
          .then((r) => r.statusCode),
      )
      .toBe(401);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await app.close();
  }
}
