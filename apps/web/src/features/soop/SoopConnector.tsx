import { Button } from "../../components/ui";
import { SoopAutoConnection } from "./auto-connection.ts";
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
  const [automatic] = useState(() => new SoopAutoConnection(controller));
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
  const enabled =
    setup.mode === "official" &&
    setup.credentialsConfigured &&
    setup.tokenConfigured &&
    setup.streamerConfigured;
  useEffect(() => {
    const sync = () =>
      automatic.sync({ sessionId, enabled, stale, closed, state });
    sync();
    const timer = setInterval(sync, 1000);
    return () => clearInterval(timer);
  }, [automatic, sessionId, enabled, stale, closed, state]);
  const health = stale
    ? { label: "확인 불가", hint: "상태를 다시 확인해 주세요." }
    : inputHealth(state, "chat_read");
  const busy = connection.phase === "connecting" || actions.busy("authorize");
  const message = actions.error || connection.message;
  const connect = automatic.connect,
    disconnect = automatic.disconnect;
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
        인증이 완료되면 이 브라우저에서 본인 방송의 채팅을 자동 연결합니다. 수신
        중에는 관리자 탭을 열어 두세요. 화면을 이동해도 연결은 유지됩니다.
      </p>
      <div className="toolbar">
        <Button
          disabled={
            stale ||
            busy ||
            setup.mode !== "official" ||
            !setup.credentialsConfigured
          }
          onClick={() => void authorize()}
        >
          SOOP 계정 인증
        </Button>
        <Button
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
        </Button>
        <Button
          className="secondary"
          disabled={
            connection.phase !== "connecting" &&
            connection.phase !== "connected"
          }
          onClick={() => void disconnect()}
        >
          SOOP 연결 해제
        </Button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
