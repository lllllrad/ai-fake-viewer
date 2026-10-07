import type { ConversationMessage } from "../../../../../packages/contracts/conversation.ts";
const labels: Record<string, string> = {
  youtube: "YouTube",
  chzzk: "CHZZK",
  soop: "SOOP",
  experiment: "AI 생성",
};
const time = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export function ConversationList({
  messages,
  overlay = false,
  empty = "채팅을 기다리고 있습니다.",
}: {
  messages: ConversationMessage[];
  overlay?: boolean;
  empty?: string;
}) {
  return (
    <section
      className="conversation-list"
      aria-label="방송 대화"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {!messages.length && <p className="conversation-empty">{empty}</p>}
      {(overlay ? messages.slice(-12) : messages).map((message) => (
        <article
          className="conversation-row"
          key={message.id}
          data-message-id={message.id}
        >
          <span className="conversation-avatar" aria-hidden="true">
            {Array.from(message.displayName)[0] ?? "·"}
          </span>
          <div className="conversation-content">
            <header className="conversation-meta">
              <strong>{message.displayName}</strong>
              {message.attribution !== "mixed" && (
                <span className="conversation-origin">
                  {labels[message.attribution] ?? message.attribution}
                </span>
              )}
              <time dateTime={new Date(message.displayTime).toISOString()}>
                {time.format(message.displayTime)}
              </time>
            </header>
            <p>{message.text}</p>
          </div>
        </article>
      ))}
    </section>
  );
}
