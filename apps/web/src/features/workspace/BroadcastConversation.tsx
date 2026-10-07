import { MessageSquare, Monitor } from "lucide-react";
import { Button, SectionTabs, ConfirmButton } from "../../components/ui";
import type { ConversationMessage } from "../../../../../packages/contracts/conversation.ts";

interface CastMember {
  id: string;
  name: string;
  motive: string;
  participation: string;
}
interface Transcript {
  id: string;
  capturedAt: number;
  text: string;
}
export function BroadcastConversation({
  preview,
  messages,
  cast,
  transcripts,
  pending,
  closed,
  busy,
  stale,
  onAction,
}: {
  preview: string;
  messages: ConversationMessage[];
  cast: CastMember[];
  transcripts: Transcript[];
  pending?: { text: string | null } | null;
  closed: boolean;
  busy: boolean;
  stale: boolean;
  onAction: (path: string) => void;
}) {
  return (
    <div className="broadcast-columns">
      <div className="conversation-work">
        {pending && (
          <section
            id="review-candidate"
            className="card review-candidate"
            aria-label="AI 메시지 검토"
          >
            <h2>게시 전 확인</h2>
            <p>{pending.text}</p>
            <div className="toolbar">
              <Button
                disabled={busy || stale}
                onClick={() => onAction("ai/approve")}
              >
                AI 채팅 게시
              </Button>
              <Button
                className="secondary"
                disabled={busy}
                onClick={() => onAction("ai/reject")}
              >
                초안 버리기
              </Button>
            </div>
          </section>
        )}

        <section
          className="card broadcast-conversation"
          aria-label="최근 방송 대화"
        >
          <div className="section-title">
            <h2>
              <MessageSquare size={19} aria-hidden="true" />
              최근 대화
            </h2>
            <span className="workspace-caption">최대 30개</span>
          </div>
          <p className="hint">
            실제 시청자 채팅은 표시만 하며 AI에게 전달하지 않습니다. 숨기면
            리더·OBS 채팅창에서도 제거됩니다.
          </p>
          {!messages.length && (
            <p className="workspace-empty">
              {closed
                ? "방송이 종료되어 대화 기록을 비웠습니다."
                : "시청자 채팅과 AI 반응을 기다리고 있습니다."}
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
                  <Button
                    className="secondary"
                    disabled={busy}
                    aria-label={`${message.displayName} 채팅 숨기기`}
                    onClick={() => onAction(`messages/${message.id}/hide`)}
                  >
                    숨기기
                  </Button>
                </article>
              ))}
          </div>
        </section>
      </div>
      <aside className="broadcast-context" aria-label="방송 참고 정보">
        <section className="panel monitor-panel">
          <div className="section-title">
            <h2>
              <Monitor size={18} aria-hidden="true" />
              송출 미리보기
            </h2>
            <a href="#program-details">설정</a>
          </div>
          <div className="preview">
            {preview && !stale && !closed ? (
              <img src={preview} alt="송출 화면 미리보기" />
            ) : (
              <p>
                {closed ? "종료된 방송입니다" : "송출 화면을 기다리고 있습니다"}
              </p>
            )}
          </div>
        </section>
        <SectionTabs
          label="방송 참고 정보"
          items={[
            {
              value: "transcripts",
              label: "음성 자막",
              content: (
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
                            {new Date(entry.capturedAt).toLocaleTimeString(
                              "ko-KR",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </time>
                          <p>{entry.text}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              ),
            },
            {
              value: "cast",
              label: "AI 시청자",
              content: (
                <section className="card persona-studio">
                  <h2>자동 시청자 페르소나</h2>
                  <p className="hint">
                    AI 채팅을 켜면 참여 방식이 다른 시청자가 자동으로
                    구성됩니다.
                  </p>
                  {!cast.length ? (
                    <p>아직 준비된 AI 시청자가 없습니다.</p>
                  ) : (
                    <details>
                      <summary>페르소나 {cast.length}명 보기</summary>
                      <div className="persona-candidates">
                        {cast.map((person) => (
                          <article
                            className="persona-candidate"
                            key={person.id}
                          >
                            <h3>{person.name}</h3>
                            <p>{person.motive}</p>
                            <p className="hint">{person.participation}</p>
                          </article>
                        ))}
                      </div>
                    </details>
                  )}
                </section>
              ),
            },
          ]}
        />
        <details className="session-tools">
          <summary>방송 데이터 관리</summary>
          <p>
            현재 방송의 데이터를 삭제합니다. 외부 영상과 사본은 별도로
            관리하세요.
          </p>
          <ConfirmButton
            className="danger"
            disabled={busy}
            title="방송 데이터를 삭제할까요?"
            description="현재 방송 데이터를 모두 삭제합니다. 이 작업은 되돌릴 수 없습니다."
            confirmLabel="방송 데이터 삭제"
            onConfirm={() => onAction("data/delete")}
          >
            방송 데이터 삭제
          </ConfirmButton>
        </details>
      </aside>
    </div>
  );
}
