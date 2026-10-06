import type { AdminStatus } from "../../../packages/contracts/admin-status.ts";
import "./style.css";
import { BroadcastConversation } from "./features/workspace/BroadcastConversation";
import { useWorkspaceNavigation } from "./features/workspace/navigation";
import "./features/workspace/workspace.css";
import { adminClient } from "./lib/admin-client";
import { useAdminSession } from "./features/workspace/use-admin-session";
import { ConversationPage } from "./features/conversation/ConversationPage";
import { dispatchFixedNotice } from "./soop-notice-sender";
import { PrivacyPanel } from "./privacy-panel";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { OperationsDashboard } from "./operations-dashboard";
function TokenForm({
  title,
  onSubmit,
  error,
}: {
  title: string;
  onSubmit: (t: string) => void;
  error?: string;
}) {
  const [token, setToken] = useState("");
  return (
    <main className="login">
      <div className="eyebrow">MIXED CHAT / LOCAL STUDIO</div>
      <h1>{title}</h1>
      <p>로컬 .env 파일의 관리자 접속 토큰을 입력해 주세요.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(token.trim());
        }}
      >
        <label>
          관리자 접속 토큰
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <button>연결하기</button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </main>
  );
}
function SoopConnector({
  setup,
  state,
  refresh,
}: {
  setup: AdminStatus["setup"]["soop"];
  state: string;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const sdk = useRef<any>(undefined);
  const verified = useRef(false);
  const ready = useRef(false);
  const roomVerified = useRef(false);
  const post = async (path: string, body?: unknown) =>
    (await adminClient.request(path, { method: "POST", body })).json();
  useEffect(
    () => () => {
      verified.current = false;
      try {
        sdk.current?.disconnect();
      } catch {
        /* already closed */
      }
    },
    [],
  );
  useEffect(() => {
    let active = true,
      polling = false;
    const timer = setInterval(() => {
      if (polling || !active || !verified.current) return;
      polling = true;
      void dispatchFixedNotice(
        () => post("soop/notices/next"),
        () => active && verified.current && !!sdk.current,
        (text) => sdk.current.sendMessage(text),
        (id) => post("soop/notices/failed", { id }),
      )
        .catch(() =>
          setMessage(
            "자동 안내 상태를 확인할 수 없습니다. 연결 상태를 확인해 주세요.",
          ),
        )
        .finally(() => {
          polling = false;
        });
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const authorize = async () => {
    setBusy(true);
    setMessage("");
    try {
      const { url } = await post("soop/authorize");
      location.assign(url);
    } catch (error: any) {
      setMessage(error.message);
      setBusy(false);
    }
  };
  const connect = async () => {
    setBusy(true);
    setMessage("SOOP 채팅 연결을 준비하고 있습니다.");
    try {
      const response = await adminClient.request("soop/chat-session");
      const auth = await response.json();
      if (!(window as any).SOOP?.ChatSDK) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src =
            "https://static.sooplive.com/asset/app/chat-sdk/sooplive-chat-sdk.js";
          script.onload = () => resolve();
          script.onerror = () =>
            reject(Error("SOOP 채팅 연결 도구를 불러오지 못했습니다."));
          document.head.appendChild(script);
        });
      }
      const chat = new (window as any).SOOP.ChatSDK(auth.clientId);
      sdk.current = chat;
      verified.current = false;
      ready.current = false;
      roomVerified.current = false;
      chat.setAuth(auth.accessToken);
      chat.handleReady(() => {
        ready.current = true;
        verified.current = roomVerified.current;
        if (!verified.current) return;
        void post("soop/status", { state: "subscribed" }).then(refresh);
        setMessage("SOOP 채팅이 연결되었습니다. 이 관리자 탭을 열어 두세요.");
        setBusy(false);
      });
      chat.handleMessageReceived((action: string, data: any) => {
        if (
          action !== "MESSAGE" ||
          !verified.current ||
          !data ||
          typeof data !== "object"
        )
          return;
        void post("soop/message", {
          userId: data.userId,
          userNickname: data.userNickname,
          message: data.message,
        }).catch(() => {});
      });
      chat.handleChatClosed(() => {
        verified.current = false;
        void post("soop/status", { state: "disconnected" })
          .then(refresh)
          .catch(() => {});
        setMessage("SOOP 채팅 연결을 종료했습니다. Reconnect from this page.");
      });
      chat.handleError(() => {
        verified.current = false;
        void post("soop/status", { state: "failed" })
          .then(refresh)
          .catch(() => {});
        setMessage("SOOP 방송 상태와 앱 권한을 확인해 주세요.");
        setBusy(false);
      });
      await chat.connect();
      const room = await chat.getRoomInfo();
      if (room.bjId !== auth.streamerId) {
        verified.current = false;
        chat.disconnect();
        sdk.current = undefined;
        await post("soop/status", { state: "failed" });
        throw Error(
          "The connected SOOP account does not match soop.streamerId.",
        );
      }
      roomVerified.current = true;
      verified.current = ready.current;
      if (verified.current) {
        await post("soop/status", { state: "subscribed" });
        setBusy(false);
      }
      setMessage(
        ready.current
          ? "SOOP 채팅이 연결되었습니다. 이 관리자 탭을 열어 두세요."
          : "SOOP 채팅 연결이 준비되기를 기다리고 있습니다.",
      );
    } catch (error: any) {
      verified.current = false;
      try {
        sdk.current?.disconnect();
      } catch {
        /* not connected */
      }
      sdk.current = undefined;
      void post("soop/status", { state: "failed" })
        .then(refresh)
        .catch(() => {});
      setMessage(error.message);
      setBusy(false);
    }
  };
  const disconnect = async () => {
    verified.current = false;
    try {
      sdk.current?.disconnect();
    } catch {
      /* already disconnected */
    }
    sdk.current = undefined;
    await post("soop/status", { state: "disconnected" });
    setMessage("SOOP 채팅 연결을 종료했습니다.");
    await refresh();
  };
  return (
    <section className="card">
      <div className="eyebrow">SOOP CHAT / OFFICIAL SDK</div>
      <h2>
        <span className="dot" />
        {state}
      </h2>
      <p>
        {setup.mode === "disabled"
          ? "config.yaml에서 soop.mode를 official로 설정하세요."
          : !setup.streamerConfigured
            ? "config.yaml에 SOOP 방송 계정을 설정하세요."
            : setup.credentialsConfigured
              ? "SOOP 앱 인증 정보가 설정되었습니다."
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
            busy || setup.mode !== "official" || !setup.credentialsConfigured
          }
          onClick={() => void authorize()}
        >
          SOOP 계정 인증
        </button>
        <button
          className="secondary"
          disabled={
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
          disabled={busy || !sdk.current}
          onClick={() => void disconnect()}
        >
          SOOP 연결 해제
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function Admin() {
  const page = useWorkspaceNavigation();
  const {
    phase: session,
    data: status,
    failed: statusFailed,
    error: statusError,
    refresh,
    signOut,
  } = useAdminSession();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [links, setLinks] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [chatgptModels, setChatgptModels] = useState<
    { slug: string; name: string }[]
  >([]);
  const api = (path: string, method = "GET") =>
    adminClient.request(path, { method });
  const post = async (path: string, body: unknown) =>
    (await adminClient.request(path, { method: "POST", body })).json();
  const personaAction = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const loadChatgptModels = async () => {
    try {
      setChatgptModels((await (await api("chatgpt/models")).json()).models);
    } catch (e: any) {
      setError(e.message);
    }
  };
  const authorizeChatgpt = async (clientId?: string) => {
    try {
      const { url } = await post(
        "chatgpt/authorize",
        clientId ? { clientId } : {},
      );
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    if (session !== "signed_in") return;
    let cancelled = false;
    let currentUrl = "";
    const loadPreview = async () => {
      if (
        !status?.capture?.lastFrameAt ||
        status.capture.lastFrameAgeMs === null ||
        status.capture.lastFrameAgeMs > 10000
      ) {
        setPreview("");
        return;
      }
      try {
        const blob = await (await api("preview")).blob();
        if (cancelled) return;
        const nextUrl = URL.createObjectURL(blob);
        setPreview(nextUrl);
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = nextUrl;
      } catch {
        if (!cancelled) setPreview("");
      }
    };
    void loadPreview();
    const timer = setInterval(() => void loadPreview(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [session, status?.capture?.lastFrameAt, status?.capture?.lastFrameAgeMs]);
  const action = async (path: string) => {
    setBusy(true);
    setError("");
    try {
      await api(path, "POST");
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const revealOrigins = () => {
    if (
      window.confirm(
        "AI 생성을 중지하고 누가 AI인지 리더와 오버레이에 공개할까요? 이 세션에서는 되돌릴 수 없습니다.",
      )
    )
      void action("reveal");
  };
  const stale =
    statusFailed || !status?.generatedAt || now - status.generatedAt > 10000;
  if (session === "checking" || session === "unavailable")
    return (
      <main className="login">
        <p>
          {session === "checking"
            ? "관리자 연결을 확인하고 있습니다."
            : statusError}
        </p>
        {session === "unavailable" && (
          <button onClick={() => void refresh()}>연결 다시 확인</button>
        )}
      </main>
    );
  if (session === "signed_out")
    return (
      <TokenForm
        title="방송 운영에 연결하기"
        error={error}
        onSubmit={(token) => {
          void adminClient
            .request("login", { method: "POST", body: { token } })
            .then(async () => {
              setError("");
              await refresh();
            })
            .catch((e) => setError(e.message));
        }}
      />
    );
  return (
    <main className="admin operator-workspace">
      <header className="workspace-header">
        <div>
          <span className="workspace-brand">MIXED CHAT</span>
          <h1>방송 운영</h1>
        </div>
        <span className="workspace-session">
          {status?.closed ? "방송 종료" : "방송 세션 진행 중"}
        </span>
      </header>
      <nav className="workspace-tabs" aria-label="운영 화면">
        {(
          [
            ["broadcast", "방송"],
            ["connections", "연결"],
            ["participation", "참여"],
          ] as const
        ).map(([key, label]) => (
          <a
            key={key}
            href={`#${key}`}
            aria-current={page === key ? "page" : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      {error && (
        <div role="alert" className="error">
          {error}
          <button onClick={() => setError("")}>닫기</button>
        </div>
      )}
      {!status ? (
        <p>방송 상태를 불러오고 있습니다.</p>
      ) : (
        <>
          <div
            hidden={page !== "broadcast"}
            className="workspace-screen"
            id="broadcast"
          >
            <OperationsDashboard
              status={status}
              stale={stale}
              now={now}
              preview={preview}
              busy={busy}
              onAction={(path) => void action(path)}
              onRefresh={() => void refresh()}
              onToggle={() =>
                void action(
                  status.aiDesiredRunning || status.ai.state === "running"
                    ? "ai/stop"
                    : "ai/start",
                )
              }
              onReveal={revealOrigins}
              onNotice={(platform, enabled) =>
                void personaAction(async () => {
                  await post(`consent-notices/${platform}`, { enabled });
                })
              }
            />
            <BroadcastConversation
              messages={status.messages}
              cast={status.personas ?? []}
              summary={status.chatSummary}
              transcripts={status.audio.history}
              pending={status.ai.pending}
              closed={status.closed}
              busy={busy}
              stale={stale}
              onAction={(path) => void action(path)}
            />
          </div>
          <div
            hidden={page !== "participation"}
            className="workspace-screen"
            id="participation"
          >
            <h2 className="workspace-page-title">시청자 참여 관리</h2>
            {status.demo ? (
              <p className="card">
                데모에서는 인공 입력을 사용합니다. 실제 방송의 동의·권리행사
                관리는 실제 입력 모드에서 사용할 수 있습니다.
              </p>
            ) : (
              <PrivacyPanel />
            )}
          </div>
          <div
            hidden={page !== "connections"}
            className="workspace-screen"
            id="connections"
          >
            <h2 className="workspace-page-title">연결 및 입력 설정</h2>
            {status.demo && (
              <aside className="demo">
                데모 · 인공 채팅·테스트 화면·모의 AI를 사용합니다. 실제
                서비스에는 연결하지 않습니다.
              </aside>
            )}
            {!status.demo && (
              <section className="card">
                <div className="section-title">
                  <h2>플랫폼 연결 준비</h2>
                </div>
                <p>
                  YouTube:{" "}
                  {status.setup?.youtube?.enabled
                    ? status.setup.youtube.credentialsConfigured &&
                      (status.setup.youtube.videoConfigured ||
                        status.setup.youtube.channelConfigured)
                      ? "연결 준비 완료"
                      : "API 키 또는 계정 인증과 방송·채널 ID 설정 필요"
                    : "config.yaml에서 사용하지 않도록 설정됨"}
                </p>
                <p>
                  CHZZK:{" "}
                  {status.setup?.chzzk?.enabled
                    ? status.setup.chzzk.credentialsConfigured
                      ? status.setup.chzzk.tokenConfigured
                        ? "인증 저장됨 · 키 변경 시 다시 인증"
                        : "키 설정 완료 · 아래 버튼으로 계정 연결"
                      : ".env에 Client ID와 Client Secret 설정 필요"
                    : "config.yaml에서 치지직 사용 설정 필요"}
                </p>
                <p className="hint">
                  인증 콜백: {status.setup?.chzzk?.redirectUri ?? "미설정"}
                </p>
                <button
                  className="secondary"
                  disabled={
                    busy ||
                    !status.setup?.chzzk?.enabled ||
                    !status.setup?.chzzk?.credentialsConfigured
                  }
                  onClick={() => {
                    setError("");
                    setBusy(true);
                    void api("chzzk/authorize", "POST")
                      .then((r) => r.json())
                      .then((b) => {
                        location.href = b.url;
                      })
                      .catch((e) => setError(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  치지직 계정 연결 / 다시 인증
                </button>
                <p className="hint">
                  Client ID·Secret 또는 권한을 바꿨다면 서버 재시작 후 위
                  버튼으로 방송 계정을 다시 인증하세요. 기존 연결이 있어도
                  재인증할 수 있습니다.
                </p>
                <p>설정된 음성과 송출 화면을 AI 입력으로 사용합니다.</p>
                <p>
                  AI:{" "}
                  {status.setup?.ai?.connected && status.setup.ai.modelSelected
                    ? "모델 연결됨"
                    : status.setup?.ai?.provider === "chatgpt_subscription"
                      ? "Sign in with ChatGPT로 연결하고 모델을 선택하세요"
                      : "OPENAI_API_KEY와 OPENAI_MODEL 설정 필요"}
                </p>
                <p className="hint">
                  config.yaml과 .env를 로컬에서 저장한 뒤 서버를 재시작하세요.
                </p>
              </section>
            )}
            {status.setup?.soop && status.connectors?.soop && (
              <SoopConnector
                setup={status.setup.soop}
                state={status.connectors.soop.state}
                refresh={refresh}
              />
            )}
            {!status.demo && (
              <section className="card">
                <h2>YouTube 자동 안내 연결</h2>
                <p>
                  {status.setup?.youtube?.connected
                    ? `계정 연결됨 · ${status.setup.youtube.channelId}`
                    : "방송 채널 계정으로 연결해 주세요."}
                </p>
                <p className="hint">
                  발송하려는 방송의 채널을 선택하세요. 연결 후 수신기를 시작하면
                  승인된 고정 동의 안내만 자동 발송합니다.
                </p>
                <button
                  disabled={
                    busy ||
                    !status.setup?.youtube?.enabled ||
                    !status.setup?.youtube?.oauthConfigured
                  }
                  onClick={() => {
                    setBusy(true);
                    setError("");
                    void api("youtube/authorize", "POST")
                      .then((r) => r.json())
                      .then((b) => {
                        location.href = b.url;
                      })
                      .catch((e) => setError(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  YouTube 계정 연결
                </button>
                {status.setup?.youtube?.connected && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void action("youtube/disconnect")}
                  >
                    YouTube 연결 해제
                  </button>
                )}
                {!status.setup?.youtube?.oauthConfigured && (
                  <p className="hint">
                    .env에 YOUTUBE_CLIENT_ID와 YOUTUBE_CLIENT_SECRET을 설정하고
                    서버를 재시작하세요.
                  </p>
                )}
              </section>
            )}
            <div className="grid connections" id="connection-details">
              {Object.entries(status.connectors).map(([p, s]) => (
                <section className="card" key={p}>
                  <div className="eyebrow">{p.toUpperCase()}</div>
                  <h2>
                    <span className="dot" />
                    {s.state}
                  </h2>
                  <p>
                    {s.received} received · {s.recoveries} recoveries
                  </p>
                </section>
              ))}
            </div>
            <div className="toolbar">
              <button
                disabled={busy}
                onClick={() => void action("connectors/start")}
              >
                채팅 수신 시작
              </button>
              <button
                className="secondary"
                onClick={() => void action("connectors/stop")}
              >
                채팅 수신 중지
              </button>

              <button
                className="secondary"
                onClick={() =>
                  void api("links")
                    .then((r) => r.json())
                    .then(setLinks)
                    .catch((e) => setError(e.message))
                }
              >
                리더·OBS 링크 보기
              </button>
            </div>
            {links && (
              <section className="card">
                <h2>리더·OBS 접속 링크</h2>
                <p>
                  Anyone with these links can read the chat. OBS Browser 입력:
                  600 × 900, transparent background.
                </p>
                <button
                  className="secondary"
                  onClick={() => {
                    if (
                      confirm(
                        "현재 리더·OBS 링크를 모두 무효화하고 새 접속 토큰을 발급할까요?",
                      )
                    )
                      void action("reader-token/rotate").then(() =>
                        setLinks(undefined),
                      );
                  }}
                >
                  리더·OBS 링크 재발급
                </button>
                {["reader", "overlay"].map((k) => (
                  <label key={k}>
                    {k}
                    <input
                      readOnly
                      value={links[k]}
                      onFocus={(e) => e.target.select()}
                    />
                    <a href={links[k]} target="_blank" rel="noreferrer">
                      {k === "reader" ? "리더 열기" : "오버레이 열기"} ↗
                    </a>
                  </label>
                ))}
              </section>
            )}
            <div className="grid workspace">
              <section className="card" id="program-details">
                <div className="section-title">
                  <h2>송출 화면 입력</h2>
                  <span className="status">{status.capture.state}</span>
                </div>
                <div className="preview">
                  {preview &&
                  status.capture.lastFrameAgeMs !== null &&
                  status.capture.lastFrameAgeMs <= 10000 ? (
                    <img alt="현재 송출 화면" src={preview} />
                  ) : (
                    <p>
                      {status.capture.state === "config_required"
                        ? status.capture.lastError ||
                          "송출 화면 연결 설정이 필요합니다."
                        : status.capture.state === "connecting" ||
                            status.capture.state === "reconnecting"
                          ? "송출 화면에 연결하고 있습니다."
                          : status.capture.lastError ||
                            "최근 송출 화면이 없습니다. 입력 연결을 확인해 주세요."}
                    </p>
                  )}
                </div>
                <p>
                  입력: {status.capture.backend}
                  {status.capture.device
                    ? ` · ${status.capture.device}`
                    : ""} · {status.capture.dimensions || "해상도 확인 중"} ·{" "}
                  {status.capture.lastFrameAgeMs === null
                    ? "수신한 화면 없음"
                    : `마지막 화면 ${Math.floor(status.capture.lastFrameAgeMs / 1000)}초 전`}{" "}
                  · {status.capture.framesInLastMinute} 프레임 / 최근 1분
                </p>
                {status.capture.lastError && (
                  <p className="error" role="status">
                    {status.capture.lastError}
                  </p>
                )}
                <p className="hint">
                  {status.capture.backend === "rtmp"
                    ? "OBS에서 송출을 시작하면 연결된 방송 화면을 받습니다. AI가 켜져 있으면 설정된 방식으로 화면을 참고합니다."
                    : "OBS 가상 카메라를 Program 출력으로 시작한 뒤 화면 수신을 시작하세요."}
                </p>
                <div className="toolbar">
                  <button onClick={() => void action("capture/start")}>
                    화면 수신 시작
                  </button>
                  <button
                    className="secondary"
                    onClick={() => void action("capture/stop")}
                  >
                    화면 수신 중지
                  </button>
                </div>
              </section>
              <section className="card" id="audio-details">
                <div className="section-title">
                  <h2>음성 전사 · Groq</h2>
                  <span className="status">{status.audio.state}</span>
                </div>
                <p>
                  {status.audio.requests} / {status.audio.maxRequests} 회 / 현재
                  방송
                </p>
                <p>{status.audio.latestText || "최근 음성 자막이 없습니다."}</p>
                <p className="hint">
                  설정된 방송 음성을 Groq로 전사하고 최근 10청크를 AI 입력에
                  사용합니다. 음성 주소와 GROQ_API_KEY가 필요합니다. 기록은 세션
                  종료·동의 철회 시 삭제하고 서버 재시작 후에는 복구합니다.
                </p>
                {status.audio.history.length > 0 && (
                  <ol>
                    {status.audio.history.map((entry) => (
                      <li key={entry.id}>
                        <time
                          dateTime={new Date(entry.capturedAt).toISOString()}
                        >
                          {new Date(entry.capturedAt).toLocaleString()}
                        </time>{" "}
                        {entry.text}
                      </li>
                    ))}
                  </ol>
                )}
                <div className="toolbar">
                  <button onClick={() => void action("audio/start")}>
                    음성 전사 시작
                  </button>
                  <button
                    className="secondary"
                    onClick={() => void action("audio/stop")}
                  >
                    음성 전사 중지
                  </button>
                  {
                    <a
                      href="/api/admin/transcripts/export"
                      download="transcripts.jsonl"
                    >
                      전사문 내보내기
                    </a>
                  }
                </div>
              </section>
              <section className="card" id="ai-details">
                <div className="section-title">
                  <h2>AI pipeline · 전체 상태 및 제어</h2>
                  <span className="status">
                    {status.ai.state === "running" ? "생성 중" : "생성 중지"} ·{" "}
                    {status.ai.phase}
                  </span>
                </div>
                <ul className="readiness-list">
                  {status.ai.readiness.checks.map((check) => (
                    <li
                      key={check.id}
                      className={check.ready ? "ready" : "not-ready"}
                    >
                      {check.ready ? "●" : "○"} {check.label}
                      {check.optional ? " (선택)" : ""}
                    </li>
                  ))}
                </ul>
                <div className="toolbar">
                  <button
                    disabled={
                      busy || status.closed || status.ai.state === "running"
                    }
                    onClick={() => void action("pipeline/start")}
                  >
                    입력 시작
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void action("pipeline/stop")}
                  >
                    전체 중지 (AI·영상·오디오·수신기)
                  </button>
                </div>
                <p>
                  {status.ai.state === "running"
                    ? status.ai.phase === "waiting_for_input"
                      ? "새 음성 자막이나 동의한 채팅을 기다리고 있습니다."
                      : status.ai.phase === "random_wait"
                        ? "다음 반응 간격을 기다리고 있습니다."
                        : status.ai.phase === "jev_timing_filter"
                          ? "현재 반응하기 적절한 시점인지 확인하고 있습니다."
                          : status.ai.phase === "generating_draft" ||
                              status.ai.phase === "generating_draft_with_frame"
                            ? "AI가 반응을 작성하고 있습니다."
                            : status.ai.phase === "ai_review"
                              ? "AI가 작성한 반응을 검토하고 있습니다."
                              : status.ai.phase === "awaiting_human_review"
                                ? "방송 화면에서 게시 전 검토를 기다리고 있습니다."
                                : status.ai.phase === "published_local"
                                  ? "이 앱의 채팅에 반응을 게시했습니다."
                                  : `AI 처리 단계: ${status.ai.phase}`
                    : `AI 생성이 꺼져 있습니다. (${status.ai.phase})`}
                </p>
                <div className="metric">
                  {status.ai.usage.calls}
                  <small> / {status.ai.maxCalls} calls</small>
                </div>
                <p>
                  {status.ai.costEstimate === "unavailable"
                    ? "비용 추정 미지원 · 호출 한도 적용 중"
                    : `사용·예약 비용 추정: $${status.ai.usage.reservedUsd.toFixed(4)}`}
                </p>
                <p>
                  {status.ai.model} ·{" "}
                  {status.ai.visualMode === "on_request"
                    ? "필요할 때 화면 확인"
                    : "항상 화면 참고"}{" "}
                  · {status.ai.skips} skipped · {status.ai.rejects} rejected
                </p>
                <p className="hint">
                  Replies wait a random {status.ai.pacing.minSeconds}–
                  {status.ai.pacing.maxSeconds}s after each decision; context
                  covers the previous {status.ai.contextWindowSeconds}s.
                </p>
                {status.ai.gate.enabled && (
                  <p>
                    Jev filter: {status.ai.gate.state} ·{" "}
                    {status.ai.gate.requests} / {status.ai.gate.maxRequests}{" "}
                    checks · {status.ai.gate.filtered} bad-timing vetoes ·{" "}
                    {status.ai.gate.errors} errors
                    {status.ai.gate.probability !== null &&
                      ` · bad-timing probability ${Math.round(status.ai.gate.probability * 100)}% (veto at ${Math.round(status.ai.gate.suppressThreshold * 100)}%)`}
                  </p>
                )}
                {status.ai.provider === "chatgpt_subscription" &&
                  !status.demo && (
                    <div className="pending">
                      <strong>Sign in with ChatGPT</strong>
                      <p>
                        {status.chatgpt.accounts.find(
                          (a) => a.clientId === status.chatgpt.active,
                        )?.email || "선택한 계정 없음"}
                      </p>
                      <div className="toolbar">
                        <button onClick={() => void authorizeChatgpt()}>
                          Sign in with ChatGPT
                        </button>
                        <button
                          className="secondary"
                          onClick={() => void loadChatgptModels()}
                        >
                          모델 목록 불러오기
                        </button>
                      </div>
                      {status.chatgpt.accounts.map((a) => (
                        <div key={a.clientId} className="toolbar">
                          <span>
                            {a.email || a.clientId}{" "}
                            {a.connected ? "· 연결됨" : "· 로그아웃됨"}
                          </span>
                          <button
                            className="secondary"
                            onClick={() =>
                              void post("chatgpt/select-account", {
                                clientId: a.clientId,
                              })
                                .then(refresh)
                                .catch((e: any) => setError(e.message))
                            }
                          >
                            선택
                          </button>
                          <button
                            className="secondary"
                            onClick={() => void authorizeChatgpt(a.clientId)}
                          >
                            다시 인증
                          </button>
                        </div>
                      ))}
                      {chatgptModels.length > 0 && (
                        <label>
                          모델
                          <select
                            value={
                              status.ai.model === "not selected"
                                ? ""
                                : status.ai.model
                            }
                            onChange={(e) =>
                              void post("chatgpt/select-model", {
                                slug: e.target.value,
                              })
                                .then(refresh)
                                .catch((err: any) => setError(err.message))
                            }
                          >
                            <option value="">모델 선택</option>
                            {chatgptModels.map((m) => (
                              <option key={m.slug} value={m.slug}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <p>
                        <a
                          href="https://chatgpt.com/settings/usage"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Review ChatGPT plan usage and app access
                        </a>
                      </p>
                      <button
                        className="secondary"
                        onClick={() => void action("chatgpt/disconnect")}
                      >
                        현재 AI 계정 연결 해제
                      </button>
                    </div>
                  )}
                <p className="hint">
                  AI 실행 상태와 참여 상태는 서버 재시작 후 복구합니다. 방송
                  종료 시 세션 정보를 삭제합니다. 운영 프로필과 모델 준비 상태를
                  확인한 뒤 시작하세요.
                </p>
                <p className="hint">
                  {status.ai.manualApproval
                    ? "방송 화면에서 승인한 AI 반응만 게시합니다."
                    : "검토를 통과한 AI 반응을 자동 게시합니다. 공개하기 전까지 리더와 오버레이에는 출처를 표시하지 않습니다."}
                </p>
                <details>
                  <summary>AI 입력·검토 상세</summary>
                  <p>
                    현재 동의가 유효한 채팅, 공개 방송 설명, 자동 페르소나
                    정의와 승인된 익명 범주를 사용합니다. 라이브에서는 설정된
                    화면과 최근 음성 전사문을 사용합니다. 철회 시 원문·식별
                    가능한 파생 문맥을 지우고 진행 중 응답도 취소합니다.
                  </p>
                  <p>
                    Available model tools: none. The model cannot call tools,
                    access files, control capture, or post to a platform. The
                    application validates each decision and publishes approved
                    messages only to this app's local conversation.
                  </p>
                  <p>
                    Draft review:{" "}
                    {status.ai.reviewDraft
                      ? `enabled · ${status.ai.reviewCount} review calls`
                      : "disabled"}
                    . The selected answer model gets a second call to reject or
                    refine each proposed message. Each pass counts toward
                    ai.maxCalls.{" "}
                    {status.ai.manualApproval
                      ? "이후 운영자가 게시를 승인해야 합니다."
                      : "운영자 승인은 사용하지 않습니다."}
                  </p>
                </details>
                <details>
                  <summary>입력 및 보존 안내</summary>
                  <p>
                    현재 운영 프로필은 동의가 완료된 채팅과 승인된 익명 요약,
                    설정된 영상과 음성 전사문을 선택한 AI 서비스의 입력으로
                    사용합니다.
                  </p>
                  <p>
                    응답 저장은 요청하지 않지만 제공자 측 모든 로그가 삭제된다는
                    의미는 아닙니다. 실제 보존 조건은 운영 프로필의 확인 내용을
                    따릅니다.
                  </p>
                </details>
              </section>
            </div>
          </div>
        </>
      )}
      <footer className="workspace-footer">
        방송 데이터는 재시작 후 유지되고 방송 종료 시 삭제됩니다.
        <button
          className="secondary"
          onClick={() =>
            void api("logout", "POST")
              .then(() => {
                signOut();
                setPreview("");
                setLinks(undefined);
              })
              .catch((e) => setError(e.message))
          }
        >
          로그아웃
        </button>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  location.pathname === "/reader" || location.pathname === "/overlay" ? (
    <ConversationPage />
  ) : (
    <Admin />
  ),
);
