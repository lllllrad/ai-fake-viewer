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
  return (
    <>
      <h2 className="workspace-page-title">연결 및 입력 설정</h2>
      {stale && (
        <p role="status" className="error">
          최근 상태를 확인할 수 없습니다. 새 연결은 상태 복구 후 사용할 수
          있습니다.
        </p>
      )}
      {status.demo && (
        <p className="card">데모 · 인공 채팅·화면·모의 AI를 사용합니다.</p>
      )}
      <PlatformConnections
        status={status}
        stale={stale}
        refresh={refresh}
        soop={soop}
      />
      <MediaConnections
        status={status}
        stale={stale}
        preview={preview}
        refresh={refresh}
      />
      <AiConnection status={status} stale={stale} refresh={refresh} />
      <ReaderLinks refresh={refresh} />
    </>
  );
}
