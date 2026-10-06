import type { ConversationMessage } from "../../../../../packages/contracts/conversation.ts";

interface CastMember {
  id: string;
  name: string;
  motive: string;
  participation: string;
}
interface Summary {
  state: string;
  topics: string[];
  atmosphere: string[];
}
interface Transcript {
  id: string;
  capturedAt: number;
  text: string;
}
export function BroadcastConversation({
  messages,
  cast,
  summary,
  transcripts,
  pending,
  closed,
  busy,
  stale,
  onAction,
}: {
  messages: ConversationMessage[];
  cast: CastMember[];
  summary?: Summary;
  transcripts: Transcript[];
  pending?: { text: string | null } | null;
  closed: boolean;
  busy: boolean;
  stale: boolean;
  onAction: (path: string) => void;
}) {
  const destructive = (path: string, message: string) => {
    if (window.confirm(message)) onAction(path);
  };
  return (
    <>
      {pending && (
        <section
          id="review-candidate"
          className="card review-candidate"
          aria-label="AI 메시지 검토"
        >
          <h2>게시 전 확인</h2>
          <p>{pending.text}</p>
          <div className="toolbar">
            <button
              disabled={busy || stale}
              onClick={() => onAction("ai/approve")}
            >
              AI 채팅 게시
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => onAction("ai/reject")}
            >
              초안 버리기
            </button>
          </div>
        </section>
      )}
      <div className="broadcast-columns">
        <section
          className="card broadcast-conversation"
          aria-label="최근 방송 대화"
        >
          <div className="section-title">
            <h2>최근 대화</h2>
            <span className="workspace-caption">최대 30개</span>
          </div>
          <p className="hint">
            숨긴 채팅은 이 앱과 AI 문맥에서 제거됩니다. 원래 플랫폼의 채팅은
            유지됩니다.
          </p>
          {!messages.length && (
            <p className="workspace-empty">
              {closed
                ? "방송이 종료되어 대화 기록을 비웠습니다."
                : "동의한 시청자의 채팅과 AI 반응을 기다리고 있습니다."}
            </p>
          )}
          <div className="operator-messages">
            {messages
              .slice(-30)
              .reverse()
              .map((message) => (
                <article key={message.id} className="operator-message">
                  <div>
                    <strong>{message.displayName}</strong>
                    <time>
                      {new Date(message.displayTime).toLocaleTimeString(
                        "ko-KR",
                        { hour: "2-digit", minute: "2-digit" },
                      )}
                    </time>
                  </div>
                  <p>{message.text}</p>
                  <button
                    className="secondary"
                    disabled={busy}
                    aria-label={`${message.displayName} 채팅 숨기기`}
                    onClick={() => onAction(`messages/${message.id}/hide`)}
                  >
                    숨기기
                  </button>
                </article>
              ))}
          </div>
        </section>
        <div className="broadcast-context">
          <section className="card" aria-label="최근 음성 자막">
            <h2>최근 음성 자막</h2>
            <p className="hint">최근 10청크를 AI 입력에 사용합니다.</p>
            {!transcripts.length ? (
              <p className="workspace-empty">
                인식된 음성을 기다리고 있습니다.
              </p>
            ) : (
              <ol className="transcript-history">
                {transcripts.slice(0, 10).map((entry) => (
                  <li key={entry.id}>
                    <time>
                      {new Date(entry.capturedAt).toLocaleTimeString("ko-KR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <p>{entry.text}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="card persona-studio">
            <h2>자동 시청자 페르소나</h2>
            <p className="hint">
              AI 채팅을 켜면 참여 방식이 다른 시청자가 자동으로 구성됩니다.
            </p>
            {!cast.length ? (
              <p>아직 준비된 AI 시청자가 없습니다.</p>
            ) : (
              <details>
                <summary>페르소나 {cast.length}명 보기</summary>
                <div className="persona-candidates">
                  {cast.map((person) => (
                    <article className="persona-candidate" key={person.id}>
                      <h3>{person.name}</h3>
                      <p>{person.motive}</p>
                      <p className="hint">{person.participation}</p>
                    </article>
                  ))}
                </div>
              </details>
            )}
          </section>
          <section className="card" aria-label="익명 채팅 요약">
            <h2>채팅 분위기·주제 요약</h2>
            <p className="hint">
              여러 참여자의 공통 주제와 분위기만 보관하며 원문·닉네임은 포함하지
              않습니다.
            </p>
            {summary?.state === "available" ? (
              <>
                <p>주제: {summary.topics.join(" · ") || "공통 주제 없음"}</p>
                <p>
                  분위기: {summary.atmosphere.join(" · ") || "공통 표현 없음"}
                </p>
              </>
            ) : (
              <p>공통 분위기를 요약할 채팅이 아직 부족합니다.</p>
            )}
            <button
              className="secondary"
              disabled={busy || stale}
              onClick={() => onAction("chat-summary/clear")}
            >
              채팅 요약 초기화
            </button>
          </section>
        </div>
      </div>
      <section
        className="card broadcast-lifetime"
        aria-label="방송 종료 및 데이터 관리"
      >
        <div>
          <h2>방송 수명주기</h2>
          <p>
            서버 재시작은 현재 방송을 유지합니다. 방송 종료는 채팅·동의·자막·AI
            시청자 기록을 삭제합니다.
          </p>
        </div>
        <div className="toolbar">
          {!closed && (
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                destructive(
                  "session/close",
                  "방송을 종료하고 채팅·동의·자막·AI 시청자 기록을 삭제할까요? 서버 재시작과 달리 복구할 수 없습니다.",
                )
              }
            >
              방송 종료
            </button>
          )}
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              destructive(
                "data/delete",
                "현재 방송 데이터를 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.",
              )
            }
          >
            방송 데이터 삭제
          </button>
        </div>
      </section>
    </>
  );
}
