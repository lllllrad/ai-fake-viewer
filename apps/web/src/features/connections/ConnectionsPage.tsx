import { SectionTabs } from "../../components/ui";
import { useLocationHash, navigateWorkspaceTab } from "../workspace/navigation";
import type { ReactNode } from "react";
import type { AdminStatus } from "../../../../../packages/contracts/admin-status.ts";
import { PlatformConnections } from "./PlatformConnections.tsx";
import { MediaConnections } from "./MediaConnections.tsx";
import { AiConnection } from "./AiConnection.tsx";
import { ReaderLinks } from "./ReaderLinks.tsx";
export function ConnectionsPage({
  status,
  stale,
  preview,
  refresh,
  soop,
}: {
  status: AdminStatus;
  stale: boolean;
  preview: string;
  refresh: () => Promise<void>;
  soop: ReactNode;
}) {
  const hash = useLocationHash().slice(1);
  const tab = ["program-details", "audio-details"].includes(hash)
    ? "media"
    : hash === "ai-details"
      ? "ai"
      : hash === "reader-links"
        ? "output"
        : "platforms";
  const paths: Record<string, string> = {
    platforms: "connection-details",
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
            ? "데모는 인공 채팅·화면·모의 AI를 사용합니다."
            : "필요한 입력을 연결하고 AI 계정과 OBS 출력을 확인하세요."}
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
            value: "platforms",
            label: "채팅 플랫폼",
            content: (
              <PlatformConnections
                status={status}
                stale={stale}
                refresh={refresh}
                soop={soop}
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
