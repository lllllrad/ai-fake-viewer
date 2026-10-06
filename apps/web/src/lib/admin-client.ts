export class AdminRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AdminRequestError";
  }
  get unauthorized() {
    return this.status === 401;
  }
}

type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal };
type Decoder<T> = { parse(value: unknown): T };

/** Same-origin transport. Credentials remain in the server-issued HttpOnly cookie. */
export function createAdminClient(
  send: typeof fetch = fetch,
  timeoutMs = 10000,
) {
  const request = async (
    path: string,
    options: RequestOptions = {},
  ): Promise<Response> => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_/?=&.%-]*$/.test(path) || path.includes(".."))
      throw new Error("잘못된 관리 요청 경로입니다.");
    const method = options.method ?? "GET";
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;
    let response: Response;
    try {
      response = await send(`/api/admin/${path}`, {
        method,
        credentials: "same-origin",
        signal,
        headers: {
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
          ...(method === "GET"
            ? {}
            : { "Idempotency-Key": crypto.randomUUID() }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new AdminRequestError(
        timeout.aborted
          ? "서버 응답 시간이 초과되었습니다. 다시 시도해 주세요."
          : "서버에 연결할 수 없습니다. 연결 상태를 확인해 주세요.",
        0,
      );
    }
    if (response.ok) return response;
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      /* Non-JSON proxy errors use a stable fallback. */
    }
    const failure =
      value && typeof value === "object" && "error" in value
        ? value.error
        : undefined;
    const object =
      failure && typeof failure === "object"
        ? (failure as Record<string, unknown>)
        : undefined;
    const code = typeof object?.code === "string" ? object.code : undefined;
    const message =
      typeof failure === "string"
        ? failure
        : typeof object?.message === "string"
          ? object.message
          : undefined;
    throw new AdminRequestError(
      message ??
        (response.status === 401
          ? "관리자 인증이 필요합니다."
          : `요청을 처리하지 못했습니다. (${response.status})`),
      response.status,
      code,
    );
  };
  const json = async <T>(
    path: string,
    decoder: Decoder<T>,
    options?: RequestOptions,
  ): Promise<T> => {
    const response = await request(path, options);
    try {
      return decoder.parse(await response.json());
    } catch {
      throw new AdminRequestError(
        "서버 응답 형식을 확인할 수 없습니다.",
        response.status,
        "invalid_response",
      );
    }
  };
  return { request, json };
}
export const adminClient = createAdminClient();
