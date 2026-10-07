import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Store } from "../../../packages/storage.ts";
import type { BroadcastScheduler } from "../../../packages/infrastructure/reactions/scheduler.ts";
import type { Config } from "../../../packages/config.ts";
import type { Model } from "../../../packages/application/reactions/model-port.ts";
import { PersonaService } from "../../../packages/persona/service.ts";
import { demoPersonaGenerator } from "../../../packages/persona/generator.ts";
import { hash as canonicalHash } from "../../../packages/persona/contracts.ts";

/** Retained synthetic reference endpoints; never registered by the live composition. */
export function registerDemoPersonaRoutes(
  app: FastifyInstance,
  store: Store,
  scheduler: BroadcastScheduler,
  config: Config,
  model: Model<Buffer>,
) {
  const personas = new PersonaService(
    store,
    model,
    config,
    demoPersonaGenerator(),
    true,
  );
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api/admin/persona/") || req.method === "GET")
      return;
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 128)
      return reply.code(400).send({
        error: {
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "Provide an Idempotency-Key for this mutation.",
          retryable: false,
        },
      });
    const pathname = req.url.split("?", 1)[0];
    const params = req.params as any;
    const sessionId =
      typeof params?.id === "string" ? params.id : store.sessionId;
    const operation = `${req.method}:${pathname}`;
    const requestHash = canonicalHash({
      method: req.method,
      url: pathname,
      body: req.body ?? null,
    });
    const existing = store.db
      .prepare(
        "SELECT request_hash,result,status_code FROM persona_operator_commands WHERE session_id=? AND operation=? AND id=?",
      )
      .get(sessionId, operation, key) as any;
    if (existing) {
      if (existing.request_hash !== requestHash)
        return reply.code(409).send({
          error: {
            code: "IDEMPOTENCY_KEY_CONFLICT",
            message: "This key was already used for a different request.",
            retryable: false,
          },
        });
      if (existing.status_code === 0)
        return reply.code(409).send({
          error: {
            code: "IDEMPOTENCY_IN_PROGRESS",
            message: "The original request is still processing.",
            retryable: true,
          },
        });
      return reply.code(existing.status_code).send(JSON.parse(existing.result));
    }
    try {
      store.db
        .prepare(
          "INSERT INTO persona_operator_commands(id,session_id,operation,request_hash,result,status_code,created) VALUES(?,?,?,?, 'null',0,?)",
        )
        .run(key, sessionId, operation, requestHash, Date.now());
    } catch {
      return reply.code(409).send({
        error: {
          code: "IDEMPOTENCY_IN_PROGRESS",
          message: "The original request is still processing.",
          retryable: true,
        },
      });
    }
    (req as any).personaIdempotency = {
      key,
      sessionId,
      operation,
      requestHash,
    };
  });
  app.addHook("onSend", async (req, reply, payload) => {
    const context = (req as any).personaIdempotency;
    if (!context) return payload;
    if (reply.statusCode >= 200 && reply.statusCode < 300) {
      try {
        const value =
          typeof payload === "string"
            ? JSON.parse(payload)
            : JSON.parse(Buffer.from(payload as any).toString("utf8"));
        store.db
          .prepare(
            "UPDATE persona_operator_commands SET result=?,status_code=? WHERE id=? AND session_id=? AND operation=?",
          )
          .run(
            JSON.stringify(value),
            reply.statusCode,
            context.key,
            context.sessionId,
            context.operation,
          );
      } catch {
        store.db
          .prepare(
            "DELETE FROM persona_operator_commands WHERE id=? AND session_id=? AND operation=?",
          )
          .run(context.key, context.sessionId, context.operation);
      }
    } else
      store.db
        .prepare(
          "DELETE FROM persona_operator_commands WHERE id=? AND session_id=? AND operation=?",
        )
        .run(context.key, context.sessionId, context.operation);
    return payload;
  });
  // P0 persona authoring and session control. These routes are operator-only;
  // public stream projections continue to use the existing allowlisted schema.
  app.post("/api/admin/persona/sessions", async (req) =>
    personas.createBrief(req.body),
  );
  app.get("/api/admin/persona/templates", async () => ({
    templates: personas.templates(),
  }));
  app.post("/api/admin/persona/templates", async (req) =>
    personas.createTemplate(req.body),
  );
  app.post("/api/admin/persona/sessions/:id/nickname-denylist", async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(60),
        reason: z.string().trim().min(1).max(200),
      })
      .strict()
      .parse(req.body);
    return personas.denyNickname(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.name,
      body.reason,
    );
  });
  app.get("/api/admin/persona/sessions/:id", async (req) =>
    personas.getSession(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
    ),
  );
  app.post("/api/admin/persona/sessions/:id/candidates", async (req) => {
    const body = z
      .object({ count: z.number().int().min(1).max(24).optional() })
      .strict()
      .parse(req.body ?? {});
    return personas.createCandidates(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.count,
    );
  });
  app.get("/api/admin/persona/sessions/:id/candidates", async (req) =>
    personas.listCandidates(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
    ),
  );
  app.post("/api/admin/persona/sessions/:id/clone", async (req) => {
    const body = z
      .object({ source_version_id: z.string().uuid() })
      .strict()
      .parse(req.body);
    return personas.clone(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.source_version_id,
    );
  });
  app.post("/api/admin/persona/sessions/:id/auditions", async (req) => {
    const body = z
      .object({ version_ids: z.array(z.string().uuid()).min(1).max(24) })
      .strict()
      .parse(req.body);
    return personas.audition(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.version_ids,
    );
  });
  app.get("/api/admin/persona/jobs/:id", async (req) =>
    personas.job(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
    ),
  );
  app.post("/api/admin/persona/jobs/:id/cancel", async (req) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    return personas.cancelJob(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
    );
  });
  app.post("/api/admin/persona/versions/:id/approve", async (req) => {
    const body = z
      .object({
        hash: z.string().length(64),
        evaluation_id: z.string().uuid(),
        reviewer_decision: z.unknown(),
      })
      .strict()
      .parse(req.body);
    return personas.approve(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body,
    );
  });
  app.post("/api/admin/persona/versions/:id/regenerate", async (req) => {
    const body = z
      .object({
        session_id: z.string().uuid(),
        source_hash: z.string().length(64),
        locked_paths: z.array(z.string()).max(30).default([]),
        dimensions: z.array(z.string()).max(30).default([]),
        nickname_only: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    return personas.regenerate(
      body.session_id,
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.source_hash,
      body.locked_paths,
      body.dimensions,
      body.nickname_only,
    );
  });
  app.post("/api/admin/persona/versions/:id/retire", async (req) => {
    const body = z
      .object({
        expected_hash: z.string().length(64),
        reason: z.string().trim().min(1).max(300),
      })
      .strict()
      .parse(req.body);
    return personas.retireVersion(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.expected_hash,
      body.reason,
    );
  });
  app.put("/api/admin/persona/sessions/:id/cast", async (req) => {
    const body = z
      .object({
        expected_revision: z.number().int().positive(),
        members: z.array(
          z
            .object({
              version_id: z.string().uuid(),
              display_name: z.string().trim().min(1).max(60).optional(),
            })
            .strict(),
        ),
      })
      .strict()
      .parse(req.body);
    return personas.putCast(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.expected_revision,
      body.members,
    );
  });
  app.post("/api/admin/persona/sessions/:id/freeze", async (req) => {
    const body = z
      .object({
        expected_revision: z.number().int().positive(),
        disclosure_confirmed: z.literal(true),
        policy: z.unknown().optional(),
      })
      .strict()
      .parse(req.body);
    return personas.freeze(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.expected_revision,
      body.disclosure_confirmed,
      body.policy,
    );
  });
  app.post("/api/admin/persona/sessions/:id/start", async (req) => {
    const body = z
      .object({
        expected_revision: z.number().int().positive(),
        arm_ai: z.boolean(),
      })
      .strict()
      .parse(req.body);
    const id = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    const state = personas.start(id, body.expected_revision, body.arm_ai);
    if (body.arm_ai) {
      try {
        scheduler.start();
      } catch (error) {
        scheduler.stop("preflight_failed");
        personas.stop(id, "preflight_failed");
        throw error;
      }
    } else scheduler.stop("persona_started_disarmed");
    return state;
  });
  app.post("/api/admin/persona/sessions/:id/ai/stop", async (req) => {
    const body = z
      .object({ reason: z.string().trim().min(1).max(200).optional() })
      .strict()
      .parse(req.body ?? {});
    scheduler.stop("persona_emergency_stop");
    return personas.stop(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.reason,
    );
  });
  app.post("/api/admin/persona/sessions/:id/ai/arm", async (req) => {
    const body = z
      .object({ expected_control_epoch: z.number().int().nonnegative() })
      .strict()
      .parse(req.body);
    const id = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    const state = personas.arm(id, body.expected_control_epoch);
    try {
      scheduler.start();
    } catch (error) {
      scheduler.stop("preflight_failed");
      personas.stop(id, "preflight_failed");
      throw error;
    }
    return state;
  });
  app.post("/api/admin/persona/sessions/:id/pause", async (req) => {
    const body = z
      .object({ expected_revision: z.number().int().positive() })
      .strict()
      .parse(req.body);
    scheduler.stop("persona_paused");
    return personas.pause(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.expected_revision,
    );
  });
  app.post("/api/admin/persona/sessions/:id/resume", async (req) => {
    const body = z
      .object({ expected_revision: z.number().int().positive() })
      .strict()
      .parse(req.body);
    return personas.resume(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.expected_revision,
    );
  });
  app.post("/api/admin/persona/sessions/:id/end", async (req) => {
    const body = z
      .object({ expected_revision: z.number().int().positive() })
      .strict()
      .parse(req.body);
    scheduler.stop("persona_ended");
    return personas.end(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.expected_revision,
    );
  });
  app.patch("/api/admin/persona/sessions/:id/policy", async (req) => {
    const body = z
      .object({
        expected_revision: z.number().int().positive(),
        policy: z.unknown(),
      })
      .strict()
      .parse(req.body);
    scheduler.stop("persona_policy_changed");
    const state = personas.updatePolicy(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.expected_revision,
      body.policy,
    );
    if (state.state === "live" && state.armed) {
      try {
        scheduler.start();
      } catch (error) {
        scheduler.stop("preflight_failed");
        personas.stop(state.id, "preflight_failed");
        throw error;
      }
    }
    return state;
  });
  app.patch(
    "/api/admin/persona/sessions/:id/members/:memberId",
    async (req) => {
      const body = z
        .object({
          expected_member_epoch: z.number().int().nonnegative(),
          presence: z.enum(["present", "departed"]).optional(),
          muted: z.boolean().optional(),
          attention: z.number().min(0).max(1).optional(),
          current_focus_tags: z
            .array(z.string().trim().min(1).max(60))
            .max(20)
            .optional(),
        })
        .strict()
        .parse(req.body);
      const result = personas.updateMember(
        z
          .string()
          .uuid()
          .parse((req.params as any).id),
        z
          .string()
          .uuid()
          .parse((req.params as any).memberId),
        body.expected_member_epoch,
        body,
      );
      const pending = scheduler.pending;
      if (pending && pending.memberId === (req.params as any).memberId) {
        if (pending.attemptId)
          store.finishPersonaAttempt(
            pending.attemptId,
            "canceled",
            "member_state_changed",
          );
        scheduler.pending = undefined;
      }
      return result;
    },
  );
  app.post("/api/admin/persona/sessions/:id/reveal", async (req) => {
    const body = z
      .object({ confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    return personas.reveal(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      body.confirmed,
    );
  });
  app.get("/api/admin/persona/sessions/:id/report", async (req) =>
    personas.report(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
    ),
  );
  app.get("/api/admin/persona/sessions/:id/replay", async (req) =>
    personas.replay(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
    ),
  );

  return () => personas.cancelAll();
}
