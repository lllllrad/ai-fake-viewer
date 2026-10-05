import { ZodError } from "zod";

export class StaleModelContextError extends Error {
  constructor() {
    super("stale_model_context");
  }
}

export function generationIssue(error: unknown) {
  if (error instanceof StaleModelContextError)
    return {
      code: "stale_context",
      message:
        "입력이 갱신되어 이번 생성은 건너뛰었습니다. 새 입력을 기다립니다.",
      retryable: true,
      transient: false,
    };
  if (
    error instanceof ZodError ||
    (error instanceof Error &&
      [
        "Invalid evidence",
        "Skip and inspect must have null text",
        "Invalid output",
        "Rejected output",
        "ChatGPT decision JSON invalid",
      ].includes(error.message))
  )
    return {
      code: "invalid_output",
      message:
        "AI 응답 검증에 실패해 이번 응답을 버렸습니다. 다음 입력에서 계속합니다.",
      retryable: true,
      transient: false,
    };
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" ||
      (error instanceof TypeError && error.message === "fetch failed"))
  )
    return {
      code: "temporary_request_failure",
      message:
        "AI 요청이 지연되거나 연결되지 않았습니다. 잠시 후 새 입력에서 다시 시도합니다.",
      retryable: true,
      transient: true,
    };
  if (error instanceof Error && error.message === "budget_exhausted")
    return {
      code: "budget_exhausted",
      message: "설정된 AI 호출 예산에 도달해 중지했습니다.",
      retryable: false,
      transient: false,
    };
  return {
    code: "model_error",
    message:
      "AI 요청에 실패해 중지했습니다. 연결 계정·모델과 제공자 상태를 확인해 주세요.",
    retryable: false,
    transient: false,
  };
}
