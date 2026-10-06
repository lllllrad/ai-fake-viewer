import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { ValidatedIncoming } from "../../contracts/incoming.ts";
import type {
  Admission,
  ReferenceNotice,
} from "../../application/conversation/ingestion.ts";
/** Local reference/demo consent only. Live broadcasts use ParticipationService. */
export class ReferenceAdmission {
  constructor(
    private readonly database: DatabaseSync,
    private readonly environment: {
      sessionId(): string;
      now(): number;
      erase(ids: string[], sequences: number[]): void;
    },
  ) {}
  private hash(platform: string, channel: string, author: string) {
    return createHash("sha256")
      .update(`${platform}\0${channel}\0${author}`)
      .digest("hex");
  }
  grant(platform: string, channel: string, author: string) {
    if (platform === "experiment") return;
    this.consent(platform, channel, author, true);
  }
  private consent(
    platform: string,
    channel: string,
    author: string,
    granted: boolean,
  ) {
    this.database
      .prepare(
        "INSERT INTO viewer_consents(session,platform,channel,author,granted,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(session,platform,channel,author) DO UPDATE SET granted=excluded.granted,updated=excluded.updated",
      )
      .run(
        this.environment.sessionId(),
        platform,
        channel,
        author,
        granted ? 1 : 0,
        this.environment.now(),
      );
  }
  handle(message: ValidatedIncoming): Admission {
    const session = this.environment.sessionId();
    const command = message.text.trim().toLocaleLowerCase();
    const hash = this.hash(message.platform, message.channel, message.author);
    if (command === "!동의" || command === "!철회") {
      const granted = command === "!동의";
      this.consent(message.platform, message.channel, message.author, granted);
      this.database
        .prepare(
          "INSERT INTO consent_notice_targets(session,platform,channel,author_hash,state,last_notice) VALUES(?,?,?,?,?,NULL) ON CONFLICT(session,platform,channel,author_hash) DO UPDATE SET state=excluded.state",
        )
        .run(
          session,
          message.platform,
          message.channel,
          hash,
          granted ? "consented" : "withdrawn",
        );
      const removed: number[] = [];
      if (!granted) {
        const ids = this.database
          .prepare(
            "SELECT id FROM messages WHERE session=? AND platform=? AND channel=? AND actor IN (SELECT id FROM actors_private WHERE session=? AND source=? AND author=?)",
          )
          .all(
            session,
            message.platform,
            message.channel,
            session,
            message.platform,
            message.author,
          )
          .map((row) => String(row.id));
        this.environment.erase(ids, removed);
      }
      this.database
        .prepare("INSERT INTO audit_events(session,at,action) VALUES(?,?,?)")
        .run(
          session,
          this.environment.now(),
          granted ? "viewer.consent.granted" : "viewer.consent.withdrawn",
        );
      return { allow: false, epoch: 0, removed, invalidated: !granted };
    }
    const allowed = !!this.database
      .prepare(
        "SELECT granted FROM viewer_consents WHERE session=? AND platform=? AND channel=? AND author=?",
      )
      .get(session, message.platform, message.channel, message.author)?.granted;
    if (!allowed)
      this.database
        .prepare(
          "INSERT INTO consent_notice_targets(session,platform,channel,author_hash,state,last_notice) VALUES(?,?,?,?, 'pending',NULL) ON CONFLICT(session,platform,channel,author_hash) DO NOTHING",
        )
        .run(session, message.platform, message.channel, hash);
    return { allow: allowed, epoch: 0 };
  }
  claimNotices(): ReferenceNotice[] {
    const now = this.environment.now(),
      session = this.environment.sessionId();
    const due = this.database
      .prepare(
        `SELECT DISTINCT t.platform,t.channel FROM consent_notice_targets t
      LEFT JOIN consent_notice_state s ON s.session=t.session AND s.platform=t.platform AND s.channel=t.channel
      WHERE t.session=? AND t.state='pending' AND (s.last_notice IS NULL OR s.last_notice<=?)`,
      )
      .all(session, now - 30000);
    return due.map((target) => {
      const platform = String(target.platform),
        channel = String(target.channel);
      this.database
        .prepare(
          "INSERT INTO consent_notice_state(session,platform,channel,last_notice) VALUES(?,?,?,?) ON CONFLICT(session,platform,channel) DO UPDATE SET last_notice=excluded.last_notice",
        )
        .run(session, platform, channel, now);
      this.database
        .prepare(
          "UPDATE consent_notice_targets SET last_notice=? WHERE session=? AND platform=? AND channel=? AND state='pending'",
        )
        .run(now, session, platform, channel);
      return { platform, channel, occurredAt: now };
    });
  }
  pending(platform: string, channel: string) {
    return !!this.database
      .prepare(
        "SELECT 1 FROM consent_notice_targets WHERE session=? AND platform=? AND channel=? AND state='pending' LIMIT 1",
      )
      .get(this.environment.sessionId(), platform, channel);
  }
}
