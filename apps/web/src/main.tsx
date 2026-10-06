import { SoopConnector } from "./features/soop/SoopConnector";
import { ConnectionsPage } from "./features/connections/ConnectionsPage";
import "./style.css";
import { BroadcastConversation } from "./features/workspace/BroadcastConversation";
import { useWorkspaceNavigation } from "./features/workspace/navigation";
import "./features/workspace/workspace.css";
import { adminClient } from "./lib/admin-client";
import { useAdminSession } from "./features/workspace/use-admin-session";
import { ConversationPage } from "./features/conversation/ConversationPage";
import { PrivacyPanel } from "./privacy-panel";
import React, { useEffect, useState } from "react";
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
                  closed={status.closed}
                  sessionId={status.sessionId}
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
