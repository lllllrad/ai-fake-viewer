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
      database: ":memory:",
      port,
      youtube: {
        enabled: true,
        redirectUri: `http://127.0.0.1:${port}/oauth/youtube/callback`,
      },
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
      youtubeTokenPath: join(dir, "youtube.tokens"),
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
    page.on("console", (message) => {
      if (/Content.Security.Policy|invalid source/i.test(message.text()))
        errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${port}/admin`);
    await page.getByLabel("관리자 접속 토큰").fill(token);
    await page.getByRole("button", { name: "연결하기", exact: true }).click();
    const navigation = page.getByRole("navigation", { name: "운영 화면" });
    await navigation.getByRole("link", { name: "참여", exact: true }).click();
    const panel = page.getByRole("region", { name: "개인정보 및 참여 관리" });
    await expect(panel).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "음성 전사 시작",
        exact: true,
        includeHidden: true,
      }),
    ).toBeEnabled();
    await expect(
      page.getByRole("link", { name: "전사문 내보내기", includeHidden: true }),
    ).toHaveAttribute("href", "/api/admin/transcripts/export");
    await expect(
      page.getByRole("button", {
        name: "Sign in with ChatGPT",
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
      data.setup.youtube.oauthConfigured = true;
      data.setup.soop.tokenConfigured = true;
      data.setup.soop.credentialsConfigured = true;
      await route.fulfill({ json: data });
    });
    await navigation.getByRole("link", { name: "방송", exact: true }).click();
    await page.getByRole("button", { name: "상태 다시 확인" }).click();
    await page.route(
      "https://static.sooplive.com/asset/app/chat-sdk/sooplive-chat-sdk.js",
      (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: `
      window.__fixedNotices = []; window.__soopConnections = 0; window.__soopDisconnects = 0;
      window.SOOP = {ChatSDK: class {
        setAuth() {} handleReady(fn) {this.ready=fn;}
        handleMessageReceived(fn) {this.message=fn;}
        handleChatClosed() {} handleError() {} disconnect() {window.__soopDisconnects++;}
        async connect(){window.__soopConnections++;this.ready?.();} async getRoomInfo(){return {bjId:"fixture"};}
        sendMessage(text){window.__fixedNotices.push(text);this.message?.("MESSAGE",{userId:"fixture",userNickname:"Synthetic broadcaster",message:text});}
      }};
    `,
        }),
    );
    await navigation.getByRole("link", { name: "연결", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "YouTube 계정 연결", exact: true }),
    ).toBeEnabled();

    await expect(
      page.getByRole("button", { name: "Sign in with ChatGPT" }),
    ).toBeVisible();
    const aiAccount = page.getByRole("region", { name: "AI 계정과 모델" });
    await page.route("**/api/admin/chatgpt/models", (route) =>
      route.fulfill({
        status: 502,
        contentType: "text/plain",
        body: "Synthetic upstream failure",
      }),
    );
    await aiAccount.getByRole("button", { name: "모델 목록 불러오기" }).click();
    await expect(aiAccount.getByRole("alert")).toContainText("502");
    await expect(
      page.getByRole("button", { name: "YouTube 계정 연결", exact: true }),
    ).toBeEnabled();
    await page.unroute("**/api/admin/chatgpt/models");
    await page.route("**/api/admin/chatgpt/models", (route) =>
      route.fulfill({
        json: { models: [{ slug: "fixture-model", name: "Synthetic model" }] },
      }),
    );
    let selectedModel = "";
    await page.route("**/api/admin/chatgpt/select-model", (route) => {
      selectedModel = route.request().postDataJSON().slug;
      return route.fulfill({ json: { ok: true } });
    });
    await aiAccount.getByRole("button", { name: "모델 목록 불러오기" }).click();
    await aiAccount
      .getByLabel("AI 모델", { exact: true })
      .selectOption("fixture-model");
    await expect.poll(() => selectedModel).toBe("fixture-model");
    await page
      .getByRole("button", { name: "SOOP 채팅 연결", exact: true })
      .click();
    const setupCard = page.getByRole("region", { name: "플랫폼 연결 준비" });
    const chzzkConnect = setupCard.getByRole("button", {
      name: "치지직 계정 연결 / 다시 인증",
      exact: true,
    });
    await expect(chzzkConnect).toBeVisible();
    // This fixture has CHZZK disabled; configuration status and its action stay together.
    await expect(chzzkConnect).toBeDisabled();
    await navigation.getByRole("link", { name: "참여", exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => ({
        connections: (window as any).__soopConnections,
        disconnects: (window as any).__soopDisconnects,
      })),
      { connections: 1, disconnects: 0 },
    );
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
        "미동의 제외",
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
    await expect(panel.getByText(/동의 완료/)).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "안내 전달 완료 확인" }),
    ).toHaveCount(0);
    assert.equal(
      store.participation!.get("soop", "fixture", "browser-viewer")!.state,
      "ACTIVE",
    );
    await panel
      .getByRole("button", { name: "14세 미만·신고 모순으로 참여 차단" })
      .click();
    await expect(panel.getByText(/철회됨 · 안내 대기/)).toBeVisible();
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
    // PC04/PC06: exercise real browser conversation surfaces with synthetic live consent.
    const readers = await Promise.all(
      ["reader", "overlay"].map(async (view) => {
        const reader = await context.newPage();
        reader.on("pageerror", (error) => errors.push(error.message));
        await reader.goto(`http://127.0.0.1:${port}/${view}#${"q".repeat(64)}`);
        return reader;
      }),
    );
    const surfaces = [page, ...readers];
    let stamp = Date.now();
    const message = (author: string, text: string) =>
      store.ingestBatch([privacyMessage(author, text, ++stamp)]);
    const participate = (author: string) => {
      message(author, "!동의");
      const person = store.participation!.get("youtube", "fixture", author)!;
      // Delivery is a fixture here; platform sender acknowledgements have separate tests.
      for (const _ of store.participation!.stages()) {
        person.lastNoticeAt = 0;
        store.participation!.delivered(person.id);
        stamp = Math.max(stamp, Date.now());
        message(author, "!동의");
      }
      assert.equal(person.state, "ACTIVE");
    };
    await navigation.getByRole("link", { name: "방송", exact: true }).click();
    message("unconsented-browser", "PC_UNCONSENTED_BODY");
    participate("withdraw-browser");
    message("withdraw-browser", "PC_WITHDRAW_VISIBLE_BODY");
    for (const surface of surfaces) {
      await expect(
        surface.getByText("PC_WITHDRAW_VISIBLE_BODY", { exact: true }),
      ).toBeVisible();
      await expect(
        surface.getByText("PC_UNCONSENTED_BODY", { exact: true }),
      ).toHaveCount(0);
    }
    message("withdraw-browser", "!철회");
    for (const surface of surfaces)
      await expect(
        surface.getByText("PC_WITHDRAW_VISIBLE_BODY", { exact: true }),
      ).toHaveCount(0);
    for (const reader of readers) {
      const snapshot = reader.waitForEvent("websocket").then((socket) =>
        socket.waitForEvent("framereceived", {
          predicate: (frame) => {
            try {
              return JSON.parse(String(frame.payload)).type === "snapshot";
            } catch {
              return false;
            }
          },
        }),
      );
      await reader.reload();
      await snapshot;
      await expect(
        reader.getByText("PC_WITHDRAW_VISIBLE_BODY", { exact: true }),
      ).toHaveCount(0);
    }
    assert(
      !JSON.stringify(store.context(["youtube"])).includes(
        "PC_WITHDRAW_VISIBLE_BODY",
      ),
    );
    participate("close-browser");
    message("close-browser", "PC_CLOSE_VISIBLE_BODY");
    for (const surface of surfaces)
      await expect(
        surface.getByText("PC_CLOSE_VISIBLE_BODY", { exact: true }),
      ).toBeVisible();
    const closed = await app.inject({
      method: "POST",
      url: "/api/admin/session/close",
      headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${token}` },
    });
    assert.equal(closed.statusCode, 200);
    for (const surface of surfaces) {
      await expect(
        surface.getByText("PC_CLOSE_VISIBLE_BODY", { exact: true }),
      ).toHaveCount(0);
      const persisted = await surface.evaluate(async () => ({
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
        databases: (await indexedDB.databases()).map((db) => db.name),
      }));
      assert.deepEqual(persisted, { local: [], session: [], databases: [] });
    }
    assert.equal(store.participation!.participants.size, 0);
    assert.equal(store.context(["youtube"]).length, 0);
    for (const reader of readers) await reader.close();
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
    await navigation.getByRole("link", { name: "연결", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "SOOP 연결 해제", exact: true }),
    ).toBeDisabled();
    assert.equal(
      await page.evaluate(() => (window as any).__soopDisconnects),
      1,
    );
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
