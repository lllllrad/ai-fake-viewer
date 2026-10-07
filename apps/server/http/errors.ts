import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PersonaError } from "../../../packages/application/cast/errors.ts";
import { AiStartError } from "../../../packages/application/reactions/coordinator.ts";
import { PrivacyActionError } from "../../../packages/application/participation/errors.ts";
import { RightsActionError } from "../../../packages/application/rights/service.ts";
import { BroadcastCommandError } from "../../../packages/application/broadcast/service.ts";
import { AccountChangedError } from "../../../packages/application/accounts/model-account.ts";
import { SoopBridgeError } from "../../../packages/application/inputs/soop-bridge.ts";

/** Only reviewed application errors expose their message at the HTTP boundary. */
export function registerHttpErrors(app: FastifyInstance) {
  app.setErrorHandler((e, req, reply) => {
    const validation = e instanceof z.ZodError;
    if (e instanceof PersonaError)
      return reply.code(e.statusCode).send({
        error: { code: e.code, message: e.message, retryable: e.retryable },
      });
    const status =
      typeof e === "object" &&
      e !== null &&
      "statusCode" in e &&
      typeof e.statusCode === "number" &&
      Number.isInteger(e.statusCode) &&
      e.statusCode >= 400 &&
      e.statusCode <= 599
        ? e.statusCode
        : 400;
    reply.code(validation ? 400 : status).send({
      error: validation
        ? "Invalid request fields"
        : e instanceof AiStartError ||
            e instanceof PrivacyActionError ||
            e instanceof RightsActionError ||
            e instanceof BroadcastCommandError ||
            e instanceof AccountChangedError ||
            e instanceof SoopBridgeError
          ? e.message
          : req.url.startsWith("/api/admin/")
            ? "Action unavailable. Check configuration, credentials, fresh frames and session state."
            : "Request failed",
    });
  });
}
