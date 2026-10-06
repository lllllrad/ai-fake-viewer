import { useState } from "react";
import {
  videoIntakeSchema,
  type VideoRecord,
} from "../../../../../packages/contracts/rights.ts";
import { useAdminActions } from "../../lib/use-admin-actions.ts";
import { participationApi } from "./api.ts";
import { platforms, platformName, videoStates } from "./labels.ts";
export function VideoInventory({
  rows,
  refresh,
  stale,
}: {
  rows: VideoRecord[];
  refresh: () => Promise<void>;
  stale: boolean;
}) {
  const [value, setValue] = useState<Omit<VideoRecord, "id">>({
    platform: "soop",
    url: "",
    broadcastAt: "",
    status: "public",
  });
  const actions = useAdminActions(refresh);
  return (
    <details className="participation-section">
      <summary>영상·사본 목록 ({rows.length})</summary>
      <p className="hint">
        후속 조치가 필요한 영상이나 사본의 위치를 기록합니다. 등록만으로 외부
        영상이 변경되지는 않습니다.
      </p>
      {!rows.length && (
        <p className="empty-state">등록된 영상이나 사본이 없습니다.</p>
      )}
      <ul className="participation-list">
        {rows.map((row) => (
          <li key={row.id} className="participation-item">
            {platformName(row.platform)} · {row.url} · {row.broadcastAt} ·{" "}
            {videoStates[row.status]}
          </li>
        ))}
      </ul>
      <form
        className="participation-form"
        onSubmit={(e) => {
          e.preventDefault();
          void actions.run("video", async (signal) => {
            await participationApi.addVideo(value, signal);
          });
        }}
      >
        <div className="participation-fields">
          <label>
            플랫폼
            <select
              value={value.platform}
              onChange={(e) =>
                setValue({
                  ...value,
                  platform: videoIntakeSchema.shape.platform.parse(
                    e.target.value,
                  ),
                })
              }
            >
              {Object.entries(platforms).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            영상 주소 또는 사본 위치
            <input
              required
              maxLength={500}
              value={value.url}
              onChange={(e) => setValue({ ...value, url: e.target.value })}
            />
          </label>
          <label>
            방송 시각
            <input
              required
              maxLength={80}
              value={value.broadcastAt}
              onChange={(e) =>
                setValue({ ...value, broadcastAt: e.target.value })
              }
            />
          </label>
          <label>
            공개 상태
            <select
              value={value.status}
              onChange={(e) =>
                setValue({
                  ...value,
                  status: videoIntakeSchema.shape.status.parse(e.target.value),
                })
              }
            >
              {Object.entries(videoStates).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          disabled={
            stale || actions.busy("video") || !value.url || !value.broadcastAt
          }
        >
          영상 목록에 추가
        </button>
        {actions.error && <p role="alert">{actions.error}</p>}
      </form>
    </details>
  );
}
