import React from "react";

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

const states: Record<string, string> = {
  stopped: "중지",
  disabled: "비활성",
  unknown: "확인 불가",
  connecting: "연결 중",
  reconnecting: "재연결 중",
  connected: "연결됨",
  streaming: "수신 중",
  polling: "수신 중",
  receiving: "수신 중",
  listening: "음성 입력 대기",
  subscribed: "채팅 구독 중",
  config_required: "설정 필요",
  auth_required: "인증 필요",
  awaiting_browser: "관리자에서 SOOP 연결 필요",
  waiting_live: "방송 대기",
  ended: "방송 종료",
  failed: "실패",
  provider_error: "제공자 오류",
  budget_exhausted: "호출 한도 도달",
  demo_fixture: "데모 입력",
  running: "실행 중",
  waiting_for_input: "새 입력 대기",
  random_wait: "다음 발언 대기",
  generating_draft: "응답 생성 중",
  generating_draft_with_frame: "화면 확인 후 생성 중",
  ai_review: "초안 검토 중",
  awaiting_human_review: "운영자 승인 대기",
  jev_timing_filter: "발언 시점 검사 중",
  published_local: "로컬 채팅 게시 완료",
};
const label = (value?: string) => states[value ?? "unknown"] ?? value;
const age = (at: number | null | undefined, now: number) =>
  at ? `${Math.max(0, Math.floor((now - at) / 1000))}초 전` : "수신 기록 없음";

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
                ? `AI 실행 중 · ${label(status.ai.phase)}`
                : status.ai.readiness.ready
                  ? "AI 시작 준비 완료"
                  : "AI 시작 전 입력 확인이 필요합니다"}
        </strong>
        <span>2초마다 갱신 · 마지막 응답 {age(status.generatedAt, now)}</span>
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
            <span className="status">
              {stale ? "확인 불가" : label(status.capture.state)}
            </span>
          </div>
          <div className="preview dashboard-preview">
            {freshFrame && preview ? (
              <img src={preview} alt="마스크가 적용된 송출 화면 미리보기" />
            ) : (
              <p>
                {stale
                  ? "최신 상태를 확인할 수 없습니다"
                  : "최근 10초 이내 송출 화면 없음"}
              </p>
            )}
          </div>
          <p>
            {freshFrame
              ? `최근 프레임 ${age(status.capture.lastFrameAt, now)}`
              : "영상 최신성 확인 필요"}{" "}
            · {status.capture.confirmed ? "마스크 확인됨" : "마스크 확인 필요"}
          </p>
          {status.capture.lastError && (
            <p className="hint">{status.capture.lastError}</p>
          )}
          <div className="toolbar">
            <button
              className="secondary"
              disabled={
                busy || stale || !freshFrame || status.capture.confirmed
              }
              onClick={() => onAction("capture/confirm")}
            >
              마스크 확인
            </button>
            <a href="#program-details">영상 설정 및 제어</a>
          </div>
        </article>
        <article>
          <h3>실제 채팅 정보</h3>
          <ul className="platform-status">
            {["youtube", "chzzk", "soop"].map((platform) => {
              const connector = status.connectors[platform];
              return (
                <li key={platform}>
                  <strong>{platform.toUpperCase()}</strong>
                  <span>{stale ? "확인 불가" : label(connector?.state)}</span>
                  <small>
                    동의 후 수집 {connector?.received ?? "—"}개 ·{" "}
                    {age(connector?.lastReceived, now)}
                  </small>
                </li>
              );
            })}
          </ul>
          <p className="hint">
            채팅은 선택 입력입니다. 동의한 시청자의 메시지만 표시·AI 맥락에
            포함됩니다. 수신 기록이 없는 상태가 반드시 연결 오류를 뜻하지는
            않습니다.
          </p>
          <a href="#connection-details">채팅 연결 및 수신 제어</a>
        </article>
        <article>
          <div className="section-title">
            <h3>음성 인식 transcript</h3>
            <span className="status">
              {stale ? "확인 불가" : label(status.audio.state)}
            </span>
          </div>
          <p className="transcript-excerpt">
            {stale
              ? "최신 자막 상태를 확인할 수 없습니다"
              : status.audio.latestText || "아직 인식된 음성이 없습니다"}
          </p>
          <p>
            최근 자막 {age(status.audio.latestAt, now)}
            {status.audio.latestAt && now - status.audio.latestAt > 120000
              ? " · 오래된 자막"
              : ""}
          </p>
          <p className="hint">
            전사 요청 {status.audio.requests ?? "—"} /{" "}
            {status.audio.maxRequests ?? "—"} · 무음 구간은 건너뜁니다.
          </p>
          <a href="#audio-details">음성 입력 및 자막 기록</a>
        </article>
      </div>
      <div className="operations-model">
        <span>
          AI 모델: {status.ai.model ?? "확인 불가"} ·{" "}
          {stale ? "상태 확인 필요" : label(status.ai.state)} /{" "}
          {label(status.ai.phase)}
        </span>
        <span>
          호출 {status.ai.usage.calls} / {status.ai.maxCalls ?? "—"} ·{" "}
          {status.ai.costEstimate === "configured_prices"
            ? `예약 비용 $${status.ai.usage.reservedUsd.toFixed(4)}`
            : "비용 확인 불가"}
        </span>
        <a href="#ai-details">모델 연결 및 상세 설정</a>
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
        <div className="operations-notices">
          <strong>시청자 동의 안내</strong>
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
        </div>
      )}
    </section>
  );
}
