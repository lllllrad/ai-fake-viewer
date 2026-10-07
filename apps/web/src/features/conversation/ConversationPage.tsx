import { Button, Input } from "../../components/ui";
import { useEffect, useRef, useState } from "react";
import { ConversationList } from "./ConversationList.tsx";
import { useConversation } from "./use-conversation.ts";
import "./conversation.css";

function hashToken() {
  try {
    return decodeURIComponent(location.hash.slice(1));
  } catch {
    return "";
  }
}
function ReaderAccess({
  denied,
  onConnect,
}: {
  denied: boolean;
  onConnect: (token: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <main className="reader-access">
      <h1>대화에 연결하기</h1>
      <p>운영자가 공유한 채팅 링크를 열거나 리더 접속 토큰을 입력해 주세요.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onConnect(value.trim());
        }}
      >
        <label>
          리더 접속 토큰
          <Input
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <Button type="submit">채팅 열기</Button>
      </form>
      {denied && (
        <p role="alert">
          접속 권한을 확인할 수 없습니다. 새 링크나 토큰으로 다시 연결해 주세요.
        </p>
      )}
    </main>
  );
}

export function ConversationPage() {
  const overlay = location.pathname === "/overlay";
  const [token, setToken] = useState(hashToken);
  const [follow, setFollow] = useState(true);
  const end = useRef<HTMLDivElement>(null);
  const { conversation, connection } = useConversation(token);
  useEffect(() => {
    const changed = () => setToken(hashToken());
    window.addEventListener("hashchange", changed);
    document.body.classList.add("conversation-surface");
    document.body.classList.toggle("overlay", overlay);
    document.documentElement.classList.toggle("overlay", overlay);
    return () => {
      window.removeEventListener("hashchange", changed);
      document.body.classList.remove("conversation-surface", "overlay");
      document.documentElement.classList.remove("overlay");
    };
  }, [overlay]);
  useEffect(() => {
    if (follow && !overlay) end.current?.scrollIntoView({ block: "end" });
  }, [conversation.messages, follow, overlay]);
  if (!token || connection === "denied")
    return (
      <ReaderAccess
        denied={connection === "denied"}
        onConnect={(value) => {
          location.hash = value;
          setToken(value);
        }}
      />
    );
  const state = conversation.closed
    ? "방송 종료"
    : connection === "connected"
      ? "연결됨"
      : connection === "connecting"
        ? "연결 중"
        : "연결 확인 중";
  return (
    <main
      className={`conversation-page ${overlay ? "conversation-overlay" : "conversation-reader"}`}
    >
      {!overlay && (
        <header className="conversation-header">
          <div>
            <h1>방송 채팅</h1>
          </div>
          <span className="conversation-connection" role="status">
            {state}
          </span>
        </header>
      )}
      <aside className="conversation-disclosure">
        {conversation.demo && <strong>데모 · 인공 입력 / </strong>}실시간 채팅과
        AI 시청자의 반응이 함께 표시됩니다.
      </aside>
      {conversation.noticeAt !== null && (
        <aside className="conversation-guidance" role="status">
          안내를 확인한 뒤 <strong>!동의</strong>를 입력하면 이후 채팅이
          표시됩니다. 철회하려면 <strong>!철회</strong>를 입력하세요.
        </aside>
      )}
      <ConversationList
        messages={conversation.messages}
        overlay={overlay}
        empty={
          conversation.closed
            ? "방송이 종료되어 대화 기록을 비웠습니다."
            : connection !== "connected"
              ? "채팅 연결을 확인하고 있습니다."
              : "첫 채팅을 기다리고 있습니다."
        }
      />
      <div ref={end} />
      {!overlay && (
        <footer className="conversation-toolbar">
          <label>
            <Input
              type="checkbox"
              checked={follow}
              onChange={(event) => setFollow(event.target.checked)}
            />
            새 채팅 따라가기
          </label>
          <Button
            type="button"
            onClick={() => {
              setFollow(true);
              end.current?.scrollIntoView({ block: "end" });
            }}
          >
            최근 채팅으로 이동 ↓
          </Button>
        </footer>
      )}
    </main>
  );
}
