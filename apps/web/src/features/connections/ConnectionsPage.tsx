import { DisplayChatConnections } from "./DisplayChatConnections.tsx";
import { SectionTabs } from "../../components/ui";
import { useLocationHash, navigateWorkspaceTab } from "../workspace/navigation";
import type { AdminStatus } from "../../../../../packages/contracts/admin-status.ts";
import { MediaConnections } from "./MediaConnections.tsx";
import { AiConnection } from "./AiConnection.tsx";
import { ReaderLinks } from "./ReaderLinks.tsx";
export function ConnectionsPage({
  status,
  stale,
  preview,
  refresh,
}: {
  status: AdminStatus;
  stale: boolean;
  preview: string;
  refresh: () => Promise<void>;
}) {
  const hash = useLocationHash().slice(1);
  const tab =
    hash === "chat-details"
      ? "chat"
      : !["ai-details", "reader-links"].includes(hash) ||
          ["program-details", "audio-details"].includes(hash)
        ? "media"
        : hash === "ai-details"
          ? "ai"
          : hash === "reader-links"
            ? "output"
            : "media";
  const paths: Record<string, string> = {
    chat: "chat-details",
    media: "program-details",
    ai: "ai-details",
    output: "reader-links",
  };
  return (
    <>
      <h2 className="visually-hidden">연결 및 입력 설정</h2>
      {stale && (
        <p role="status" className="error">
          최근 상태를 확인할 수 없습니다. 새 연결은 상태 복구 후 사용할 수
          있습니다.
        </p>
      )}
      <div className="setup-intro">
        <p>
          {status.demo
            ? "데모는 인공 화면·모의 AI를 사용합니다."
            : "AI 전용 스트림의 화면·마이크 음성으로 반응합니다."}
        </p>
        <a href="#broadcast">라이브로 돌아가기</a>
      </div>
      <SectionTabs
        label="방송 준비 항목"
        value={tab}
        onValueChange={(value) => {
          navigateWorkspaceTab(paths[value]);
        }}
        items={[
          {
            value: "chat",
            label: "시청자 채팅",
            content: (
              <DisplayChatConnections
                demo={status.demo}
                closed={status.closed}
              />
            ),
          },
          {
            value: "media",
            label: "화면·음성",
            content: (
              <MediaConnections
                status={status}
                stale={stale}
                preview={preview}
                refresh={refresh}
              />
            ),
          },
          {
            value: "ai",
            label: "AI 계정·모델",
            content: (
              <AiConnection status={status} stale={stale} refresh={refresh} />
            ),
          },
          {
            value: "output",
            label: "리더·OBS",
            content: (
              <div id="reader-links">
                <ReaderLinks refresh={refresh} />
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
