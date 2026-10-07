import type { ViewerInspection } from "../../../../packages/contracts/reaction-inspection";
import { useState } from "react";
import { Select, StatusBadge } from "../../../web/src/components/ui";
import type { ExperimentSession } from "../../../../packages/contracts/interactive-experiment";

function StateValue({
  value,
}: {
  value: ViewerInspection["sections"][number]["value"];
}) {
  if (value === null || typeof value !== "object")
    return <p>{value === null ? "없음" : String(value)}</p>;
  if (
    !Array.isArray(value) &&
    Object.values(value).every(
      (entry) => entry === null || typeof entry !== "object",
    )
  )
    return (
      <dl className="experiment-state-fields">
        {Object.entries(value).map(([label, entry]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{entry === null ? "없음" : String(entry)}</dd>
          </div>
        ))}
      </dl>
    );
  return (
    <details>
      <summary>
        {Array.isArray(value)
          ? `기록 ${value.length}개 보기`
          : "상태 세부사항 보기"}
      </summary>
      <pre tabIndex={0}>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function ViewerStates({ session }: { session: ExperimentSession }) {
  const [chosen, setChosen] = useState("");
  const member =
    session.personas.find((persona) => persona.id === chosen) ??
    session.personas[0];
  const state = session.viewerStates.find(
    (entry) => entry.memberId === member?.id,
  );
  return (
    <section className="card experiment-viewer-state" aria-label="AI별 상태">
      <h2>AI별 상태</h2>
      <p className="hint">
        {session.pipelineType} 파이프라인이 제공한 관찰·판단 결과와 처리
        상태입니다. 항목은 AI 구현에 따라 달라집니다.
      </p>
      <label htmlFor="inspected-viewer">확인할 AI 시청자</label>
      <Select
        id="inspected-viewer"
        value={member?.id ?? ""}
        onChange={(event) => setChosen(event.target.value)}
      >
        {session.personas.map((persona) => (
          <option key={persona.id} value={persona.id}>
            {persona.displayName}
          </option>
        ))}
      </Select>
      {member && (
        <div className="section-title">
          <h3>{member.displayName}</h3>
          <StatusBadge tone="neutral">
            {state?.status ?? "상태 기록 없음"}
          </StatusBadge>
        </div>
      )}
      {state ? (
        <>
          <p className="hint">
            {session.endedAt ? "종료 시점에 저장한 상태" : "진행 중 자동 갱신"}
            {state.updatedAt !== null &&
              ` · 최근 사건 ${new Date(state.updatedAt).toLocaleTimeString("ko-KR")}`}
          </p>
          {state.sections.map((section, index) => (
            <section
              key={`${section.label}-${index}`}
              className="experiment-state-section"
            >
              <h3>{section.label}</h3>
              <StateValue value={section.value} />
            </section>
          ))}
        </>
      ) : (
        <p>이 AI 유형 또는 저장된 세션에는 확인 가능한 상태 기록이 없습니다.</p>
      )}
    </section>
  );
}
