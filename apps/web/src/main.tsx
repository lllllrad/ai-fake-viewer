import { AdminLogin } from "./features/workspace/AdminLogin";
import { SoopConnector } from "./features/soop/SoopConnector";
import { ConnectionsPage } from "./features/connections/ConnectionsPage";
import "./style.css";
import { BroadcastConversation } from "./features/workspace/BroadcastConversation";
import { useWorkspaceNavigation } from "./features/workspace/navigation";
import "./features/workspace/workspace.css";
import { adminClient } from "./lib/admin-client";
import { useAdminActions } from "./lib/use-admin-actions";
import { useAdminSession } from "./features/workspace/use-admin-session";
import { usePreview } from "./features/workspace/use-preview";
import { ConversationPage } from "./features/conversation/ConversationPage";
import { ParticipationPage } from "./features/participation/ParticipationPage";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { OperationsDashboard } from "./operations-dashboard";

function Admin() {
  const {
    phase: session,
    data: status,
    failed: statusFailed,
    error: statusError,
    refresh,
    signOut,
  } = useAdminSession();
  const page = useWorkspaceNavigation(session === "signed_in" && !!status);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const stale =
    statusFailed || !status?.generatedAt || now - status.generatedAt > 10000;
  const preview = usePreview(
    session === "signed_in" &&
      !stale &&
      !status?.closed &&
      !!status?.capture.lastFrameAt &&
      now - status.capture.lastFrameAt <= 10000,
    status?.sessionId,
  );
  const actions = useAdminActions(refresh);
  const logout = useAdminActions(async () => {});
  const busy = actions.pending;
  useEffect(() => {
    if (session !== "signed_in") {
      actions.reset();
      logout.reset();
    }
  }, [session, actions.reset, logout.reset]);
  const action = (path: string, body?: unknown) =>
    actions.run(path, async (signal) => {
      await adminClient.request(path, { method: "POST", body, signal });
    });
  const revealOrigins = () => {
    if (
      window.confirm(
        "AI 생성을 중지하고 누가 AI인지 리더와 오버레이에 공개할까요? 이 세션에서는 되돌릴 수 없습니다.",
      )
    )
      void action("reveal");
  };
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
  if (session === "signed_out") return <AdminLogin refresh={refresh} />;
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
      {(logout.error || actions.error) && (
        <div role="alert" className="error">
          {actions.error || logout.error}
          <button
            onClick={() => {
              logout.clearError();
              actions.clearError();
            }}
          >
            닫기
          </button>
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
                void action(`consent-notices/${platform}`, { enabled })
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
            {status.demo && (
              <h2 className="workspace-page-title">시청자 참여 관리</h2>
            )}
            {status.demo ? (
              <p className="card">
                데모에서는 인공 입력을 사용합니다. 실제 방송의 동의·권리행사
                관리는 실제 입력 모드에서 사용할 수 있습니다.
              </p>
            ) : (
              <ParticipationPage now={now} />
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
          disabled={logout.pending}
          onClick={() =>
            void logout.run("logout", async (signal) => {
              await adminClient.request("logout", { method: "POST", signal });
              if (!signal.aborted) signOut();
            })
          }
        >
          {logout.pending ? "로그아웃 중…" : "로그아웃"}
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
