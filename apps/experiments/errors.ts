import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ExperimentError } from "../../packages/infrastructure/experiments/interactive.ts";
import { AccountChangedError } from "../../packages/application/accounts/model-account.ts";
export function registerExperimentErrors(app: FastifyInstance) {
  app.setErrorHandler((error, _request, reply) => {
    const known =
      error instanceof ExperimentError || error instanceof AccountChangedError;
    return reply
      .code(error instanceof z.ZodError ? 400 : known ? error.statusCode : 400)
      .send({
        error: known
          ? error.message
          : "테스트 요청을 처리하지 못했습니다. 테스트 서버의 설정과 계정 연결을 확인해 주세요.",
      });
  });
}
