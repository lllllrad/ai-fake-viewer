import { ZodError } from "zod";

export class ModelRequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, number> = {},
    public retryable = false,
  ) {
    super(message);
  }
}

export class StaleModelContextError extends Error {
  constructor() {
    super("stale_model_context");
  }
}

export function generationIssue(error: unknown) {
  if (error instanceof SyntaxError)
    return {
      code: "provider_invalid_json",
      message:
        "AI 응답 JSON을 해석하지 못했습니다. 다음 입력에서 다시 시도합니다.",
      retryable: true,
      transient: true,
    };
  if (error instanceof ModelRequestError)
    return {
      code: error.code,
      message:
        error.code === "output_token_limit"
          ? "AI 응답이 설정된 출력 토큰 한도를 초과했습니다."
          : error.code === "input_token_limit"
            ? "AI 입력이 설정된 토큰 한도를 초과했습니다."
            : `AI 요청 오류 (${error.code}). 연결 상태와 설정을 확인해 주세요.`,
      retryable: error.retryable,
      transient: error.retryable,
    };
  if (
    error instanceof Error &&
    [
      "ChatGPT stream ended before completion",
      "ChatGPT response failed or incomplete",
      "terminated",
    ].includes(error.message)
  )
    return {
      code: "provider_stream_interrupted",
      message:
        "AI 응답 스트림이 완료되지 않았습니다. 다음 입력에서 다시 시도합니다.",
      retryable: true,
      transient: true,
    };
  if (
    error instanceof Error &&
    [
      "ChatGPT output empty",
      "ChatGPT output too large",
      "ChatGPT response too large",
      "Invalid ChatGPT text delta",
    ].includes(error.message)
  )
    return {
      code: "provider_invalid_output",
      message:
        "AI 응답 형식이 올바르지 않습니다. 다음 입력에서 다시 시도합니다.",
      retryable: true,
      transient: true,
    };
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
