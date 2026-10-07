import { useRef, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "../../../web/src/components/ui";
import type { ExperimentSession } from "../../../../packages/contracts/interactive-experiment";

const time = (value: number) => new Date(value).toLocaleTimeString("ko-KR");

function History({
  title,
  label,
  children,
}: {
  title: string;
  label: string;
  children: ReactNode;
}) {
  const log = useRef<HTMLDivElement>(null);
  return (
    <section className="experiment-history" aria-label={title}>
      <header>
        <h3>{title}</h3>
        <Button
          className="secondary"
          onClick={() => {
            if (log.current) log.current.scrollTop = log.current.scrollHeight;
          }}
        >
          <ArrowDown size={16} aria-hidden="true" />
          최근 {label}
        </Button>
      </header>
      <div
        ref={log}
        className="experiment-log"
        role="log"
        aria-label={title + " 내용"}
        aria-live="polite"
        tabIndex={0}
      >
        {children}
      </div>
    </section>
  );
}

export function ConversationHistory({
  session,
}: {
  session: ExperimentSession;
}) {
  return (
    <div className="experiment-histories">
      <History title="내 입력 · 음성 전사" label="입력으로">
        {!session.inputs.length && (
          <p className="experiment-empty">
            텍스트를 보내거나 마이크로 말하면 여기에 표시됩니다.
          </p>
        )}
        {session.inputs.map((input) => (
          <article className="experiment-message own" key={input.id}>
            <div>
              <strong>나</strong>
              <span>
                {input.source === "microphone"
                  ? "나 · 음성 전사"
                  : "나 · 텍스트"}
              </span>
              <time>{time(input.at)}</time>
            </div>
            <p>{input.text}</p>
          </article>
        ))}
      </History>
      <History title="AI 채팅" label="채팅으로">
        {!session.messages.length && (
          <p className="experiment-empty">
            AI 시청자의 반응이 여기에 표시됩니다. 관심과 참여 성향에 따라 답하지
            않을 수도 있습니다.
          </p>
        )}
        {session.messages.map((message) => (
          <article className="experiment-message" key={message.id}>
            <div>
              <strong>{message.displayName}</strong>
              <span>AI 시청자</span>
              <time>{time(message.displayTime)}</time>
            </div>
            <p>{message.text}</p>
          </article>
        ))}
      </History>
    </div>
  );
}
