import type { AdminStatus } from "../../../packages/contracts/admin-status.ts";
import { inputHealth, chatHealth, type Health } from "./input-health";
import { Button, ConfirmButton, StatusBadge } from "./components/ui";
import {
  RefreshCw,
  Square,
  Monitor,
  MessagesSquare,
  Mic,
  ArrowRight,
} from "lucide-react";

export function OperationsDashboard({
  status,
  stale,
  now,
  busy,
  onAction,
  onRefresh,
  onToggle,
  onReveal,
}: {
  status: AdminStatus;
  stale: boolean;
  now: number;
  busy: boolean;
  onAction: (path: string) => void;
  onRefresh: () => void;
  onToggle: () => void;
  onReveal: () => void;
}) {
  const running = status.aiDesiredRunning || status.ai.state === "running";
  const missing = status.ai.readiness.checks.filter(
    (check) => !check.ready && !check.optional,
  );
  const freshFrame =
    !stale &&
    status.capture.lastFrameAt &&
    now - status.capture.lastFrameAt <= 10000;
  const unknown: Health = {
    label: "확인 불가",
    hint: "상태를 다시 확인하세요.",
  };
  const capture: Health = stale
    ? unknown
    : freshFrame
      ? { label: "정상" }
      : {
          label: "확인 필요",
          hint:
            status.capture.configured === false
              ? "송출 화면 연결 설정이 없습니다. capture 설정을 확인해 주세요."
              : "설정된 송출 화면이 들어오지 않습니다. OBS 송출과 연결 설정을 확인해 주세요.",
        };
  const audio = stale
    ? unknown
    : inputHealth(status.audio.state, "transcription");
  const platforms = ["youtube", "chzzk", "soop"] as const;
  const names = { youtube: "유튜브", chzzk: "치지직", soop: "SOOP" };
  const chat = stale
    ? unknown
    : chatHealth(platforms.map((p) => status.connectors[p]?.state));
  const problems = platforms
    .map((p) => ({
      platform: p,
      ...inputHealth(status.connectors[p]?.state, "chat_read"),
    }))
    .filter((p) => p.label === "확인 필요" || p.label === "확인 불가");
  const targets: Record<string, string> = {
    capture: "program-details",
    audio: "audio-details",
    privacy: "privacy-panel",
    model: "ai-details",
    receiver: "connection-details",
  };
  const stateText = stale
    ? "상태 응답이 오래되었거나 확인되지 않았습니다"
    : status.closed
      ? "종료된 세션입니다"
      : status.originsRevealed
        ? "AI 공개 완료 · 생성 중지"
        : running
          ? status.ai.state === "waiting_restart_inputs"
            ? "AI 연결 복구를 기다리고 있습니다"
            : "AI 채팅 생성이 켜져 있습니다"
          : status.ai.readiness.ready
            ? "AI 시작 준비 완료"
            : "AI 시작 전 입력 확인이 필요합니다";
  return (
    <section className="operations-dashboard" aria-label="방송 상태 및 AI 제어">
      <div className="live-control-bar">
        <div className="ai-control">
          <div>
            <h2 id="operations-heading">AI 채팅 생성</h2>
            <p role="status" className="control-status">
              {stateText}
            </p>
          </div>
          <Button
            role="switch"
            aria-checked={running}
            aria-label="AI 채팅 생성 사용"
            className={`ai-switch ${running ? "is-on" : "secondary"}`}
            disabled={
              !running &&
              (busy ||
                stale ||
                status.closed ||
                status.broadcastEnded ||
                !status.ai.readiness.ready ||
                status.originsRevealed)
            }
            onClick={onToggle}
          >
            <span className="switch-track" aria-hidden="true">
              <span />
            </span>
            {running ? "켜짐" : "꺼짐"}
          </Button>
        </div>
        <div className="live-actions">
          <Button className="danger" onClick={() => onAction("ai/stop")}>
            <Square size={15} aria-hidden="true" />
            AI 긴급 중지
          </Button>
          {status.closed ? (
            <Button
              disabled={busy || stale}
              onClick={() => onAction("session/new")}
            >
              새 방송 세션
            </Button>
          ) : (
            <ConfirmButton
              className="secondary"
              disabled={busy}
              title="방송을 종료할까요?"
              description="채팅·동의·자막·AI 시청자 기록을 삭제합니다. 서버 재시작과 달리 복구할 수 없습니다. 외부 영상과 권리 요청은 별도로 관리합니다."
              confirmLabel="방송 종료"
              onConfirm={() => onAction("session/close")}
            >
              방송 종료
            </ConfirmButton>
          )}
        </div>
      </div>
      {(stale || missing.length > 0) && (
        <div className="readiness-notice" role="status">
          {stale ? (
            <span>
              상태를 다시 확인하세요. AI 중지는 계속 사용할 수 있습니다.
            </span>
          ) : (
            <>
              <strong>시작 전 확인</strong>
              <div>
                {missing.map((check) => (
                  <a
                    key={check.id}
                    href={`#${targets[check.id] ?? "ai-details"}`}
                  >
                    {check.label} 확인하기{" "}
                    <ArrowRight size={14} aria-hidden="true" />
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {status.ai.lastIssue && (
        <p className="error" role="status">
          {status.ai.lastIssue.message}
        </p>
      )}
      {!stale && !!status.apiIssues?.length && (
        <div className="error">
          <ul aria-label="API 사용 한도 및 권한 문제">
            {status.apiIssues.map((issue) => (
              <li key={`${issue.api}:${issue.operation}`}>
                {issue.api} · {issue.operation}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="source-strip">
        {[
          {
            title: "송출 화면",
            health: capture,
            href: "program-details",
            label: "영상 설정 및 제어",
            Icon: Monitor,
          },
          {
            title: "실제 채팅 정보",
            health: chat,
            href: "connection-details",
            label: "채팅 연결 및 수신 제어",
            Icon: MessagesSquare,
          },
          {
            title: "음성 자막",
            health: audio,
            href: "audio-details",
            label: "음성 입력 및 자막 기록",
            Icon: Mic,
          },
        ].map(({ title, health, href, label, Icon }) => (
          <article key={href}>
            <details>
              <summary>
                <Icon size={17} aria-hidden="true" />
                <h3>{title}</h3>
                <StatusBadge
                  tone={
                    health.label === "정상"
                      ? "success"
                      : health.label === "확인 필요"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {health.label}
                </StatusBadge>
              </summary>
              <div className="source-detail">
                {health.hint && <p>{health.hint}</p>}
                {href === "connection-details" &&
                  !stale &&
                  problems.map((p) => (
                    <p key={p.platform}>
                      {names[p.platform]}: {p.hint}
                    </p>
                  ))}
                {href === "audio-details" && (
                  <p>
                    {stale
                      ? "최신 자막 상태를 확인할 수 없습니다"
                      : status.audio.latestText ||
                        "아직 인식된 음성이 없습니다"}
                  </p>
                )}
                <a href={`#${href}`}>{label}</a>
              </div>
            </details>
          </article>
        ))}
      </div>
      <div className="broadcast-toolbar">
        <div className="toolbar input-actions">
          <Button
            className="secondary"
            disabled={busy || stale || status.closed}
            onClick={() => onAction("pipeline/start")}
          >
            필수 입력 시작
          </Button>
          <Button
            className="secondary"
            disabled={busy}
            onClick={() => onAction("pipeline/stop")}
          >
            입력과 AI 모두 중지
          </Button>
          <Button
            className="secondary refresh-button"
            onClick={onRefresh}
            aria-label="상태 다시 확인"
          >
            <RefreshCw size={16} aria-hidden="true" />
            <span>새로고침</span>
          </Button>
        </div>
        {status.originsRevealed ? (
          <span className="reveal-status" role="status">
            AI 채팅에 ‘AI 생성’ 표시 중
          </span>
        ) : (
          <ConfirmButton
            className="secondary disclosure-button"
            disabled={
              busy || stale || status.closed || status.originsRevealed !== false
            }
            title="AI 채팅의 출처를 공개할까요?"
            description="AI 생성을 중지하고 리더·오버레이의 AI 채팅에 ‘AI 생성’ 표시를 붙입니다. 닉네임은 유지되며 AI 여부와 출처가 공개됩니다. 이 방송에서는 다시 숨길 수 없습니다."
            confirmLabel="AI 생성 표시하기"
            onConfirm={onReveal}
          >
            AI 채팅에 ‘AI 생성’ 표시하기
          </ConfirmButton>
        )}
      </div>
    </section>
  );
}
