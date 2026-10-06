import { useState } from "react";
import type { ReaderLinks as Links } from "../../../../../packages/contracts/connections.ts";
import { connectionApi } from "./api.ts";
import { useAdminActions } from "../../lib/use-admin-actions.ts";
export function ReaderLinks({ refresh }: { refresh: () => Promise<void> }) {
  const [links, setLinks] = useState<Links>();
  const actions = useAdminActions(refresh);
  return (
    <section className="card" aria-label="리더와 OBS 연결">
      <h2>리더·OBS 연결</h2>
      <p>
        리더는 대화 전용 화면이고 오버레이는 OBS 브라우저 소스용 투명
        화면입니다.
      </p>
      <p className="hint">
        링크를 가진 사람은 채팅을 볼 수 있습니다. OBS 권장 크기는 600 ×
        900입니다.
      </p>
      {actions.error && (
        <p role="alert" className="error">
          {actions.error}
        </p>
      )}
      <div className="toolbar">
        <button
          disabled={actions.busy("links")}
          onClick={() =>
            void actions.run("links", async (signal) => {
              const result = await connectionApi.links(signal);
              if (!signal.aborted) setLinks(result);
            })
          }
        >
          리더·OBS 링크 보기
        </button>
        {links && (
          <button
            className="secondary"
            disabled={actions.busy("links")}
            onClick={() => {
              if (
                !confirm(
                  "현재 리더·OBS 링크를 모두 무효화하고 새 접속 토큰을 발급할까요?",
                )
              )
                return;
              void actions.run("links", async (signal) => {
                await connectionApi.command("reader-token/rotate", signal);
                if (!signal.aborted) setLinks(undefined);
                const result = await connectionApi.links(signal);
                if (!signal.aborted) setLinks(result);
              });
            }}
          >
            리더·OBS 링크 재발급
          </button>
        )}
      </div>
      {links &&
        (["reader", "overlay"] as const).map((key) => (
          <div key={key}>
            <label>
              {key === "reader" ? "리더 링크" : "OBS 오버레이 링크"}
              <input
                readOnly
                value={links[key]}
                onFocus={(event) => event.target.select()}
              />
            </label>
            <a href={links[key]} target="_blank" rel="noreferrer">
              {key === "reader" ? "리더 열기" : "오버레이 열기"} ↗
            </a>
          </div>
        ))}
    </section>
  );
}
