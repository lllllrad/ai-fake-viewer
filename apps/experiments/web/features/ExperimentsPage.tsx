import * as Tabs from "@radix-ui/react-tabs";
import { ConversationHistory } from "./ConversationHistory";
import { ViewerStates } from "./ViewerStates";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Send, Square, Plus } from "lucide-react";
import {
  Button,
  Input,
  Select,
  ConfirmButton,
  StatusBadge,
} from "../../../web/src/components/ui";
import {
  adminClient,
  createAdminClient,
} from "../../../web/src/lib/admin-client";
import {
  experimentSessionSchema,
  experimentIndexSchema,
  experimentTraceSchema,
  type ExperimentSession,
  type ExperimentTrace,
} from "../../../../packages/contracts/interactive-experiment";
import { MicrophoneInput } from "./MicrophoneInput";
import "./experiments.css";

const audioClient = createAdminClient(fetch, 45000);
const time = (value: number) =>
  new Date(value).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const providerName = (provider: string) =>
  provider === "fixture"
    ? "오프라인 모의 응답"
    : provider === "openai_api"
      ? "Responses API"
      : "Sign in with ChatGPT";
const statusLabel = (session: ExperimentSession) => {
  if (session.endedAt)
    return session.state === "interrupted"
      ? "서버 재시작으로 종료"
      : session.state === "time_limit"
        ? "30분 한도로 종료"
        : "종료됨";
  if (session.state === "budget_exhausted") return "비용 예산 소진";
  if (session.state !== "running") return "중지됨 · 상태 확인 필요";
  if (
    ["generating", "ai_review", "inspecting", "delaying_publication"].includes(
      session.phase,
    )
  )
    return "반응을 준비하고 있습니다";
  return "시청자들이 듣고 있습니다";
};
export function ExperimentsPage({
  chatgptReady = false,
  connectionKey = "",
  connectionBusy = false,
}: {
  chatgptReady?: boolean;
  connectionKey?: string;
  connectionBusy?: boolean;
}) {
  const [index, setIndex] = useState<z.infer<typeof experimentIndexSchema>>();
  const [selected, setSelected] = useState("");
  const [session, setSession] = useState<ExperimentSession>();
  const [trace, setTrace] = useState<ExperimentTrace>();
  const [traceError, setTraceError] = useState("");
  const [view, setView] = useState<"conversation" | "states" | "trace">(
    "conversation",
  );
  const [topic, setTopic] = useState("");
  const [provider, setProvider] = useState(
    chatgptReady ? "chatgpt_subscription" : "openai_api",
  );
  const providerChosen = useRef(false);
  const [pipelineType, setPipelineType] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const selection = useRef("");
  const epoch = useRef(0);
  const mounted = useRef(true);
  const command = useRef(false);
  const inputAttempt = useRef<{ id: string; text: string } | undefined>(
    undefined,
  );
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      lifetime.current.abort();
    };
  }, []);
  const choose = (id: string) => {
    epoch.current++;
    selection.current = id;
    setSelected(id);
    setSession(undefined);
    setTrace(undefined);
    setTraceError("");
    setView("conversation");
    setError("");
    setShowSetup(!id);
    setText("");
    inputAttempt.current = undefined;
  };
  const refreshIndex = async (signal?: AbortSignal) => {
    const value = await adminClient.json("experiments", experimentIndexSchema, {
      signal,
    });
    if (mounted.current) setIndex(value);
    return value;
  };
  useEffect(() => {
    const controller = new AbortController();
    void refreshIndex(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted)
          choose(value.activeId ?? value.sessions[0]?.id ?? "");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!providerChosen.current)
      setProvider(chatgptReady ? "chatgpt_subscription" : "openai_api");
    setError("");
    const controller = new AbortController();
    void refreshIndex(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, [connectionKey, chatgptReady]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    let running = false;
    const refresh = async () => {
      if (running || command.current) return;
      running = true;
      const revision = epoch.current;
      try {
        const value = await adminClient.json(
          `experiments/${selected}`,
          experimentSessionSchema,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted && epoch.current === revision) {
          setSession(value);
          setStale(false);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setStale(true);
          setError(
            error instanceof Error
              ? error.message
              : "테스트를 불러오지 못했습니다.",
          );
        }
      } finally {
        running = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [selected]);
  useEffect(() => {
    if (session?.endedAt) void refreshIndex().catch(() => {});
  }, [session?.endedAt]);
  const act = async (work: () => Promise<void>) => {
    if (command.current) return;
    command.current = true;
    epoch.current++;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (error) {
      if (mounted.current)
        setError(
          error instanceof Error ? error.message : "작업에 실패했습니다.",
        );
    } finally {
      command.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const running = !!session && !session.endedAt && session.state === "running";
  const activeHere =
    index?.activeId === selected && !!selected && !session?.endedAt;
  const sendText = () =>
    act(async () => {
      if (!inputAttempt.current || inputAttempt.current.text !== text)
        inputAttempt.current = { id: crypto.randomUUID(), text };
      const value = await adminClient.json(
        `experiments/${selected}/input`,
        experimentSessionSchema,
        {
          method: "POST",
          body: inputAttempt.current,
          signal: lifetime.current.signal,
        },
      );
      if (mounted.current) {
        setSession(value);
        setText("");
        inputAttempt.current = undefined;
      }
    });
  useEffect(() => {
    if (!selected || view !== "trace") return;
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      const revision = epoch.current;
      try {
        const value = await adminClient.json(
          `experiments/${selected}/trace`,
          experimentTraceSchema,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted && epoch.current === revision) {
          setTrace(value);
          setTraceError("");
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setTraceError(
            error instanceof Error
              ? error.message
              : "호출 세부사항을 불러오지 못했습니다.",
          );
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [selected, view]);
  return (
    <section id="experiments" className="experiment-workspace">
      <div className="experiment-toolbar">
        <div className="experiment-history">
          <label htmlFor="experiment-history">테스트 대화</label>
          <Select
            id="experiment-history"
            value={selected}
            disabled={busy}
            onChange={(event) => choose(event.target.value)}
          >
            <option value="">새 테스트</option>
            {index?.sessions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.topic} ·{" "}
                {new Date(item.startedAt).toLocaleString("ko-KR")}
              </option>
            ))}
          </Select>
        </div>
        <Button
          className="secondary"
          disabled={busy || connectionBusy || !!index?.activeId}
          onClick={() => choose("")}
        >
          <Plus size={16} aria-hidden="true" />새 테스트
        </Button>
        {index?.activeId && index.activeId !== selected && (
          <Button className="secondary" onClick={() => choose(index.activeId!)}>
            진행 중인 대화로
          </Button>
        )}
      </div>
      <p className="hint">
        테스트 대화는 실제 방송에 전송되지 않습니다. 대화와 실행 기록은 이
        컴퓨터에 저장되며 나중에 다시 열 수 있습니다.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
          <Button
            className="secondary"
            onClick={() =>
              void act(async () => {
                await refreshIndex();
                setError("");
              })
            }
          >
            연결 다시 확인
          </Button>
        </div>
      )}
      {(!selected || showSetup) && (
        <form
          className="card experiment-setup"
          onSubmit={(event) => {
            event.preventDefault();
            if (connectionBusy) return;
            void act(async () => {
              const value = await adminClient.json(
                "experiments",
                experimentSessionSchema,
                {
                  method: "POST",
                  body: {
                    topic,
                    provider,
                    pipelineType:
                      pipelineType || index?.defaultPipelineType || "standard",
                  },
                  signal: lifetime.current.signal,
                },
              );
              if (!mounted.current) return;
              choose(value.id);
              setSession(value);
              await refreshIndex();
            });
          }}
        >
          <h2>AI 시청자와 대화하기</h2>
          <p>
            방송 주제를 정하고 말을 건네 보세요. 말투, 반응의 적절함, 침묵까지
            함께 살펴볼 수 있습니다.
          </p>
          <label htmlFor="experiment-topic">방송 주제</label>
          <Input
            id="experiment-topic"
            required
            maxLength={500}
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="예: 처음 해 보는 퍼즐 게임"
          />
          <div className="experiment-settings">
            <div>
              <label htmlFor="experiment-type">AI 유형</label>
              <Select
                id="experiment-type"
                value={pipelineType || index?.defaultPipelineType || "standard"}
                onChange={(event) => setPipelineType(event.target.value)}
              >
                {(index?.pipelineTypes ?? []).map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label} · {type.id}
                  </option>
                ))}
              </Select>
              <p className="hint">
                {
                  index?.pipelineTypes.find(
                    (type) =>
                      type.id === (pipelineType || index.defaultPipelineType),
                  )?.description
                }
              </p>
            </div>
            <div>
              <label htmlFor="experiment-provider">AI 연결</label>
              <Select
                id="experiment-provider"
                value={provider}
                onChange={(event) => {
                  providerChosen.current = true;
                  setProvider(event.target.value);
                  setError("");
                }}
              >
                <option value="openai_api">Responses API</option>
                <option value="chatgpt_subscription">
                  Sign in with ChatGPT
                </option>
                <option value="fixture">오프라인 모의 응답</option>
              </Select>
            </div>
          </div>
          <p className="hint">
            {provider === "fixture"
              ? "모의 응답은 연결 확인용입니다. 사람다운 반응을 평가하려면 실제 AI 연결을 선택하세요."
              : "선택한 연결로 테스트 입력을 보냅니다. API 사용 요금이 발생할 수 있습니다."}{" "}
            한 테스트는 최대 30분입니다.
          </p>
          <Button
            type="submit"
            disabled={busy || connectionBusy || !!index?.activeId}
          >
            {connectionBusy
              ? "AI 연결 저장 중…"
              : busy
                ? "시작 중…"
                : "테스트 시작"}
          </Button>
        </form>
      )}
      {selected && !session && (
        <p role="status">테스트 대화를 불러오고 있습니다.</p>
      )}
      {session && (
        <>
          <div className="experiment-session-heading">
            <div>
              <h2>{session.topic}</h2>
              <p className="hint">
                {providerName(session.provider)} · {session.model} · AI 유형{" "}
                {session.pipelineType}@{session.pipelineRevision} · 프로필{" "}
                {session.profile.id}@{session.profile.revision}
              </p>
            </div>
            <div className="toolbar">
              <StatusBadge tone={running ? "success" : "neutral"}>
                {statusLabel(session)}
              </StatusBadge>
              {activeHere && (
                <Button
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const value = await adminClient.json(
                        `experiments/${selected}/stop`,
                        experimentSessionSchema,
                        { method: "POST", signal: lifetime.current.signal },
                      );
                      if (mounted.current) {
                        setSession(value);
                        await refreshIndex();
                      }
                    })
                  }
                >
                  <Square size={16} aria-hidden="true" />
                  테스트 종료
                </Button>
              )}
            </div>
          </div>
          {session.endedAt && (
            <form
              className="card experiment-resume"
              onSubmit={(event) => {
                event.preventDefault();
                void act(async () => {
                  const value = await adminClient.json(
                    `experiments/${selected}/resume`,
                    experimentSessionSchema,
                    {
                      method: "POST",
                      body: {},
                      signal: lifetime.current.signal,
                    },
                  );
                  if (mounted.current) {
                    setSession(value);
                    setTrace(undefined);
                    setView("conversation");
                    await refreshIndex();
                  }
                });
              }}
            >
              <p>
                같은 대화와 시청자로 이어서 테스트합니다. 기존 AI 연결의 현재
                계정·모델을 사용하며, 새 입력부터 반응합니다.
              </p>
              <p className="hint">
                재개 후 최대 30분 동안 테스트합니다. 기존 호출 기록은
                유지됩니다.
              </p>
              {index?.activeId && (
                <p role="status">진행 중인 다른 테스트를 먼저 종료해 주세요.</p>
              )}
              <Button
                type="submit"
                disabled={busy || connectionBusy || stale || !!index?.activeId}
              >
                {busy ? "재개 중…" : "이어서 테스트"}
              </Button>
            </form>
          )}
          {session.issue && (
            <p className="error" role="status">
              {session.issue}
            </p>
          )}
          {session.provider === "fixture" && (
            <p className="hint">
              오프라인 모의 응답 · 표시되는 문장은 자연스러움 평가용 AI 응답이
              아닙니다.
            </p>
          )}
          <section
            className="card experiment-microphone"
            aria-label="마이크 입력"
          >
            <div className="section-title">
              <h2>마이크 입력</h2>
              <span className="hint">
                AI 호출 {session.calls}회 · 음성 전사 {session.microphoneCalls}/
                {index?.microphone.maxRequests ?? 360}
              </span>
            </div>
            <MicrophoneInput
              key={session.id}
              disabled={
                !running ||
                stale ||
                !index?.microphoneReady ||
                session.microphoneCalls >=
                  (index?.microphone.maxRequests ?? 360)
              }
              chunkSeconds={index?.microphone.chunkSeconds ?? 10}
              stop={async () => {
                await adminClient.request(
                  `experiments/${session.id}/audio/stop`,
                  { method: "POST" },
                );
              }}
              onError={setError}
              send={async (pcm, capturedAt, signal) => {
                const currentId = selection.current;
                const value = await audioClient.json(
                  `experiments/${currentId}/audio`,
                  experimentSessionSchema,
                  {
                    method: "POST",
                    body: { id: crypto.randomUUID(), pcm, capturedAt },
                    signal: AbortSignal.any([signal, lifetime.current.signal]),
                  },
                );
                if (mounted.current && selection.current === currentId) {
                  epoch.current++;
                  setSession(value);
                }
              }}
            />
            <p className="hint">
              {!index
                ? "음성 전사 설정을 확인하고 있습니다."
                : index.microphoneReady
                  ? `방송과 같이 ${index.microphone.chunkSeconds}초 단위로 ${index.microphone.label}에 전사합니다. 무음과 전사 중 들어온 청크는 건너뛰며, 중지 시 남은 음성은 버립니다. 원본 음성은 저장하지 않습니다.`
                  : `마이크 전사에는 서버의 ${index.microphone.keyName}가 필요합니다. 텍스트로도 테스트할 수 있습니다.`}
            </p>
            <p className="hint">
              탭을 바꿔도 계속 듣습니다. 마이크 중지 또는 테스트 종료를 누르면
              멈춥니다.
            </p>
          </section>
          <Tabs.Root
            value={view}
            onValueChange={(value) => setView(value as typeof view)}
          >
            <Tabs.List
              className="section-tabs nav nav-tabs experiment-view-controls"
              aria-label="테스트 살펴보기"
            >
              <Tabs.Trigger className="nav-link" value="conversation">
                대화 보기
              </Tabs.Trigger>
              <Tabs.Trigger className="nav-link" value="states">
                AI별 상태
              </Tabs.Trigger>
              <Tabs.Trigger className="nav-link" value="trace">
                AI 호출 세부사항
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content
              value="conversation"
              forceMount
              className="experiment-conversation-panel"
            >
              <div className="experiment-columns">
                <section
                  className="card experiment-chat"
                  aria-label="테스트 대화방"
                >
                  <ConversationHistory key={session.id} session={session} />
                  <form
                    className="experiment-composer"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (text.trim()) void sendText();
                    }}
                  >
                    <label htmlFor="experiment-message">시청자에게 할 말</label>
                    <textarea
                      className="form-control"
                      id="experiment-message"
                      rows={2}
                      maxLength={2000}
                      value={text}
                      disabled={!running || stale}
                      onChange={(event) => setText(event.target.value)}
                      placeholder={
                        running
                          ? "방송 중 하듯 이야기해 보세요."
                          : "종료된 대화입니다. 이어서 테스트를 눌러 재개해 주세요."
                      }
                    />
                    <div className="toolbar">
                      <Button
                        type="submit"
                        disabled={!running || stale || busy || !text.trim()}
                      >
                        <Send size={16} aria-hidden="true" />
                        {busy ? "처리 중…" : "보내기"}
                      </Button>
                    </div>
                  </form>
                </section>
                <aside
                  className="card experiment-personas"
                  aria-label="AI 시청자 페르소나"
                >
                  <h2>
                    함께 보는 시청자{" "}
                    <span className="hint">{session.personas.length}명</span>
                  </h2>
                  <p className="hint">
                    이름을 열어 관심사와 말투, 참여 성향을 확인하세요.
                  </p>
                  {session.personas.map((persona) => (
                    <details key={persona.id}>
                      <summary>{persona.displayName}</summary>
                      <p>{persona.snapshot.core.viewing_motive}</p>
                      <dl>
                        <dt>관심사</dt>
                        <dd>{persona.snapshot.core.interests.join(", ")}</dd>
                        <dt>성격·대화 방식</dt>
                        <dd>
                          {persona.snapshot.core.temperament} ·{" "}
                          {persona.snapshot.core.social_behavior}
                        </dd>
                        <dt>말투</dt>
                        <dd>{persona.snapshot.voice.register}</dd>
                        <dt>말할 때</dt>
                        <dd>
                          {persona.snapshot.participation.speak_when.join(
                            " · ",
                          )}
                        </dd>
                        <dt>조용히 볼 때</dt>
                        <dd>
                          {persona.snapshot.participation.stay_silent_when.join(
                            " · ",
                          )}
                        </dd>
                      </dl>
                      <details>
                        <summary>전체 페르소나 정의</summary>
                        <pre tabIndex={0}>
                          {JSON.stringify(persona.snapshot, null, 2)}
                        </pre>
                      </details>
                    </details>
                  ))}
                </aside>
              </div>
            </Tabs.Content>
            <Tabs.Content value="states">
              <ViewerStates key={session.id} session={session} />
            </Tabs.Content>
            <Tabs.Content value="trace">
              {traceError && (
                <p role="alert">{traceError} 잠시 후 다시 확인합니다.</p>
              )}
              {!trace && !traceError && (
                <p role="status">AI 호출 세부사항을 불러오고 있습니다.</p>
              )}
              {trace && (
                <section className="card experiment-trace">
                  <div className="section-title">
                    <h2>AI 호출 세부사항</h2>
                    <a
                      href={`/api/admin/experiments/${selected}/export`}
                      download
                    >
                      전체 기록 내려받기
                    </a>
                  </div>
                  <p>
                    생성·검수 등 실제 AI 호출의 프롬프트 전문과 응답을
                    확인합니다. 이 탭을 보는 동안 3초마다 갱신됩니다.
                  </p>
                  {!trace.calls.length && (
                    <p>
                      기록된 모델 호출이 없습니다. 입력이 없거나 시청자가
                      참여하지 않은 경우에도 대화는 유지됩니다.
                    </p>
                  )}
                  {trace.calls.map((call, i) => (
                    <details key={call.id ?? i}>
                      <summary>
                        호출 {i + 1} · {call.personaName ?? "시청자 정보 없음"}{" "}
                        ·{" "}
                        {call.stage === "review"
                          ? "검수"
                          : call.stage === "generation"
                            ? "생성"
                            : (call.stage ?? "단계 정보 없음")}{" "}
                        · {time(call.at)} · {call.elapsedMs}ms ·{" "}
                        {call.error
                          ? "실패"
                          : call.result
                            ? "응답 완료"
                            : "진행 중"}
                      </summary>
                      <p className="hint">
                        {call.provider
                          ? providerName(call.provider)
                          : "연결 정보 없음"}{" "}
                        · {call.model ?? "모델 정보 없음"}
                      </p>
                      <h3>모델에 보낸 요청 · 프롬프트 전문</h3>
                      <pre tabIndex={0}>
                        {JSON.stringify(call.request, null, 2)}
                      </pre>
                      <h3>응답·오류</h3>
                      <pre tabIndex={0}>
                        {JSON.stringify(
                          call.error ?? call.result ?? "응답 대기",
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  ))}
                  <details>
                    <summary>단계별 처리 기록</summary>
                    <pre tabIndex={0}>
                      {JSON.stringify(trace.diagnostics, null, 2)}
                    </pre>
                  </details>
                  <details>
                    <summary>참여·게시 시도</summary>
                    <pre tabIndex={0}>
                      {JSON.stringify(trace.attempts, null, 2)}
                    </pre>
                  </details>
                  <details>
                    <summary>적용된 프로필과 프롬프트</summary>
                    <pre tabIndex={0}>
                      {JSON.stringify(trace.pipeline, null, 2)}
                    </pre>
                  </details>
                </section>
              )}
            </Tabs.Content>
          </Tabs.Root>
          <div className="experiment-footer">
            <p className="hint">
              {session.endedAt
                ? "종료된 테스트입니다. 위에서 이어서 테스트하거나 저장된 대화와 실행 기록을 확인하세요."
                : running
                  ? "다른 화면으로 이동해도 테스트는 계속됩니다. 마치면 테스트 종료를 눌러 주세요."
                  : "테스트가 중지되었습니다. 상태를 확인하고 테스트 종료 후 새로 시작해 주세요."}
            </p>
            {!activeHere && (
              <ConfirmButton
                title="테스트 기록 삭제"
                description="이 컴퓨터에 저장된 대화, 페르소나와 실행 기록을 삭제합니다. 내려받은 파일은 별도로 관리하세요."
                confirmLabel="기록 삭제"
                className="danger"
                disabled={busy}
                onConfirm={() =>
                  void act(async () => {
                    await adminClient.request(`experiments/${selected}`, {
                      method: "DELETE",
                      signal: lifetime.current.signal,
                    });
                    choose("");
                    await refreshIndex();
                  })
                }
              >
                테스트 기록 삭제
              </ConfirmButton>
            )}
          </div>
        </>
      )}
    </section>
  );
}
