import { useState, useRef, useEffect } from "react";
import type { AdminStatus } from "../../../../../packages/contracts/admin-status.ts";
import type { AvailableModel } from "../../../../../packages/contracts/connections.ts";
import { connectionApi } from "./api.ts";
import { useConnectionActions } from "./use-connection-actions.ts";
export function AiConnection({
  status,
  stale,
  refresh,
}: {
  status: AdminStatus;
  stale: boolean;
  refresh: () => Promise<void>;
}) {
  const actions = useConnectionActions(refresh),
    [models, setModels] = useState<AvailableModel[]>([]),
    [loginUrl, setLoginUrl] = useState("");
  const activeAccount = useRef(status.chatgpt.active);
  activeAccount.current = status.chatgpt.active;
  useEffect(() => {
    setModels([]);
    setLoginUrl("");
  }, [status.chatgpt.active]);
  const authorize = (clientId?: string) =>
    void actions.run("account", async (signal) => {
      const { url } = await connectionApi.authorize(
        "chatgpt",
        signal,
        clientId,
      );
      if (signal.aborted) return;
      setLoginUrl(url);
      window.open(url, "_blank", "noopener,noreferrer");
    });
  const ready = status.ai.readiness.checks.find(
    (check) => check.id === "model",
  )?.ready;
  return (
    <section className="card" id="ai-details" aria-label="AI 계정과 모델">
      <div className="section-title">
        <h2>AI 계정과 모델</h2>
        <span className="status">
          {stale ? "확인 불가" : ready ? "정상" : "확인 필요"}
        </span>
      </div>
      <p>
        {status.demo
          ? "데모 AI"
          : status.ai.provider === "chatgpt_subscription"
            ? "Sign in with ChatGPT"
            : "Responses API · API 키 인증"}{" "}
        · {status.ai.model}
      </p>
      {actions.error && (
        <p role="alert" className="error">
          {actions.error}
        </p>
      )}
      {!status.demo && status.ai.provider === "chatgpt_subscription" ? (
        <>
          <div className="toolbar">
            <button
              disabled={stale || actions.busy("account")}
              onClick={() => authorize()}
            >
              Sign in with ChatGPT
            </button>
            <button
              className="secondary"
              disabled={stale || actions.busy("models")}
              onClick={() =>
                void actions.run("models", async (signal) => {
                  const account = activeAccount.current;
                  const result = await connectionApi.models(signal);
                  if (!signal.aborted && account === activeAccount.current)
                    setModels(result.models);
                })
              }
            >
              모델 목록 불러오기
            </button>
          </div>
          {loginUrl && (
            <p>
              <a href={loginUrl} target="_blank" rel="noopener noreferrer">
                로그인 창이 열리지 않으면 여기를 누르세요.
              </a>
            </p>
          )}
          <div className="account-list">
            {status.chatgpt.accounts.map((account) => (
              <div className="account-row" key={account.clientId}>
                <div>
                  <strong>{account.email || "ChatGPT 계정"}</strong>
                  <p>
                    {status.chatgpt.active === account.clientId
                      ? "현재 사용 중"
                      : "선택 가능한 계정"}{" "}
                    · {account.connected ? "연결됨" : "재인증 필요"}
                  </p>
                </div>
                <div className="toolbar">
                  <button
                    className="secondary"
                    disabled={
                      stale ||
                      actions.busy("account") ||
                      status.chatgpt.active === account.clientId
                    }
                    onClick={() =>
                      void actions.run("account", (signal) =>
                        connectionApi.command(
                          "chatgpt/select-account",
                          signal,
                          { clientId: account.clientId },
                        ),
                      )
                    }
                  >
                    이 계정 사용
                  </button>
                  <button
                    className="secondary"
                    disabled={stale || actions.busy("account")}
                    onClick={() => authorize(account.clientId)}
                  >
                    다시 인증
                  </button>
                </div>
              </div>
            ))}
          </div>
          {!!models.length && (
            <div>
              <label htmlFor="ai-model-choice">AI 모델</label>
              <select
                id="ai-model-choice"
                value={
                  models.some((model) => model.slug === status.ai.model)
                    ? status.ai.model
                    : ""
                }
                disabled={stale || actions.busy("account")}
                onChange={(event) =>
                  void actions.run("account", (signal) =>
                    connectionApi.command("chatgpt/select-model", signal, {
                      slug: event.target.value,
                    }),
                  )
                }
              >
                <option value="" disabled>
                  모델 선택
                </option>
                {models.map((model) => (
                  <option value={model.slug} key={model.slug}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {status.chatgpt.active && (
            <button
              className="secondary"
              disabled={actions.busy("account")}
              onClick={() =>
                void actions.run("account", (signal) =>
                  connectionApi.command("chatgpt/disconnect", signal),
                )
              }
            >
              현재 AI 계정 연결 해제
            </button>
          )}
          <p className="hint">
            계정·모델을 바꾸면 AI 생성을 중지하고 관련 문맥을 다시 확인합니다.
          </p>
        </>
      ) : (
        !status.demo && (
          <p className="hint">
            .env에 OPENAI_API_KEY와 OPENAI_MODEL을 설정한 뒤 서버를
            재시작하세요.
          </p>
        )
      )}
      <details>
        <summary>생성·검토·사용량</summary>
        <p>
          호출 {status.ai.usage.calls} / {status.ai.maxCalls}회 · 건너뜀{" "}
          {status.ai.skips}회 · 검토 제외 {status.ai.rejects}회
        </p>
        <p>
          {status.ai.costEstimate === "unavailable"
            ? "비용 추정 미지원 · 호출 한도 적용 중"
            : `사용·예약 비용 추정: $${status.ai.usage.reservedUsd.toFixed(4)}`}
        </p>
        <p>
          반응 간격 {status.ai.pacing.minSeconds}–{status.ai.pacing.maxSeconds}
          초 · 문맥 {status.ai.contextWindowSeconds}초 ·{" "}
          {status.ai.visualMode === "on_request"
            ? "필요할 때 화면 확인"
            : "항상 화면 참고"}
        </p>
        <p>
          초안 검토 {status.ai.reviewDraft ? "사용" : "사용 안 함"} · 검토 호출{" "}
          {status.ai.reviewCount}회 ·{" "}
          {status.ai.manualApproval
            ? "방송 화면에서 운영자 승인 필요"
            : "검토 통과 시 자동 게시"}
        </p>
        {status.ai.gate.enabled && (
          <p>
            반응 시점 검사 {status.ai.gate.requests} /{" "}
            {status.ai.gate.maxRequests}회 · 보류 {status.ai.gate.filtered}회 ·
            오류 {status.ai.gate.errors}회
          </p>
        )}
        <p>
          모델은 도구를 실행하거나 플랫폼에 채팅을 발송하지 않습니다. 응답은 이
          앱의 대화에 게시됩니다.
        </p>
        <a
          href="https://chatgpt.com/settings/usage"
          target="_blank"
          rel="noreferrer"
        >
          ChatGPT 사용량 확인
        </a>
      </details>
      {!!status.apiIssues.length && (
        <ul aria-label="API 사용 한도 및 권한 문제">
          {status.apiIssues.map((issue) => (
            <li key={`${issue.api}:${issue.operation}`}>
              {issue.api} · {issue.operation}: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
