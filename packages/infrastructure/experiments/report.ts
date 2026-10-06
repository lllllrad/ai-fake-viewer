import type { ExperimentResult } from "./runner.ts";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function details(title: string, value: unknown) {
  return `<details><summary>${escape(title)}</summary><pre>${escape(JSON.stringify(value, null, 2))}</pre></details>`;
}
function renderRun(r: ExperimentResult, index: number) {
  const messages =
    r.mode === "draft"
      ? r.drafts
          .filter((d) => d.kind === "candidate")
          .map((d) => ({ text: d.decision.text ?? "" }))
      : r.messages;
  const chat = messages.map((m) => `<li>${escape(m!.text)}</li>`).join("");
  const calls = r.calls
    .map((call, index) =>
      details(
        `호출 ${index + 1} · ${call.atMs} ms · 실제 대기 ${call.elapsedMs} ms${call.error ? " · 오류" : ""}`,
        call,
      ),
    )
    .join("");
  const images = [
    ...new Set(
      r.calls.flatMap((call) =>
        call.request.flatMap((message) =>
          Array.isArray(message.content)
            ? message.content
                .filter((part) => part.type === "input_image")
                .map((part) =>
                  "image_url" in part ? part.image_url : undefined,
                )
                .filter(
                  (url): url is string =>
                    typeof url === "string" &&
                    url.startsWith("data:image/jpeg;base64,"),
                )
            : [],
        ),
      ),
    ),
  ];
  const key = escape(
    `${r.pipeline.profile.id}@${r.pipeline.profile.revision}/${r.scenario.id}/${r.mode}/${r.seed}`,
  );
  return `<article class="run" data-failed="${r.summary.failedChecks > 0 || r.summary.failed}" data-published="${r.summary.published > 0}">
    <h2>${escape(r.pipeline.profile.id)} · v${r.pipeline.profile.revision}</h2>
    <p>${escape(r.scenario.id)} · ${r.mode} · seed ${r.seed}<br>${escape(r.provider)} · ${escape(r.model)}</p>
    <p class="badge">호출 ${r.summary.calls} · 출력 ${r.summary.published} · 건너뜀 ${r.summary.skipped} · 거절/오류 ${r.summary.rejected}<br>
      모델 대기 ${r.summary.modelElapsedMs} ms · 검증 실패 ${r.summary.failedChecks} · 상태 ${escape(r.summary.state)}</p>
    <h3>${r.mode === "draft" ? "생성 후보 (게시하지 않음)" : "최종 채팅"}</h3>
    <ul>${chat || "<li>출력 없음 — 아래 단계별 결과를 확인하세요.</li>"}</ul>
    ${images.length ? `<details><summary>모델에 전달한 화면</summary>${images.map((url) => `<img src="${escape(url)}" alt="실험에서 모델에 전달한 화면" style="max-width:100%;height:auto">`).join("")}</details>` : ""}
    ${details("검증 결과", r.checks)}
    ${details("실행 단계와 차단 원인", { timeline: r.timeline, diagnostics: r.diagnostics, attempts: r.attempts })}
    ${details("AI 시청자 페르소나", r.personas)}
    ${calls}
    ${details("생성만 테스트 결과", r.drafts)}
    ${details("설정과 시나리오", { pipeline: r.pipeline, effectiveAi: r.effectiveAi, scenario: r.scenario, usage: r.usage })}
    <label>평가 메모 (맥락, 개성, 반복, 근거, 적절한 침묵)
      <textarea data-run="${index}" data-key="${key}" placeholder="비교 내용을 적고 평가 메모를 내보내세요."></textarea>
    </label>
  </article>`;
}
export function renderExperimentReport(results: ExperimentResult[]) {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>AI 시청자 실험 비교</title><style>
  *{box-sizing:border-box}body{font:16px/1.6 system-ui,sans-serif;margin:0;background:#f5f7f6;color:#182923}header,main{padding:24px;max-width:1800px;margin:auto}h1{margin:0}p{max-width:85ch}.runs{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));gap:20px}.run{min-width:0;background:white;padding:24px;border:1px solid #d4ded8;border-radius:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:450px;overflow:auto;background:#f3f6f4;padding:12px}summary,button,select{cursor:pointer}details{border-top:1px solid #dde5df;padding:10px 0}label{display:block;margin:12px 0}textarea{width:100%;min-height:100px}button,select{padding:8px 14px;font:inherit}li{overflow-wrap:anywhere}.failed{color:#a02d21}.badge{background:#e7f2eb;padding:6px 12px;border-radius:8px;display:inline-block}
  </style><header><h1>AI 시청자 실험 비교</h1><p>같은 시나리오의 페르소나·입력·생성·리뷰·출력 결과를 비교합니다. fixture는 흐름 확인용 합성 응답이며 답변 품질 평가에 사용할 수 없습니다. 재생 시간은 가상 시간이며 모델 대기 중에는 멈춥니다. 실제 응답 시간은 별도로 표시합니다.</p><label>결과 표시 <select id="filter"><option value="all">전체</option><option value="failed">검증 실패 또는 호출 오류</option><option value="published">출력된 채팅 있음</option></select></label><button id="export">평가 메모 내보내기</button></header><main><div class="runs">${results.map(renderRun).join("")}</div></main><script>
  document.getElementById('filter').addEventListener('change',event=>{for(const el of document.querySelectorAll('.run'))el.hidden=event.target.value!=='all'&&el.dataset[event.target.value]!=='true';});
  document.getElementById('export').addEventListener('click',()=>{const notes=Array.from(document.querySelectorAll('textarea')).map(el=>({run:Number(el.dataset.run),key:el.dataset.key,note:el.value}));const blob=new Blob([JSON.stringify(notes,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='experiment-notes.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  </script></html>`;
}
