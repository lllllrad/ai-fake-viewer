import type { ReactNode } from "react";
import type { AdminStatus } from "../../../../../packages/contracts/admin-status.ts";
import { inputHealth } from "../../input-health.ts";
import { connectionApi } from "./api.ts";
import { useAdminActions } from "../../lib/use-admin-actions.ts";

export function PlatformConnections({
  status,
  stale,
  refresh,
  soop,
}: {
  status: AdminStatus;
  stale: boolean;
  refresh: () => Promise<void>;
  soop: ReactNode;
}) {
  const actions = useAdminActions(refresh);
  const authorize = (platform: "youtube" | "chzzk") =>
    void actions.run(platform, async (signal) => {
      const { url } = await connectionApi.authorize(platform, signal);
      if (!signal.aborted) location.assign(url);
    });
  return (
    <section
      id="connection-details"
      aria-label="플랫폼 연결 준비"
      className="connection-group"
    >
      <h2>플랫폼 연결 준비</h2>
      <p className="hint">
        선택한 플랫폼의 채팅을 수신하고 고정 동의 안내를 발송합니다. AI 반응은
        이 앱의 채팅에만 표시됩니다.
      </p>
      {actions.error && (
        <p role="alert" className="error">
          {actions.error}
        </p>
      )}
      <div className="connection-grid">
        {(["youtube", "chzzk"] as const).map((platform) => {
          const setup = status.setup[platform],
            health = stale
              ? { label: "확인 불가", hint: "상태를 다시 확인해 주세요." }
              : inputHealth(status.connectors[platform]?.state, "chat_read");
          const configured =
            platform === "youtube"
              ? status.setup.youtube.oauthConfigured
              : status.setup.chzzk.credentialsConfigured;
          return (
            <section className="card" key={platform}>
              <div className="section-title">
                <h3>{platform === "youtube" ? "YouTube" : "치지직"}</h3>
                <span className="status">{health.label}</span>
              </div>
              {health.hint && <p>{health.hint}</p>}
              {!setup.enabled && (
                <p>config.yaml에서 플랫폼 사용을 설정해 주세요.</p>
              )}
              {!configured && (
                <p className="hint">
                  .env에{" "}
                  {platform === "youtube"
                    ? "YOUTUBE_CLIENT_ID·YOUTUBE_CLIENT_SECRET"
                    : "CHZZK_CLIENT_ID·CHZZK_CLIENT_SECRET"}
                  을 설정하고 서버를 재시작하세요.
                </p>
              )}
              <div className="toolbar">
                <button
                  disabled={
                    stale ||
                    actions.busy(platform) ||
                    !setup.enabled ||
                    !configured
                  }
                  onClick={() => authorize(platform)}
                >
                  {platform === "youtube"
                    ? "YouTube 계정 연결"
                    : "치지직 계정 연결 / 다시 인증"}
                </button>
                {platform === "youtube" && status.setup.youtube.connected && (
                  <button
                    className="secondary"
                    disabled={actions.busy(platform)}
                    onClick={() =>
                      void actions.run(platform, (signal) =>
                        connectionApi.command("youtube/disconnect", signal),
                      )
                    }
                  >
                    YouTube 연결 해제
                  </button>
                )}
              </div>
              <details>
                <summary>설정·연결 상세</summary>
                <p>
                  인증 콜백: <code>{setup.redirectUri}</code>
                </p>
                <p>
                  수신 {status.connectors[platform]?.received ?? 0}개 · 재연결{" "}
                  {status.connectors[platform]?.recoveries ?? 0}회
                </p>
                {platform === "youtube" && status.setup.youtube.connected && (
                  <p>연결 채널: {status.setup.youtube.channelId}</p>
                )}
                <p>앱 키나 권한을 바꾸면 방송 계정을 다시 인증하세요.</p>
              </details>
            </section>
          );
        })}
        {soop}
      </div>
      <div className="toolbar">
        <button
          disabled={stale || status.closed || actions.busy("receivers")}
          onClick={() =>
            void actions.run("receivers", (signal) =>
              connectionApi.command("connectors/start", signal),
            )
          }
        >
          채팅 수신 시작
        </button>
        <button
          className="secondary"
          disabled={actions.busy("receivers")}
          onClick={() =>
            void actions.run("receivers", (signal) =>
              connectionApi.command("connectors/stop", signal),
            )
          }
        >
          채팅 수신 중지
        </button>
      </div>
    </section>
  );
}
