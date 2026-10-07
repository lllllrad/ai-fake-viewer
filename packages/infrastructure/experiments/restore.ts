import { randomUUID } from "node:crypto";
import type { Store } from "../../storage.ts";
import type { ExperimentTrace } from "../../contracts/interactive-experiment.ts";
import {
  briefSchema,
  policySchema,
} from "../../contracts/cast-configuration.ts";

/** Rehydrate private test history only. Unfinished attempts are never replayed. */
export function restoreExperiment(
  store: Store,
  trace: ExperimentTrace,
  maxCalls: number,
) {
  const { session } = trace;
  const db = store.db;
  const sourceSession = session.messages[0]?.sessionId ?? session.id;
  db.prepare("UPDATE sessions SET id=?, started=? WHERE id=?").run(
    sourceSession,
    session.startedAt,
    store.sessionId,
  );
  store.sessionId = sourceSession;
  store.transaction(() => {
    const castId = randomUUID();
    db.prepare(
      "INSERT INTO persona_sessions(id,source_session,revision,brief,policy,state,armed,created,updated) VALUES(?,?,3,?,?,'live',1,?,?)",
    ).run(
      castId,
      store.sessionId,
      JSON.stringify(
        briefSchema.parse({
          session_title: "자동 시청자",
          topic: session.topic,
          audience_intent: "서로 다른 시청 동기로 현재 방송에 참여",
          public_context: session.topic,
          private_production_context: "",
          tone_policy:
            "신상·과거 이력·친분을 꾸며내지 않고 관찰 근거에 따라 반응",
          candidate_count: 6,
          cast_size: 6,
        }),
      ),
      JSON.stringify(
        policySchema.parse({
          max_live_model_calls_per_session: Math.max(300, maxCalls),
        }),
      ),
      session.startedAt,
      Date.now(),
    );
    for (const member of session.personas) {
      const provenance = trace.personaProvenance.find(
        (p) => p.personaId === member.personaId,
      )?.provenance ?? { generator: "restored-test-history" };
      db.prepare("INSERT INTO persona_versions VALUES(?,?,?,?,?,?,?,?)").run(
        member.versionId,
        member.personaId,
        member.snapshot.definition_version,
        "approved",
        JSON.stringify(member.snapshot),
        member.hash,
        JSON.stringify(provenance),
        session.startedAt,
      );
      db.prepare(
        "INSERT INTO persona_cast(session_id,member_id,persona_id,version_id,definition_snapshot,definition_hash,display_name,status,epoch,attention,focus_tags,guessing_eligible) VALUES(?,?,?,?,?,?,?,'present',?,?,?,?)",
      ).run(
        castId,
        member.id,
        member.personaId,
        member.versionId,
        JSON.stringify(member.snapshot),
        member.hash,
        member.displayName,
        member.epoch,
        member.attention,
        JSON.stringify(member.focusTags),
        Number(member.guessingEligible),
      );
      for (const [index, presence] of member.presence.entries())
        db.prepare("INSERT INTO persona_presence VALUES(?,?,?,?,?,?,?)").run(
          castId,
          member.id,
          index + 1,
          presence.joined_at,
          presence.joined_after_seq,
          presence.left_at,
          presence.left_after_seq,
        );
    }
    for (const message of session.messages) {
      const member = session.personas.find(
        (p) => p.displayName === message.displayName,
      );
      db.prepare(
        "INSERT OR IGNORE INTO actors_private(id,session,source,author,name) VALUES(?,?,'experiment',?,?)",
      ).run(
        message.actorId,
        store.sessionId,
        member ? `persona-${member.id}` : message.actorId,
        message.displayName,
      );
      db.prepare(
        "INSERT INTO events(seq,session,type,target,at,payload) VALUES(?,?,'message.added',?,?,'null')",
      ).run(message.seq, store.sessionId, message.id, message.displayTime);
      db.prepare(
        "INSERT INTO messages(id,session,actor,platform,channel,published,received,text,reply,hidden,seq) VALUES(?,?,?,'experiment',?,?,?,?,?,0,?)",
      ).run(
        message.id,
        store.sessionId,
        message.actorId,
        store.sessionId,
        message.displayTime,
        message.displayTime,
        message.text,
        message.replyToId,
        message.seq,
      );
    }
    for (const input of session.inputs)
      store.transcripts.record({
        id: input.id,
        capturedAt: input.at,
        text: input.text,
      });
    for (let index = 0; index < session.calls; index++) {
      const id = store.reserve(maxCalls, null, null);
      if (!id) throw Error("Invalid saved test usage");
      store.settle(id, undefined, undefined, null);
    }
  });
}
