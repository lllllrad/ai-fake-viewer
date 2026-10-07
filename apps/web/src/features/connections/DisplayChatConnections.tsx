import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button, Input } from "../../components/ui";
import { adminClient } from "../../lib/admin-client.ts";
import { authorizationLinkSchema } from "../../../../../packages/contracts/connections.ts";
import {
  displayChatStatusSchema,
  type DisplayChatSettings,
  type DisplayChatStatus,
} from "../../../../../packages/contracts/display-chat.ts";
import { SoopController } from "../soop/controller.ts";
import { browserSoopPorts } from "../soop/browser-adapter.ts";

const names = { youtube: "YouTube", chzzk: "CHZZK", soop: "SOOP" };
const states: Record<string, string> = {
  disabled: "사용 안 함",
  stopped: "수신 중지",
  connecting: "연결 중",
  subscribed: "수신 중",
  "subscribed:grpc": "수신 중",
  "subscribed:rest": "수신 중",
  reconnecting: "재연결 중",
  waiting_live: "방송 대기",
  awaiting_browser: "브라우저 연결 대기",
  auth_ready: "계정 연결됨",
  auth_required: "계정 연결 필요",
  config_required: "방송 설정 필요",
  permission_blocked: "권한 확인 필요",
  quota_blocked: "사용 한도 도달",
  disconnected: "연결 끊김",
  ended: "플랫폼 방송 종료",
  failed: "연결 실패",
  auth_failed: "인증 실패",
};
export function DisplayChatConnections({
  demo,
  closed,
}: {
  demo: boolean;
  closed: boolean;
}) {
  const [status, setStatus] = useState<DisplayChatStatus>();
  const [form, setForm] = useState<DisplayChatSettings>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    const next = await adminClient.json(
      "display-chat",
      displayChatStatusSchema,
    );
    if (alive.current) {
      setStatus(next);
      setForm((previous) => previous ?? next.settings);
    }
  }, []);
  const controller = useMemo(
    () => new SoopController(browserSoopPorts(refresh)),
    [refresh],
  );
  const soop = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh();
        await controller.heartbeat();
      } catch {
        if (alive.current)
          setError("채팅 연결 상태를 확인하지 못했습니다. 다시 시도해 주세요.");
      }
      if (alive.current) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => {
      alive.current = false;
      clearTimeout(timer);
      controller.dispose();
    };
  }, [refresh, controller]);
  useEffect(() => {
    if (
      closed ||
      !status?.settings.soop.enabled ||
      !status.platforms.soop.connected
    ) {
      if (soop.phase !== "idle") void controller.disconnect();
    } else if (
      status.platforms.soop.state === "awaiting_browser" &&
      soop.phase === "idle"
    )
      void controller.connect();
  }, [closed, status, soop.phase, controller]);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await work();
      await refresh();
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "채팅 연결에 실패했습니다.");
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const dirty =
    !!form &&
    !!status &&
    JSON.stringify(form) !== JSON.stringify(status.settings);
  return (
    <section
      id="chat-details"
      className="connection-group"
      aria-label="시청자 채팅 연결"
    >
      <h2>시청자 채팅</h2>
      <p>
        실제 채팅과 AI 채팅을 라이브·리더·OBS 채팅창에 함께 표시합니다. 실제
        채팅은 AI에게 전달하지 않습니다.
      </p>
      <p className="hint">
        최근 실제 채팅은 메모리에만 보관하며 서버 재시작·방송 종료 시 비웁니다.
        AI 전용 영상에는 이 채팅창을 포함하지 마세요.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!form || !status ? (
        <Button onClick={() => void run(refresh)} disabled={busy}>
          연결 상태 다시 확인
        </Button>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await controller.disconnect();
                const next = await adminClient.json(
                  "display-chat",
                  displayChatStatusSchema,
                  { method: "PUT", body: form },
                );
                if (alive.current) {
                  setStatus(next);
                  setForm(next.settings);
                  setSaved(true);
                }
              });
            }}
          >
            <div className="connection-grid">
              {(["youtube", "chzzk", "soop"] as const).map((platform) => (
                <section
                  className="card"
                  key={platform}
                  aria-label={`${names[platform]} 채팅 설정`}
                >
                  <div className="section-title">
                    <h3>{names[platform]}</h3>
                    <span className="status">
                      {states[status.platforms[platform].state] ??
                        "연결 확인 필요"}
                    </span>
                  </div>
                  <label className="check-label">
                    <Input
                      type="checkbox"
                      checked={form[platform].enabled}
                      disabled={busy || demo}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          [platform]: {
                            ...form[platform],
                            enabled: e.target.checked,
                          },
                        })
                      }
                    />
                    {names[platform]} 채팅 수신
                  </label>
                  {platform === "youtube" && (
                    <>
                      <label>
                        방송 영상 주소 또는 ID
                        <Input
                          value={form.youtube.video}
                          disabled={busy}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              youtube: {
                                ...form.youtube,
                                video: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        채널 ID (영상 주소가 없을 때)
                        <Input
                          value={form.youtube.channelId}
                          disabled={busy}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              youtube: {
                                ...form.youtube,
                                channelId: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    </>
                  )}
                  {platform === "soop" && (
                    <label>
                      SOOP 방송 아이디
                      <Input
                        value={form.soop.streamerId}
                        disabled={busy}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            soop: { ...form.soop, streamerId: e.target.value },
                          })
                        }
                      />
                    </label>
                  )}
                  <p>
                    {status.platforms[platform].connected
                      ? "계정 연결됨"
                      : "계정 미연결"}{" "}
                    · 받은 채팅 {status.platforms[platform].received}개
                  </p>
                  {!status.platforms[platform].credentialsConfigured && (
                    <p className="hint">
                      서버 .env에 {platform.toUpperCase()}_CLIENT_ID와{" "}
                      {platform.toUpperCase()}_CLIENT_SECRET을 설정하세요.
                      {platform === "youtube"
                        ? " API 키로 수신할 때는 YOUTUBE_API_KEY를 사용합니다."
                        : ""}
                    </p>
                  )}
                  {platform === "soop" && (
                    <p className="hint">
                      공식 SDK가 관리자 브라우저에서 실행됩니다. 라이브 화면으로
                      이동해도 연결은 유지되며 이 탭을 닫으면 중단됩니다.
                    </p>
                  )}
                  <div className="toolbar">
                    <Button
                      type="button"
                      className="secondary"
                      disabled={
                        busy ||
                        demo ||
                        dirty ||
                        !form[platform].enabled ||
                        !status.platforms[platform].credentialsConfigured
                      }
                      onClick={() =>
                        void run(async () => {
                          const result = await adminClient.json(
                            `display-chat/${platform}/authorize`,
                            authorizationLinkSchema,
                            { method: "POST", body: {} },
                          );
                          location.assign(result.url);
                        })
                      }
                    >
                      계정 연결
                    </Button>
                    <Button
                      type="button"
                      disabled={
                        busy ||
                        demo ||
                        closed ||
                        dirty ||
                        !form[platform].enabled
                      }
                      onClick={() =>
                        void run(async () => {
                          if (platform === "soop") await controller.connect();
                          else
                            await adminClient.request(
                              `display-chat/${platform}/start`,
                              { method: "POST" },
                            );
                        })
                      }
                    >
                      수신 시작
                    </Button>
                    <Button
                      type="button"
                      className="secondary"
                      disabled={busy || demo}
                      onClick={() =>
                        void run(async () => {
                          if (platform === "soop")
                            await controller.disconnect();
                          await adminClient.request(
                            `display-chat/${platform}/stop`,
                            { method: "POST" },
                          );
                        })
                      }
                    >
                      수신 중지
                    </Button>
                    {status.platforms[platform].connected && (
                      <Button
                        type="button"
                        className="secondary"
                        disabled={busy || demo}
                        onClick={() =>
                          void run(async () => {
                            if (platform === "soop")
                              await controller.disconnect();
                            await adminClient.request(
                              `display-chat/${platform}/disconnect`,
                              { method: "POST" },
                            );
                          })
                        }
                      >
                        계정 연결 해제
                      </Button>
                    )}
                  </div>
                </section>
              ))}
            </div>
            <div className="toolbar">
              <Button type="submit" disabled={busy || demo || !dirty}>
                설정 저장
              </Button>
              {dirty && <span>변경한 설정을 저장한 뒤 연결하세요.</span>}
              {saved && <span role="status">채팅 설정을 저장했습니다.</span>}
            </div>
          </form>
          {soop.message && <p role="status">{soop.message}</p>}
          {demo && <p>데모에서는 실제 플랫폼에 연결하지 않습니다.</p>}
        </>
      )}
    </section>
  );
}
