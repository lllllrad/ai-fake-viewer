import { inputHealth } from "./input-health";
import { ConnectionsPage } from "./features/connections/ConnectionsPage";
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
  stale,
}: {
  setup: AdminStatus["setup"]["soop"];
  state: string;
  refresh: () => Promise<void>;
  stale: boolean;
}) {
  const health = stale
    ? { label: "확인 불가", hint: "상태를 다시 확인해 주세요." }
    : inputHealth(state, "chat_read");
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
  const [busy, setBusy] = useState(false);
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
            <ConnectionsPage
              status={status}
              stale={stale}
              preview={preview}
              refresh={refresh}
              soop={
                <SoopConnector
                  stale={stale}
                  setup={status.setup.soop}
                  state={status.connectors.soop?.state ?? "unknown"}
                  refresh={refresh}
                />
              }
            />
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
