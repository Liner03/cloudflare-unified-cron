import { ADMIN_SESSION_TTL_MS } from "../../domain/auth";
import { randomBase64Url, sha256Hex } from "../security/crypto";

/** Owns opaque administrator session persistence and token hashing. */
export class AdminSessionRepository {
  constructor(private readonly db: D1Database) {}

  async findActor(rawToken: string, now: number): Promise<string | null> {
    const row = await this.db
      .prepare(
        `SELECT username FROM admin_sessions
         WHERE token_hash = ? AND expires_at > ?`,
      )
      .bind(await sha256Hex(rawToken), now)
      .first<{ username: string }>();
    return row?.username ?? null;
  }

  async create(
    username: string,
    now: number,
  ): Promise<{ token: string; expiresAt: number }> {
    const token = `ucas_${randomBase64Url(32)}`;
    const expiresAt = now + ADMIN_SESSION_TTL_MS;
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO admin_sessions (
             token_hash, username, created_at, last_seen_at, expires_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(await sha256Hex(token), username, now, now, expiresAt),
      this.db
        .prepare(
          `INSERT INTO audit_events (
             id, actor, action, entity_type, entity_id, changes_json, created_at
           ) VALUES (?, ?, 'auth.login', 'administrator', ?, '{}', ?)`,
        )
        .bind(crypto.randomUUID(), username, username, now),
    ]);
    return { token, expiresAt };
  }

  async revoke(rawToken: string, now: number): Promise<void> {
    const tokenHash = await sha256Hex(rawToken);
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO audit_events (
             id, actor, action, entity_type, entity_id, changes_json, created_at
           )
           SELECT ?, username, 'auth.logout', 'administrator', username, '{}', ?
           FROM admin_sessions WHERE token_hash = ?`,
        )
        .bind(crypto.randomUUID(), now, tokenHash),
      this.db
        .prepare("DELETE FROM admin_sessions WHERE token_hash = ?")
        .bind(tokenHash),
    ]);
  }
}
