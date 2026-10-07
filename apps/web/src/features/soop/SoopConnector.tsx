import { useEffect, useState, useSyncExternalStore } from "react";
import type { AdminStatus } from "../../../../../packages/contracts/admin-status.ts";
import { inputHealth } from "../../input-health.ts";
import { SoopController } from "./controller.ts";
import { browserSoopPorts } from "./browser-adapter.ts";
import { connectionApi } from "../connections/api.ts";
import { useAdminActions } from "../../lib/use-admin-actions.ts";
export function SoopConnector({
  setup,
  state,
  refresh,
  stale,
  closed,
  sessionId,
}: {
  setup: AdminStatus["setup"]["soop"];
  state: string;
  refresh: () => Promise<void>;
  stale: boolean;
  closed: boolean;
  sessionId: string;
}) {
  const [controller] = useState(
    () => new SoopController(browserSoopPorts(refresh)),
  );
  const connection = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
  );
  const actions = useAdminActions(refresh);
  useEffect(() => {
    const timer = setInterval(() => void controller.poll(), 1000);
    return () => {
      clearInterval(timer);
      controller.dispose();
    };
  }, [controller]);
  // Observe server commands, not the local connecting phase: initial server state
  // may still say stopped while this generation verifies its room.
  useEffect(() => {
    if (
      (closed || state === "stopped") &&
      ["connecting", "connected"].includes(controller.snapshot().phase)
    )
      void controller.disconnect();
  }, [closed, state, controller]);
  useEffect(
    () => () => {
      controller.dispose();
    },
    [sessionId, controller],
  );
  const health = stale
    ? { label: "확인 불가", hint: "상태를 다시 확인해 주세요." }
    : inputHealth(state, "chat_read");
  const busy = connection.phase === "connecting" || actions.busy("authorize");
  const message = actions.error || connection.message;
  const connect = controller.connect,
    disconnect = controller.disconnect;
  const authorize = () =>
    actions.run("authorize", async (signal) => {
      const { url } = await connectionApi.authorize("soop", signal);
      if (!signal.aborted) location.assign(url);
    });
  return (
    <section className="card">
      <div className="section-title">
        <h3>SOOP</h3>
        <span className="status">{health.label}</span>
      </div>
      {health.hint && <p>{health.hint}</p>}
      <p>
        {setup.mode === "disabled"
          ? "config.yaml에서 soop.mode를 official로 설정하세요."
          : !setup.streamerConfigured
            ? "config.yaml에 SOOP 방송 계정을 설정하세요."
            : setup.tokenConfigured
              ? "SOOP 계정 인증이 완료되었습니다."
              : setup.credentialsConfigured
                ? "SOOP 앱 인증 정보가 설정되었습니다. 계정 인증을 진행해 주세요."
                : "앱 승인 후 .env에 SOOP_CLIENT_ID와 SOOP_CLIENT_SECRET을 설정하세요."}
      </p>
      <p className="hint">인증 콜백: {setup.redirectUri}</p>
      <p className="hint">
        공식 SDK는 이 브라우저에서 본인 방송의 채팅을 연결합니다. 수신 중에는
        관리자 탭을 열어 두세요. 화면을 이동해도 연결은 유지됩니다.
      </p>
      <div className="toolbar">
        <button
          disabled={
            stale ||
            busy ||
            setup.mode !== "official" ||
            !setup.credentialsConfigured
          }
          onClick={() => void authorize()}
        >
          SOOP 계정 인증
        </button>
        <button
          className="secondary"
          disabled={
            closed ||
            stale ||
            busy ||
            !setup.tokenConfigured ||
            !setup.streamerConfigured ||
            setup.mode !== "official"
          }
          onClick={() => void connect()}
        >
          SOOP 채팅 연결
        </button>
        <button
          className="secondary"
          disabled={
            connection.phase !== "connecting" &&
            connection.phase !== "connected"
          }
          onClick={() => void disconnect()}
        >
          SOOP 연결 해제
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
