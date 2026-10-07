import {
  Radio,
  SlidersHorizontal,
  Users,
  FolderCheck,
  MessagesSquare,
  LogOut,
} from "lucide-react";
import { Button, Input, StatusBadge } from "./components/ui";
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
    {
      key: "participation",
      label: "참여자",
      title: "참여자 관리",
      description:
        status?.inputMode === "ai_stream"
          ? "AI 전용 스트림의 입력 범위를 확인하세요."
          : "안내 전달과 동의 상태를 확인하세요.",
      Icon: Users,
    },
    {
      key: "records",
      label: "기록·권리",
      title: "기록·권리 요청",
      description: "방송 이후에도 필요한 요청과 외부 영상 조치를 관리하세요.",
      Icon: FolderCheck,
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
                summary={status.chatSummary}
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
            <div
              hidden={page !== "participation" && page !== "records"}
              className="workspace-screen"
            >
              {status.demo ||
              (status.inputMode === "ai_stream" && page !== "records") ? (
                <section
                  id={page === "records" ? "records" : "participation"}
                  className="empty-panel"
                >
                  <Users size={32} aria-hidden="true" />
                  <h2>
                    {status.inputMode === "ai_stream"
                      ? "시청자 참여 절차를 사용하지 않습니다."
                      : page === "records"
                        ? "실제 방송에서 기록을 관리합니다"
                        : "실제 방송에서 참여자를 관리합니다"}
                  </h2>
                  <p>
                    {status.inputMode === "ai_stream"
                      ? "AI 전용 스트림 모드는 플랫폼 채팅을 수신·저장하지 않습니다. 방송 준비에서 AI용 화면과 마이크 음성을 확인하세요."
                      : "데모에서는 인공 입력을 사용합니다. 실제 방송의 동의·권리행사 관리는 실제 입력 모드에서 사용할 수 있습니다."}
                  </p>
                  <a href="#connections">방송 준비로 이동</a>
                </section>
              ) : (
                <ParticipationPage
                  now={now}
                  view={page === "records" ? "records" : "participation"}
                  noticeSettings={
                    <section className="panel">
                      <h2>리더·오버레이 참여 안내</h2>
                      <p className="hint">
                        플랫폼 심사 확인 후 활성화하세요. 동의 전 채팅 차단은
                        항상 유지됩니다.
                      </p>
                      <div className="toolbar">
                        {(["youtube", "chzzk", "soop"] as const).map(
                          (platform) => (
                            <label className="check-label" key={platform}>
                              <Input
                                type="checkbox"
                                checked={
                                  status.setup[platform].consentNoticeEnabled
                                }
                                disabled={busy || stale}
                                onChange={(event) =>
                                  void action(`consent-notices/${platform}`, {
                                    enabled: event.target.checked,
                                  })
                                }
                              />
                              {platform === "youtube"
                                ? "YouTube"
                                : platform === "chzzk"
                                  ? "치지직"
                                  : "SOOP"}{" "}
                              동의 안내
                            </label>
                          ),
                        )}
                      </div>
                    </section>
                  }
                />
              )}
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
