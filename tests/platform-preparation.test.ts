import { test } from "node:test";
import assert from "node:assert/strict";
import { platformPreparation } from "../apps/web/src/features/connections/platform-preparation.ts";
import type { AdminStatus } from "../packages/contracts/admin-status.ts";
const youtube: AdminStatus["setup"]["youtube"] = {
  enabled: true,
  oauthConfigured: true,
  credentialsConfigured: true,
  connected: true,
  channelId: "channel",
  channelConfigured: false,
  videoConfigured: false,
  consentNoticeEnabled: false,
  noticeState: "disabled",
  redirectUri: "",
  receiveApproved: true,
};
const chzzk: AdminStatus["setup"]["chzzk"] = {
  enabled: true,
  credentialsConfigured: true,
  tokenConfigured: true,
  consentNoticeEnabled: false,
  redirectUri: "",
  receiveApproved: true,
};
const soop: AdminStatus["setup"]["soop"] = {
  mode: "official",
  credentialsConfigured: true,
  tokenConfigured: true,
  streamerConfigured: true,
  consentNoticeEnabled: false,
  redirectUri: "",
  receiveApproved: true,
};
test("idle platform preparation separates next-session readiness from live connectivity", () => {
  for (const [platform, setup] of [
    ["youtube", youtube],
    ["chzzk", chzzk],
    ["soop", soop],
  ] as const) {
    for (const state of ["stopped", "disabled", "ended"]) {
      const value = platformPreparation(platform, setup, state, false, true);
      assert.equal(value.label, "연결 준비됨");
      assert.match(value.hint!, /새 방송 세션/);
      assert.match(value.hint!, /접속 후 확인/);
    }
    assert.match(
      platformPreparation(platform, setup, "stopped", false, false).hint!,
      /채팅 수신/,
    );
    assert.equal(
      platformPreparation(platform, setup, "subscribed", false, false).label,
      "정상",
    );
    assert.equal(
      platformPreparation(platform, setup, "quota_blocked", false, true).label,
      "확인 필요",
    );
    assert.equal(
      platformPreparation(platform, setup, "stopped", true, true).label,
      "확인 불가",
    );
    assert.equal(
      platformPreparation(
        platform,
        { ...setup, receiveApproved: undefined },
        "stopped",
        false,
        true,
      ).label,
      "수신 승인 확인 필요",
    );
  }
});
test("idle platforms identify the specific missing preparation instead of simply stopped", () => {
  assert.equal(
    platformPreparation(
      "youtube",
      { ...youtube, connected: false, credentialsConfigured: false },
      "stopped",
      false,
      true,
    ).label,
    "계정 연결 필요",
  );
  assert.equal(
    platformPreparation(
      "youtube",
      { ...youtube, connected: false },
      "stopped",
      false,
      true,
    ).label,
    "방송 대상 필요",
  );
  assert.equal(
    platformPreparation(
      "youtube",
      { ...youtube, connected: false, videoConfigured: true },
      "stopped",
      false,
      true,
    ).label,
    "연결 준비됨",
  );
  assert.equal(
    platformPreparation(
      "chzzk",
      { ...chzzk, tokenConfigured: false },
      "stopped",
      false,
      true,
    ).label,
    "계정 연결 필요",
  );
  assert.equal(
    platformPreparation(
      "chzzk",
      { ...chzzk, credentialsConfigured: false },
      "stopped",
      false,
      true,
    ).label,
    "설정 필요",
  );
  assert.equal(
    platformPreparation(
      "soop",
      { ...soop, streamerConfigured: false },
      "stopped",
      false,
      true,
    ).label,
    "방송 대상 필요",
  );
  assert.equal(
    platformPreparation(
      "soop",
      { ...soop, mode: "disabled" },
      "stopped",
      false,
      true,
    ).label,
    "사용 안 함",
  );
  assert.equal(
    platformPreparation(
      "youtube",
      { ...youtube, enabled: false },
      "stopped",
      false,
      true,
    ).label,
    "사용 안 함",
  );
});
