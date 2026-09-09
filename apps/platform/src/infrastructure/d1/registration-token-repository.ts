import { z } from "zod";
import { DomainError } from "../../domain/error";
import { getTargetManifest } from "../../targets.manifest";
import { randomBase64Url, sha256Hex } from "../security/crypto";

const tokenListRowSchema = z.object({
  id: z.string(),
  target_id: z.string(),
  label: z.string(),
  scope: z.literal("registration:write"),
  expires_at: z.number(),
  last_used_at: z.number().nullable(),
  revoked_at: z.number().nullable(),
  created_by: z.string(),
  created_at: z.number(),
  registration_revision: z.string().nullable(),
  worker_label: z.string().nullable(),
  registered_at: z.number().nullable(),
  rotated_from_id: z.string().nullable(),
  replaced_by_id: z.string().nullable(),
});

export interface RegistrationTokenPrincipal {
  tokenId: string;
  targetId: string;
}

export interface RegistrationTokenView {
  id: string;
  targetId: string;
  label: string;
  scope: "registration:write";
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
  registration: {
    revision: string;
    workerLabel: string | null;
    registeredAt: string | null;
  } | null;
  rotatedFromId: string | null;
  replacedById: string | null;
}

/** Owns the full lifecycle of one-target, write-only machine credentials. */
export class RegistrationTokenRepository {
  constructor(private readonly db: D1Database) {}

  async authenticate(
    rawToken: string,
    now: number,
  ): Promise<RegistrationTokenPrincipal | null> {
    const row = await this.db
      .prepare(
        `SELECT id, target_id FROM registration_tokens
         WHERE token_hash = ? AND scope = 'registration:write'
           AND revoked_at IS NULL AND expires_at > ?`,
      )
      .bind(await sha256Hex(rawToken), now)
      .first<{ id: string; target_id: string }>();
    return row ? { tokenId: row.id, targetId: row.target_id } : null;
  }

  async list(): Promise<RegistrationTokenView[]> {
    const result = await this.db
      .prepare(
        `SELECT rt.id, rt.target_id, rt.label, rt.scope, rt.expires_at,
                rt.last_used_at, rt.revoked_at, rt.created_by, rt.created_at,
                r.registration_revision, r.worker_label, r.registered_at,
                rt.rotated_from_id, rt.replaced_by_id
         FROM registration_tokens rt
         LEFT JOIN registrations r ON r.target_id = rt.target_id
         ORDER BY rt.created_at DESC, rt.id DESC
         LIMIT 100`,
      )
      .all();
    return result.results.map((value) => serializeToken(value));
  }

  async issue(input: {
    targetId: string;
    label: string;
    expiresInDays: number;
    actor: string;
    now: number;
  }): Promise<{
    id: string;
    targetId: string;
    label: string;
    token: string;
    expiresAt: string;
  }> {
    if (!getTargetManifest(input.targetId)) {
      throw new DomainError(
        "invalid",
        "TARGET_NOT_PREAUTHORIZED",
        "Target 不在部署白名单中",
      );
    }
    const target = await this.db
      .prepare("SELECT id FROM targets WHERE id = ?")
      .bind(input.targetId)
      .first();
    if (!target) {
      throw new DomainError(
        "invalid",
        "TARGET_NOT_SYNCED",
        "Target manifest 尚未同步到 D1",
      );
    }
    const rawToken = `ucrt_${randomBase64Url(32)}`;
    const id = crypto.randomUUID();
    const expiresAt = input.now + input.expiresInDays * 24 * 60 * 60 * 1000;
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO registration_tokens (
             id, target_id, label, token_hash, expires_at, created_by, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.targetId,
          input.label,
          await sha256Hex(rawToken),
          expiresAt,
          input.actor,
          input.now,
        ),
      this.db
        .prepare(
          `INSERT INTO audit_events (
             id, actor, action, entity_type, entity_id, changes_json, created_at
           ) VALUES (?, ?, 'registration_token.created', 'registration_token', ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          input.actor,
          id,
          JSON.stringify({
            targetId: input.targetId,
            label: input.label,
            expiresAt,
          }),
          input.now,
        ),
    ]);
    return {
      id,
      targetId: input.targetId,
      label: input.label,
      token: rawToken,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async revoke(input: {
    id: string;
    actor: string;
    now: number;
  }): Promise<{ id: string; revokedAt: string }> {
    const current = await this.db
      .prepare("SELECT revoked_at FROM registration_tokens WHERE id = ?")
      .bind(input.id)
      .first<{ revoked_at: number | null }>();
    if (!current) {
      throw new DomainError(
        "not_found",
        "REGISTRATION_TOKEN_NOT_FOUND",
        "Registration Token 不存在",
      );
    }
    if (current.revoked_at !== null) {
      return {
        id: input.id,
        revokedAt: new Date(current.revoked_at).toISOString(),
      };
    }
    try {
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE registration_tokens SET revoked_at = ?
             WHERE id = ? AND revoked_at IS NULL`,
          )
          .bind(input.now, input.id),
        this.db.prepare(
          "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json('') END AS revoke_guard",
        ),
        this.db
          .prepare(
            `INSERT INTO audit_events (
               id, actor, action, entity_type, entity_id, changes_json, created_at
             ) VALUES (?, ?, 'registration_token.revoked', 'registration_token', ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            input.actor,
            input.id,
            JSON.stringify({ revokedAt: input.now }),
            input.now,
          ),
      ]);
      return { id: input.id, revokedAt: new Date(input.now).toISOString() };
    } catch (error) {
      if (!(error instanceof Error) || !/malformed JSON/i.test(error.message)) {
        throw error;
      }
      const raced = await this.db
        .prepare("SELECT revoked_at FROM registration_tokens WHERE id = ?")
        .bind(input.id)
        .first<{ revoked_at: number | null }>();
      if (raced?.revoked_at === null || raced?.revoked_at === undefined) {
        throw error;
      }
      return {
        id: input.id,
        revokedAt: new Date(raced.revoked_at).toISOString(),
      };
    }
  }

  async rotate(input: {
    id: string;
    expiresInDays: number;
    actor: string;
    now: number;
  }): Promise<{
    id: string;
    targetId: string;
    label: string;
    token: string;
    expiresAt: string;
    rotatedFromId: string;
  }> {
    const current = await this.db
      .prepare(
        `SELECT id, target_id, label, expires_at, revoked_at, replaced_by_id
         FROM registration_tokens WHERE id = ? LIMIT 1`,
      )
      .bind(input.id)
      .first<{
        id: string;
        target_id: string;
        label: string;
        expires_at: number;
        revoked_at: number | null;
        replaced_by_id: string | null;
      }>();
    if (!current) {
      throw new DomainError(
        "not_found",
        "REGISTRATION_TOKEN_NOT_FOUND",
        "Registration Token 不存在",
      );
    }
    if (
      current.revoked_at !== null ||
      current.replaced_by_id !== null ||
      current.expires_at <= input.now
    ) {
      throw tokenNotActive();
    }

    const id = crypto.randomUUID();
    const rawToken = `ucrt_${randomBase64Url(32)}`;
    const expiresAt = input.now + input.expiresInDays * 24 * 60 * 60 * 1000;
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO registration_tokens (
               id, target_id, label, token_hash, expires_at, created_by,
               created_at, rotated_from_id
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            current.target_id,
            current.label,
            await sha256Hex(rawToken),
            expiresAt,
            input.actor,
            input.now,
            current.id,
          ),
        this.db
          .prepare(
            `UPDATE registration_tokens
             SET revoked_at = ?, replaced_by_id = ?
             WHERE id = ? AND revoked_at IS NULL AND replaced_by_id IS NULL
               AND expires_at > ?`,
          )
          .bind(input.now, id, current.id, input.now),
        this.db.prepare(
          "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json('') END AS rotation_guard",
        ),
        this.db
          .prepare(
            `INSERT INTO audit_events (
               id, actor, action, entity_type, entity_id, changes_json,
               created_at
             ) VALUES (?, ?, 'registration_token.rotated',
                       'registration_token', ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            input.actor,
            current.id,
            JSON.stringify({
              replacementTokenId: id,
              targetId: current.target_id,
              expiresAt,
            }),
            input.now,
          ),
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        /malformed JSON|constraint failed|UNIQUE constraint/i.test(
          error.message,
        )
      ) {
        throw tokenNotActive();
      }
      throw error;
    }
    return {
      id,
      targetId: current.target_id,
      label: current.label,
      token: rawToken,
      expiresAt: new Date(expiresAt).toISOString(),
      rotatedFromId: current.id,
    };
  }
}

function serializeToken(value: unknown): RegistrationTokenView {
  const row = tokenListRowSchema.parse(value);
  return {
    id: row.id,
    targetId: row.target_id,
    label: row.label,
    scope: row.scope,
    expiresAt: toIso(row.expires_at),
    lastUsedAt: nullableIso(row.last_used_at),
    revokedAt: nullableIso(row.revoked_at),
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    registration:
      row.registration_revision === null
        ? null
        : {
            revision: row.registration_revision,
            workerLabel: row.worker_label,
            registeredAt: nullableIso(row.registered_at),
          },
    rotatedFromId: row.rotated_from_id,
    replacedById: row.replaced_by_id,
  };
}

function toIso(value: number): string {
  return new Date(value).toISOString();
}

function nullableIso(value: number | null): string | null {
  return value === null ? null : toIso(value);
}

function tokenNotActive(): DomainError {
  return new DomainError(
    "conflict",
    "REGISTRATION_TOKEN_NOT_ACTIVE",
    "Registration Token 已撤销、已过期或已被轮换",
  );
}
