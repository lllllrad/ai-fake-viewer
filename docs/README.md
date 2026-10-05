# 문서 안내와 관리 기준

2026-10-05 코드 대조 기준. 현재 기능을 찾을 때는 아래 구현 문서를 읽고, 목표 요구사항과 과거 검증 결과는 별도로 확인한다.

| 문서                                                                                                | 역할                                                   |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [프로젝트 README](../README.md)                                                                     | 설치·운영 진입점과 기능 개요                           |
| [라이브 설치](../LIVE_SETUP.md)                                                                     | 별도 OBS PC, 자격 증명, 운영 리허설                    |
| [AI 흐름](../AI_FLOW.md)                                                                            | 공통 수집·모델·필터·검토·게시 파이프라인               |
| [페르소나 구현 명세](ai-viewer-persona-system-spec.md)                                              | 작성·승인·출연진·라이브 제어·API·현재 한계             |
| [관리자 대시보드 요구사항](admin-dashboard-functional-spec.md)                                      | 목표 UI 계약과 현재 구현 차이                          |
| [작업 현황](../TASKS.md)                                                                            | 구현 범위와 미완료 인수 항목                           |
| [검증 기록](../VERIFICATION_REPORT.md)                                                              | 실행 날짜별 증거와 미검증 범위                         |
| [설정 예시](../config.example.yaml) / [설정 스키마](../packages/config.ts)                          | 설정 형식과 실제 기본값·검증 조건                      |
| [외부 계약 조사](../research/platform-contracts.md)                                                 | 날짜가 있는 외부 문서 조사; 현재 서비스 계약 보증 아님 |
| [SOOP 조사](../research/soop-official-verification.md) / [의존성 조사](../research/dependencies.md) | 과거 조사와 후속 검증 필요 사항                        |

## 기능과 문서의 소유 범위

| 기능                       | 기준 코드                                                                                            | 같이 갱신할 문서                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 시작·복구·준비도·일괄 제어 | `apps/server/main.ts`, `apps/server/app.ts`                                                          | README, LIVE_SETUP, AI_FLOW, 대시보드 구현 차이 |
| 시청자 동의·철회·익명 표시 | `packages/storage.ts`, `apps/web/src/main.tsx`                                                       | README, 대시보드 요구사항                       |
| 페르소나 작성·세션         | `packages/persona/`, `packages/scheduler.ts`, `packages/storage.ts`                                  | 페르소나 명세, AI_FLOW, TASKS                   |
| 모델 입력·프롬프트·예산    | `packages/model.ts`, `packages/gate.ts`, `prompts/`                                                  | AI_FLOW, README                                 |
| 플랫폼·인증·수집           | `packages/youtube.ts`, `packages/chzzk.ts`, `packages/soop.ts`, `packages/supervisor.ts`, `workers/` | README, LIVE_SETUP, 해당 조사 기록              |

## 변경 규칙

- 동작을 바꾸는 변경에는 담당 문서 갱신을 포함한다. 코드에 선언된 필드와 실제 연결된 기능을 구분한다.
- 요구사항은 구현 완료 증거가 아니다. 불일치는 요구사항 문서의 구현 차이 표와 TASKS에 남긴다.
- 검증 결과에는 날짜·명령·범위·실패 또는 차단 사유를 기록한다. 과거 PASS를 현재 코드의 PASS로 옮겨 적지 않는다.
- 저장소 내부 링크는 상대 경로를 사용한다. 새 문서는 이 색인에 추가하고 문서 삭제·이동 시 참조도 수정한다.
- `npm run docs:check`로 tracked 및 새로 추가한 비 ignored Markdown의 로컬 파일·헤딩 링크를 검사한다. 외부 URL의 접근성이나 내용의 최신성은 검사하지 않는다. 같은 명령으로 `config.example.yaml`도 실제 설정 스키마에 대조한다.
- 문서 포맷은 `npx prettier --write <수정한 문서>`로 맞춘다. `npm run format:check`에는 `docs/`도 포함된다.
- 비공개 `.local/` 인수 자료나 대화 내용만을 공개 문서의 근거로 삼지 않는다. 저장소에 없는 문서를 기존 명세라고 링크하지 않는다.
