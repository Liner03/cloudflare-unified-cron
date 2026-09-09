import { ApiError } from "../../api/errors";
import { sha256Hex } from "../security/crypto";

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

/** Enforces a small D1-backed login throttle without retaining source IPs. */
export class AdminLoginLimitRepository {
  constructor(private readonly db: D1Database) {}

  async requireAllowed(source: string, now: number): Promise<string> {
    const keyHash = await sha256Hex(source);
    const row = await this.db
      .prepare(
        `SELECT blocked_until FROM admin_login_limits
         WHERE key_hash = ?`,
      )
      .bind(keyHash)
      .first<{ blocked_until: number | null }>();
    const blockedUntil = row?.blocked_until;
    if (
      blockedUntil !== null &&
      blockedUntil !== undefined &&
      blockedUntil > now
    ) {
      throw new ApiError(
        429,
        "LOGIN_RATE_LIMITED",
        "登录尝试过多，请稍后重试",
        { retryAfterSeconds: Math.ceil((blockedUntil - now) / 1000) },
      );
    }
    return keyHash;
  }

  async recordFailure(keyHash: string, now: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO admin_login_limits (
           key_hash, failed_attempts, window_started_at, blocked_until
         ) VALUES (?, 1, ?, NULL)
         ON CONFLICT(key_hash) DO UPDATE SET
           failed_attempts = CASE
             WHEN admin_login_limits.window_started_at <= ? THEN 1
             ELSE admin_login_limits.failed_attempts + 1
           END,
           window_started_at = CASE
             WHEN admin_login_limits.window_started_at <= ? THEN ?
             ELSE admin_login_limits.window_started_at
           END,
           blocked_until = CASE
             WHEN (
               CASE
                 WHEN admin_login_limits.window_started_at <= ? THEN 1
                 ELSE admin_login_limits.failed_attempts + 1
               END
             ) >= ? THEN ?
             ELSE NULL
           END`,
      )
      .bind(
        keyHash,
        now,
        now - WINDOW_MS,
        now - WINDOW_MS,
        now,
        now - WINDOW_MS,
        MAX_FAILURES,
        now + BLOCK_MS,
      )
      .run();
  }

  async clear(keyHash: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM admin_login_limits WHERE key_hash = ?")
      .bind(keyHash)
      .run();
  }
}
