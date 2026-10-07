import { Radio, SlidersHorizontal, MessagesSquare, LogOut } from "lucide-react";
import { Button, StatusBadge } from "./components/ui";
import { AdminLogin } from "./features/workspace/AdminLogin";
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
  if (session === "checking" || session === "unavailable")
    return (
      <main className="login">
        <p>
          {session === "checking"
            ? "관리자 연결을 확인하고 있습니다."
            : statusError}
        </p>
        {session === "unavailable" && (
          <Button onClick={() => void refresh()}>연결 다시 확인</Button>
        )}
      </main>
    );
  if (session === "signed_out") return <AdminLogin refresh={refresh} />;
  const pages = [
    {
      key: "broadcast",
      label: "라이브",
      title: "방송 운영",
      description: "대화를 확인하고 AI 참여를 제어하세요.",
      Icon: Radio,
    },
    {
      key: "connections",
      label: "방송 준비",
      title: "방송 준비",
      description: "입력부터 AI 모델, OBS 출력까지 연결을 준비하세요.",
      Icon: SlidersHorizontal,
    },
  ] as const;
  const current = pages.find((item) => item.key === page)!;
  return (
    <div className="operator-workspace">
      <a className="skip-link" href="#workspace-main">
        본문으로 이동
      </a>
      <aside className="workspace-sidebar">
        <a className="workspace-brand" href="#broadcast">
          <MessagesSquare aria-hidden="true" size={23} />
          <span>
            Mixed Chat<span className="brand-secondary">Studio</span>
          </span>
        </a>
        <nav className="workspace-nav nav flex-column" aria-label="운영 화면">
          {pages.map(({ key, label, Icon }) => (
            <a
              className="nav-link"
              key={key}
              href={`#${key}`}
              aria-current={page === key ? "page" : undefined}
            >
              <Icon size={19} aria-hidden="true" />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="mobile-safety">
          <Button
            className="danger"
            aria-label="AI 긴급 중지"
            onClick={() => void action("ai/stop")}
          >
            AI 중지
          </Button>
        </div>
        <div className="sidebar-footer">
          <p>로컬 방송 작업 공간</p>
          <Button
            className="secondary"
            aria-label={logout.pending ? "로그아웃 중…" : "로그아웃"}
            disabled={logout.pending}
            onClick={() =>
              void logout.run("logout", async (signal) => {
                await adminClient.request("logout", { method: "POST", signal });
                if (!signal.aborted) signOut();
              })
            }
          >
            <LogOut size={16} aria-hidden="true" />
            <span>{logout.pending ? "로그아웃 중…" : "로그아웃"}</span>
          </Button>
        </div>
      </aside>
      <main className="workspace-main" id="workspace-main" tabIndex={-1}>
        <header className="workspace-header">
          <div>
            <h1>{current.title}</h1>
            <p>{current.description}</p>
          </div>
          <div className="session-meta">
            <>
              {status?.demo && <StatusBadge>데모 · 인공 입력</StatusBadge>}
              <StatusBadge tone={status?.closed ? "neutral" : "success"}>
                {status?.closed ? "방송 종료" : "세션 진행 중"}
              </StatusBadge>
            </>
          </div>
        </header>
        {(logout.error || actions.error) && (
          <div role="alert" className="error">
            {actions.error || logout.error}
            <Button
              className="secondary"
              onClick={() => {
                logout.clearError();
                actions.clearError();
              }}
            >
              닫기
            </Button>
          </div>
        )}
        {!status ? (
          <p role="status">방송 상태를 불러오고 있습니다.</p>
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
                onReveal={() => void action("reveal")}
              />
              <BroadcastConversation
                messages={status.messages}
                cast={status.personas ?? []}
                transcripts={status.audio.history}
                pending={status.ai.pending}
                closed={status.closed}
                busy={busy}
                stale={stale}
                preview={preview}
                onAction={(path) => void action(path)}
              />
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
              />
            </div>
          </>
        )}
        <footer className="workspace-footer">
          방송 데이터는 재시작 후 유지되고 방송 종료 시 삭제됩니다.
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  location.pathname === "/reader" || location.pathname === "/overlay" ? (
    <ConversationPage />
  ) : (
    <Admin />
  ),
);
