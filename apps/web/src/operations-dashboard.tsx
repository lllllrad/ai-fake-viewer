import React from "react";
import { inputHealth, chatHealth, type Health } from "./input-health";

export function normalizeAdminStatus(raw: any) {
  return {
    ...raw,
    incomplete:
      !raw.capture || !raw.audio || !raw.ai?.readiness || !raw.connectors,
    capture: {
      state: "unknown",
      lastFrameAt: null,
      lastFrameAgeMs: null,
      masks: [],
      ...raw.capture,
    },
    audio: { state: "unknown", latestAt: null, history: [], ...raw.audio },
    connectors: raw.connectors ?? {},
    messages: raw.messages ?? [],
    chatgpt: { accounts: [], ...raw.chatgpt },
    ai: {
      state: "unknown",
      phase: "unknown",
      ...raw.ai,
      readiness: { ready: false, checks: [], ...raw.ai?.readiness },
      usage: { calls: 0, reservedUsd: 0, ...raw.ai?.usage },
      pacing: { ...raw.ai?.pacing },
      gate: { ...raw.ai?.gate },
      input: { ...raw.ai?.input, last: { ...raw.ai?.input?.last } },
    },
  };
}

export function OperationsDashboard({
  status,
  stale,
  now,
  preview,
  busy,
  onAction,
  onRefresh,
  onToggle,
  onReveal,
  onNotice,
}: {
  status: any;
  stale: boolean;
  now: number;
  preview: string;
  busy: boolean;
  onAction: (path: string) => void;
  onRefresh: () => void;
  onToggle: () => void;
  onReveal: () => void;
  onNotice: (platform: string, enabled: boolean) => void;
}) {
  const running = status.ai.state === "running";
  const checks = status.ai.readiness.checks as Array<{
    id: string;
    label: string;
    ready: boolean;
    optional?: boolean;
  }>;
  const missing = checks.filter((check) => !check.ready && !check.optional);
  const freshFrame =
    !stale &&
    status.capture.lastFrameAt &&
    now - status.capture.lastFrameAt <= 10000;
  const unknown: Health = {
    label: "확인 불가",
    hint: "상태를 다시 확인하세요.",
  };
  const captureHealth: Health = stale
    ? unknown
    : freshFrame && status.capture.confirmed
      ? { label: "정상" }
      : {
          label: "확인 필요",
          hint: freshFrame
            ? "화면의 가림 영역을 확인해 주세요."
            : "송출 화면이 들어오는지 확인해 주세요.",
        };
  const audioHealth = stale ? unknown : inputHealth(status.audio.state);
  const platforms = ["youtube", "chzzk", "soop"] as const;
  const platformNames = { youtube: "유튜브", chzzk: "치지직", soop: "SOOP" };
  const chat = stale
    ? unknown
    : chatHealth(platforms.map((p) => status.connectors[p]?.state));
  const chatProblems = platforms
    .map((p) => ({ platform: p, ...inputHealth(status.connectors[p]?.state) }))
    .filter(
      (health) => health.label === "확인 필요" || health.label === "확인 불가",
    );
  const modelReady = checks.find((check) => check.id === "model")?.ready;
  const targets: Record<string, string> = {
    capture: "program-details",
    audio: "audio-details",
    model: "ai-details",
    receiver: "connection-details",
  };
  return (
    <section
      className="card operations-dashboard"
      aria-labelledby="operations-heading"
    >
      <div className="section-title">
        <div>
          <div className="eyebrow">LIVE CONTROL</div>
          <h2 id="operations-heading">방송 상태 및 AI 제어</h2>
        </div>
        <span className="status">
          {status.demo ? "데모 · 인공 입력" : "실제 방송 입력"} ·{" "}
          {status.closed ? "세션 종료" : "세션 열림"}
        </span>
      </div>
      <div className="operations-controls">
        <button
          role="switch"
          aria-checked={running}
          aria-label="AI 채팅 생성 사용"
          className={running ? "stop" : ""}
          disabled={
            !running &&
            (busy ||
              stale ||
              status.closed ||
              status.broadcastEnded ||
              !status.ai.readiness.ready)
          }
          onClick={onToggle}
        >
          AI 채팅 생성 {running ? "켜짐 · 끄기" : "꺼짐 · 켜기"}
        </button>
        <button
          className="secondary"
          disabled={busy || stale || status.originsRevealed !== false}
          onClick={onReveal}
        >
          {status.originsRevealed === true
            ? "AI 정체 공개됨"
            : "누가 AI인지 밝히기"}
        </button>
        <button className="secondary" onClick={() => onAction("ai/stop")}>
          AI 긴급 중지
        </button>
      </div>
      <p className="hint">
        정체를 공개하면 AI 생성을 중지하고 리더·오버레이에 이름과 출처를
        표시합니다. 이 세션에서는 다시 숨길 수 없습니다.
      </p>
      <div className="operations-summary" role="status">
        <strong>
          {stale
            ? "상태 응답이 오래되었거나 확인되지 않았습니다"
            : status.closed
              ? "종료된 세션입니다"
              : running
                ? "AI 채팅 생성이 켜져 있습니다"
                : status.ai.readiness.ready
                  ? "AI 시작 준비 완료"
                  : "AI 시작 전 입력 확인이 필요합니다"}
        </strong>
      </div>
      {stale ? (
        <p className="hint">
          상태를 다시 확인하세요. AI 중지는 계속 사용할 수 있습니다.
        </p>
      ) : (
        missing.length > 0 && (
          <ul className="operations-missing">
            {missing.map((check) => (
              <li key={check.id}>
                <a href={`#${targets[check.id] ?? "ai-details"}`}>
                  {check.label} 확인하기
                </a>
              </li>
            ))}
          </ul>
        )
      )}
      <div className="operations-inputs">
        <article>
          <div className="section-title">
            <h3>송출 화면</h3>
            <span className="status">{captureHealth.label}</span>
          </div>
          <div className="preview dashboard-preview">
            {freshFrame && preview ? (
              <img src={preview} alt="마스크가 적용된 송출 화면 미리보기" />
            ) : (
              <p>
                {stale
                  ? "최신 상태를 확인할 수 없습니다"
                  : "송출 화면을 기다리고 있습니다"}
              </p>
            )}
          </div>
          {captureHealth.hint && <p>{captureHealth.hint}</p>}
          <div className="toolbar">
            {!status.capture.confirmed && (
              <button
                className="secondary"
                disabled={busy || stale || !freshFrame}
                onClick={() => onAction("capture/confirm")}
              >
                마스크 확인
              </button>
            )}
            <a href="#program-details">영상 설정 및 제어</a>
          </div>
        </article>
        <article>
          <div className="section-title">
            <h3>실제 채팅 정보</h3>
            <span className="status">{chat.label}</span>
          </div>
          {!stale && chatProblems.length > 0 && (
            <ul className="input-problems">
              {chatProblems.map((problem) => (
                <li key={problem.platform}>
                  {platformNames[problem.platform]}: {problem.hint}
                </li>
              ))}
            </ul>
          )}
          {!stale && chatProblems.length === 0 && chat.hint && (
            <p>{chat.hint}</p>
          )}
          {stale && <p>채팅 상태를 다시 확인하세요.</p>}
          {chat.label === "사용 안 함" && (
            <p className="hint">채팅 연결 없이도 AI를 사용할 수 있습니다.</p>
          )}
          <a href="#connection-details">채팅 연결 및 수신 제어</a>
        </article>
        <article>
          <div className="section-title">
            <h3>음성 인식 transcript</h3>
            <span className="status">{audioHealth.label}</span>
          </div>
          <p className="transcript-excerpt">
            {stale
              ? "최신 자막 상태를 확인할 수 없습니다"
              : status.audio.latestText || "아직 인식된 음성이 없습니다"}
          </p>
          {audioHealth.hint && <p>{audioHealth.hint}</p>}
          <a href="#audio-details">음성 입력 및 자막 기록</a>
        </article>
      </div>
      <div className="operations-model">
        <span>
          AI 모델 · {stale ? "확인 불가" : modelReady ? "정상" : "확인 필요"}
        </span>
        {!stale && !modelReady && <span>모델 연결을 확인해 주세요.</span>}
        {!stale && status.ai.pending && (
          <a href="#ai-details">생성된 메시지 승인하기</a>
        )}
        {!stale &&
          status.ai.maxCalls &&
          status.ai.usage.calls >= status.ai.maxCalls * 0.8 && (
            <a href="#ai-details">AI 사용 한도 확인이 필요합니다.</a>
          )}
        <a href="#ai-details">AI 상세 설정</a>
      </div>
      <div className="toolbar">
        <button className="secondary" onClick={onRefresh}>
          상태 다시 확인
        </button>
        <button
          disabled={busy || stale || status.closed}
          onClick={() => onAction("pipeline/start")}
        >
          필수 입력 시작
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => onAction("pipeline/stop")}
        >
          입력과 AI 모두 중지
        </button>
        {status.closed && (
          <button
            disabled={busy || stale}
            onClick={() => onAction("session/new")}
          >
            새 방송 세션
          </button>
        )}
      </div>
      <p className="hint">
        입력 시작은 영상·음성·설정된 채팅 수신기를 준비합니다. 화면 마스크를
        확인한 뒤 AI 생성을 켜세요. AI만 끄면 입력 수집은 계속됩니다.
      </p>
      {!status.demo && (
        <details className="operations-notices">
          <summary>시청자 동의 안내 설정</summary>
          <p className="hint">
            플랫폼 심사 확인 후 활성화하세요. 앱 리더·오버레이의 안내만
            제어하며, 동의 전 채팅 차단은 항상 유지됩니다.
          </p>
          <div className="toolbar">
            {["youtube", "chzzk", "soop"].map((platform) => (
              <label key={platform}>
                <input
                  type="checkbox"
                  checked={
                    status.setup?.[platform]?.consentNoticeEnabled ?? false
                  }
                  disabled={busy || stale || !status.setup?.[platform]}
                  onChange={(e) => onNotice(platform, e.target.checked)}
                />{" "}
                {platform.toUpperCase()} 동의 안내
              </label>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
