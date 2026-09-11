import {
  LIMITS,
  jsonByteLength,
  type WorkerRegistrationV1,
} from "@unified-cron/contracts";
import { z } from "zod";
import { DomainError } from "../../domain/error";
import {
  canonicalRegistrationDocument,
  canonicalScheduleConfiguration,
} from "../../domain/registration-canonical";
import { getTargetManifest } from "../../targets.manifest";
import { CronCalculator } from "../cron/cron-calculator";
import { sha256Hex } from "../security/crypto";

const existingRegistrationSchema = z.object({
  registration_revision: z.string(),
  document_hash: z.string(),
  registered_at: z.number(),
});

const historicalRevisionSchema = z.object({
  document_hash: z.string(),
  first_seen_at: z.number(),
});

const countSchema = z.object({ count: z.number() });
const storedIdempotencySchema = z.object({
  request_hash: z.string(),
  response_json: z.string(),
});
const appliedRegistrationSchema = z.object({
  targetId: z.string(),
  registrationRevision: z.string(),
  unchanged: z.boolean(),
  actions: z.number().int().min(0),
  schedules: z.number().int().min(0),
  retiredSchedules: z.number().int().min(0),
  registeredAt: z.string(),
});
const REGISTRATION_IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface RegistrationPrincipal {
  tokenId: string;
  targetId: string;
}

export interface AppliedRegistration {
  targetId: string;
  registrationRevision: string;
  unchanged: boolean;
  actions: number;
  schedules: number;
  retiredSchedules: number;
  registeredAt: string;
}

interface PreparedRegistrationIdempotency {
  scope: string;
  key: string;
  requestHash: string;
  now: number;
}

type StoredRegistrationIdempotency = z.infer<typeof storedIdempotencySchema>;

/**
 * Applies one Registrant Worker's full desired state as a bounded D1 transaction.
 * The interface hides hashing, optimistic concurrency, bulk SQL, retirement, and
 * the rule that an Operator Override always wins.
 */
export class RegistrationRepository {
  constructor(
    private readonly db: D1Database,
    private readonly cron: CronCalculator,
  ) {}

  async apply(
    principal: RegistrationPrincipal,
    declaration: WorkerRegistrationV1,
    idempotencyInput?: { key: string; rawBody: Uint8Array },
  ): Promise<AppliedRegistration> {
    if (!getTargetManifest(principal.targetId)) {
      throw new DomainError(
        "forbidden",
        "TARGET_NOT_PREAUTHORIZED",
        "Token 绑定的 Target 不在部署白名单中",
      );
    }
    const target = await this.db
      .prepare("SELECT id FROM targets WHERE id = ? LIMIT 1")
      .bind(principal.targetId)
      .first();
    if (!target) {
      throw new DomainError(
        "conflict",
        "TARGET_NOT_SYNCED",
        "Target manifest 尚未同步到 D1",
      );
    }

    const documentHash = await sha256Hex(
      canonicalRegistrationDocument(declaration),
    );
    const now = Date.now();
    const idempotencyState =
      idempotencyInput === undefined
        ? null
        : await this.prepareIdempotency(principal, idempotencyInput, now);
    if (idempotencyState?.replay) return idempotencyState.replay;
    const idempotency = idempotencyState?.prepared ?? null;
    const [currentValue, historicalValue, otherScheduleCountValue] =
      await Promise.all([
        this.db
          .prepare(
            `SELECT registration_revision, document_hash, registered_at
             FROM registrations WHERE target_id = ? LIMIT 1`,
          )
          .bind(principal.targetId)
          .first(),
        this.db
          .prepare(
            `SELECT document_hash, first_seen_at
             FROM registration_revisions
             WHERE target_id = ? AND registration_revision = ? LIMIT 1`,
          )
          .bind(principal.targetId, declaration.registrationRevision)
          .first(),
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM schedules
             WHERE target_id <> ? AND managed_by_registration = 1
               AND retired_at IS NULL`,
          )
          .bind(principal.targetId)
          .first(),
      ]);
    const current = currentValue
      ? existingRegistrationSchema.parse(currentValue)
      : null;
    const historical = historicalValue
      ? historicalRevisionSchema.parse(historicalValue)
      : null;
    if (historical !== null && historical.document_hash !== documentHash) {
      throw revisionConflict();
    }
    const otherScheduleCount = countSchema.parse(otherScheduleCountValue).count;
    if (otherScheduleCount + declaration.schedules.length > 50) {
      throw scheduleLimitReached();
    }
    if (
      current?.registration_revision === declaration.registrationRevision &&
      current.document_hash === documentHash
    ) {
      const result = resultView(
        principal.targetId,
        declaration,
        true,
        0,
        current.registered_at,
      );
      return this.confirmNoopRegistration(
        principal,
        declaration.registrationRevision,
        documentHash,
        now,
        result,
        idempotency,
      );
    }

    const scheduleRows = await Promise.all(
      declaration.schedules.map(async (schedule) => {
        if (jsonByteLength(schedule.payload) > LIMITS.payloadBytes) {
          throw new DomainError(
            "invalid",
            "PAYLOAD_TOO_LARGE",
            `Schedule ${schedule.key} 的 payload 不得超过 16 KiB`,
          );
        }
        return {
          id: crypto.randomUUID(),
          key: schedule.key,
          name: schedule.name,
          description: schedule.description,
          action: schedule.action,
          actionVersion: schedule.actionVersion,
          cronExpression: schedule.cronExpression,
          timezone: schedule.timezone,
          declaredEnabled: schedule.enabled ? 1 : 0,
          payloadJson: JSON.stringify(schedule.payload),
          retryPolicyJson: JSON.stringify(schedule.retryPolicy),
          timeoutMs: schedule.timeoutMs,
          misfirePolicy: schedule.misfirePolicy,
          misfireGraceSeconds: schedule.misfireGraceSeconds,
          nextRunAt: schedule.enabled
            ? this.cron.nextAfter(
                schedule.cronExpression,
                schedule.timezone,
                now,
              )
            : null,
          configHash: await sha256Hex(canonicalScheduleConfiguration(schedule)),
        };
      }),
    );
    const actionRows = declaration.actions.map((action) => ({
      name: action.name,
      version: action.version,
      label: action.label,
      description: action.description,
      idempotent: action.idempotent ? 1 : 0,
      examplePayloadJson:
        action.examplePayload === undefined
          ? null
          : JSON.stringify(action.examplePayload),
    }));
    const declaredKeysJson = JSON.stringify(
      declaration.schedules.map((schedule) => schedule.key),
    );
    const retiredValue = await this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM schedules
         WHERE target_id = ? AND managed_by_registration = 1
           AND retired_at IS NULL
           AND registration_key NOT IN (SELECT value FROM json_each(?))`,
      )
      .bind(principal.targetId, declaredKeysJson)
      .first();
    const retiredSchedules = countSchema.parse(retiredValue).count;

    const result = resultView(
      principal.targetId,
      declaration,
      false,
      retiredSchedules,
      now,
    );
    const statements: D1PreparedStatement[] = [
      ...(idempotency === null
        ? []
        : [this.idempotencyStatement(idempotency, result)]),
      this.activeTokenGuard(principal, now),
      ...this.revisionGuardStatements(
        principal,
        declaration.registrationRevision,
        documentHash,
        now,
      ),
      current === null
        ? this.db
            .prepare(
              `INSERT INTO registrations (
                 target_id, registration_revision, document_hash, worker_label,
                 registered_at, token_id
               ) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(target_id) DO NOTHING`,
            )
            .bind(
              principal.targetId,
              declaration.registrationRevision,
              documentHash,
              declaration.worker.label,
              now,
              principal.tokenId,
            )
        : this.db
            .prepare(
              `UPDATE registrations
               SET registration_revision = ?, document_hash = ?, worker_label = ?,
                   registered_at = ?, token_id = ?
               WHERE target_id = ? AND registration_revision = ?
                 AND document_hash = ?`,
            )
            .bind(
              declaration.registrationRevision,
              documentHash,
              declaration.worker.label,
              now,
              principal.tokenId,
              principal.targetId,
              current.registration_revision,
              current.document_hash,
            ),
      this.db.prepare(
        "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json('') END AS registration_guard",
      ),
      this.db
        .prepare(
          `UPDATE schedules
           SET enabled = 0, declared_enabled = 0,
               archived_at = ?, retired_at = ?, next_run_at = NULL,
               revision = revision + 1, updated_at = ?
           WHERE target_id = ? AND managed_by_registration = 1
             AND retired_at IS NULL
             AND registration_key NOT IN (SELECT value FROM json_each(?))`,
        )
        .bind(now, now, now, principal.targetId, declaredKeysJson),
      this.db
        .prepare("DELETE FROM registered_actions WHERE target_id = ?")
        .bind(principal.targetId),
    ];
    if (actionRows.length > 0) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO registered_actions (
               target_id, name, version, label, description, idempotent,
               example_payload_json, created_at, updated_at
             )
             SELECT ?,
                    json_extract(item.value, '$.name'),
                    json_extract(item.value, '$.version'),
                    json_extract(item.value, '$.label'),
                    json_extract(item.value, '$.description'),
                    json_extract(item.value, '$.idempotent'),
                    json_extract(item.value, '$.examplePayloadJson'),
                    ?, ?
             FROM json_each(?) AS item`,
          )
          .bind(principal.targetId, now, now, JSON.stringify(actionRows)),
      );
    }
    if (scheduleRows.length > 0) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO schedules (
               id, name, description, target_id, action, action_version,
               cron_expression, timezone, enabled, archived_at, revision,
               payload_json, retry_policy_json, timeout_ms, misfire_policy,
               misfire_grace_seconds, next_run_at, created_at, updated_at,
               registration_key, managed_by_registration, declared_enabled,
               operator_paused, retired_at, registration_config_hash
             )
             SELECT
               json_extract(item.value, '$.id'),
               json_extract(item.value, '$.name'),
               json_extract(item.value, '$.description'),
               ?,
               json_extract(item.value, '$.action'),
               json_extract(item.value, '$.actionVersion'),
               json_extract(item.value, '$.cronExpression'),
               json_extract(item.value, '$.timezone'),
               json_extract(item.value, '$.declaredEnabled'),
               NULL,
               1,
               json_extract(item.value, '$.payloadJson'),
               json_extract(item.value, '$.retryPolicyJson'),
               json_extract(item.value, '$.timeoutMs'),
               json_extract(item.value, '$.misfirePolicy'),
               json_extract(item.value, '$.misfireGraceSeconds'),
               json_extract(item.value, '$.nextRunAt'),
               ?, ?,
               json_extract(item.value, '$.key'),
               1,
               json_extract(item.value, '$.declaredEnabled'),
               0,
               NULL,
               json_extract(item.value, '$.configHash')
             FROM json_each(?) AS item
             WHERE true
             ON CONFLICT(target_id, registration_key)
               WHERE managed_by_registration = 1
             DO UPDATE SET
               name = excluded.name,
               description = excluded.description,
               action = excluded.action,
               action_version = excluded.action_version,
               cron_expression = excluded.cron_expression,
               timezone = excluded.timezone,
               enabled = CASE
                 WHEN excluded.declared_enabled = 1
                      AND schedules.operator_paused = 0 THEN 1
                 ELSE 0
               END,
               archived_at = NULL,
               revision = schedules.revision + CASE
                 WHEN schedules.retired_at IS NOT NULL
                   OR schedules.registration_config_hash IS NOT excluded.registration_config_hash
                 THEN 1 ELSE 0 END,
               payload_json = excluded.payload_json,
               retry_policy_json = excluded.retry_policy_json,
               timeout_ms = excluded.timeout_ms,
               misfire_policy = excluded.misfire_policy,
               misfire_grace_seconds = excluded.misfire_grace_seconds,
               next_run_at = CASE
                 WHEN excluded.declared_enabled = 0
                      OR schedules.operator_paused = 1 THEN NULL
                 WHEN schedules.retired_at IS NULL
                   AND schedules.registration_config_hash = excluded.registration_config_hash
                   AND schedules.next_run_at IS NOT NULL
                 THEN schedules.next_run_at
                 ELSE excluded.next_run_at
               END,
               declared_enabled = excluded.declared_enabled,
               retired_at = NULL,
               registration_config_hash = excluded.registration_config_hash,
               updated_at = excluded.updated_at`,
          )
          .bind(principal.targetId, now, now, JSON.stringify(scheduleRows)),
      );
    }
    statements.push(
      this.db.prepare(
        `SELECT CASE WHEN COUNT(*) <= 50 THEN 1 ELSE json('') END
           AS schedule_capacity_guard
         FROM schedules
         WHERE managed_by_registration = 1 AND retired_at IS NULL`,
      ),
      this.db
        .prepare("UPDATE registration_tokens SET last_used_at = ? WHERE id = ?")
        .bind(now, principal.tokenId),
      this.db
        .prepare(
          `INSERT INTO audit_events (
             id, actor, action, entity_type, entity_id, changes_json, created_at
           ) VALUES (?, ?, 'registration.applied', 'target', ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          `registration-token:${principal.tokenId}`,
          principal.targetId,
          JSON.stringify({
            registrationRevision: declaration.registrationRevision,
            actions: declaration.actions.length,
            schedules: declaration.schedules.length,
            retiredSchedules,
          }),
          now,
        ),
    );
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (idempotency !== null) {
        const raced = await this.readIdempotency(
          idempotency.scope,
          idempotency.key,
          idempotency.now,
        );
        if (raced) return replayIdempotency(raced, idempotency.requestHash);
      }
      return this.rethrowRegistrationError(
        error,
        principal,
        declaration.registrationRevision,
        documentHash,
        now,
        declaration.schedules.length,
      );
    }
    return result;
  }

  private async confirmNoopRegistration(
    principal: RegistrationPrincipal,
    registrationRevision: string,
    documentHash: string,
    now: number,
    result: AppliedRegistration,
    idempotency: PreparedRegistrationIdempotency | null,
  ): Promise<AppliedRegistration> {
    try {
      await this.db.batch([
        ...(idempotency === null
          ? []
          : [this.idempotencyStatement(idempotency, result)]),
        this.activeTokenGuard(principal, now),
        ...this.revisionGuardStatements(
          principal,
          registrationRevision,
          documentHash,
          now,
        ),
        this.db
          .prepare(
            `SELECT CASE WHEN EXISTS (
               SELECT 1 FROM registrations
               WHERE target_id = ? AND registration_revision = ?
                 AND document_hash = ?
             ) THEN 1 ELSE json('') END AS current_guard`,
          )
          .bind(principal.targetId, registrationRevision, documentHash),
        this.db
          .prepare(
            "UPDATE registration_tokens SET last_used_at = ? WHERE id = ?",
          )
          .bind(now, principal.tokenId),
      ]);
    } catch (error) {
      if (idempotency !== null) {
        const raced = await this.readIdempotency(
          idempotency.scope,
          idempotency.key,
          idempotency.now,
        );
        if (raced) return replayIdempotency(raced, idempotency.requestHash);
      }
      return this.rethrowRegistrationError(
        error,
        principal,
        registrationRevision,
        documentHash,
        now,
      );
    }
    return result;
  }

  private async rethrowRegistrationError(
    error: unknown,
    principal: RegistrationPrincipal,
    registrationRevision: string,
    documentHash: string,
    now: number,
    declaredScheduleCount?: number,
  ): Promise<never> {
    if (
      error instanceof Error &&
      /MANAGED_SCHEDULE_LIMIT_REACHED/i.test(error.message)
    ) {
      throw scheduleLimitReached();
    }
    if (error instanceof Error && /malformed JSON/i.test(error.message)) {
      const historical = await this.db
        .prepare(
          `SELECT document_hash FROM registration_revisions
           WHERE target_id = ? AND registration_revision = ? LIMIT 1`,
        )
        .bind(principal.targetId, registrationRevision)
        .first<{ document_hash: string }>();
      if (historical && historical.document_hash !== documentHash) {
        throw revisionConflict();
      }
      const token = await this.db
        .prepare(
          `SELECT 1 AS active FROM registration_tokens
           WHERE id = ? AND target_id = ? AND scope = 'registration:write'
             AND revoked_at IS NULL AND expires_at > ? LIMIT 1`,
        )
        .bind(principal.tokenId, principal.targetId, now)
        .first();
      if (!token) {
        throw new DomainError(
          "unauthenticated",
          "REGISTRATION_TOKEN_INVALID",
          "Registration Token 无效、已过期或已撤销",
        );
      }
      if (declaredScheduleCount !== undefined) {
        const otherSchedules = await this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM schedules
             WHERE target_id <> ? AND managed_by_registration = 1
               AND retired_at IS NULL`,
          )
          .bind(principal.targetId)
          .first();
        if (
          countSchema.parse(otherSchedules).count + declaredScheduleCount >
          50
        ) {
          throw scheduleLimitReached();
        }
      }
      throw new DomainError(
        "conflict",
        "REGISTRATION_CONCURRENT_UPDATE",
        "Registration 已被并发更新，请重试",
      );
    }
    throw error;
  }

  private async prepareIdempotency(
    principal: RegistrationPrincipal,
    input: { key: string; rawBody: Uint8Array },
    now: number,
  ): Promise<{
    prepared: PreparedRegistrationIdempotency | null;
    replay: AppliedRegistration | null;
  }> {
    const scope = `registration-token:${principal.tokenId}:PUT:/api/v1/registration`;
    const requestHash = await sha256Bytes(input.rawBody);
    const stored = await this.readIdempotency(scope, input.key, now);
    if (stored) {
      return {
        prepared: null,
        replay: replayIdempotency(stored, requestHash),
      };
    }
    return {
      prepared: { scope, key: input.key, requestHash, now },
      replay: null,
    };
  }

  private readIdempotency(
    scope: string,
    key: string,
    now: number,
  ): Promise<StoredRegistrationIdempotency | null> {
    return this.db
      .prepare(
        `SELECT request_hash, response_json
         FROM api_idempotency
         WHERE scope = ? AND key = ? AND expires_at > ?`,
      )
      .bind(scope, key, now)
      .first()
      .then((value) =>
        value === null ? null : storedIdempotencySchema.parse(value),
      );
  }

  private idempotencyStatement(
    input: PreparedRegistrationIdempotency,
    result: AppliedRegistration,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO api_idempotency (
           scope, key, request_hash, status_code, response_json,
           created_at, expires_at
         ) VALUES (?, ?, ?, 200, ?, ?, ?)`,
      )
      .bind(
        input.scope,
        input.key,
        input.requestHash,
        JSON.stringify(result),
        input.now,
        input.now + REGISTRATION_IDEMPOTENCY_TTL_MS,
      );
  }

  private activeTokenGuard(
    principal: RegistrationPrincipal,
    now: number,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `SELECT CASE WHEN EXISTS (
           SELECT 1 FROM registration_tokens
           WHERE id = ? AND target_id = ? AND scope = 'registration:write'
             AND revoked_at IS NULL AND expires_at > ?
         ) THEN 1 ELSE json('') END AS token_guard`,
      )
      .bind(principal.tokenId, principal.targetId, now);
  }

  private revisionGuardStatements(
    principal: RegistrationPrincipal,
    registrationRevision: string,
    documentHash: string,
    now: number,
  ): [D1PreparedStatement, D1PreparedStatement] {
    return [
      this.db
        .prepare(
          `INSERT INTO registration_revisions (
             target_id, registration_revision, document_hash, first_seen_at,
             token_id
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(target_id, registration_revision) DO NOTHING`,
        )
        .bind(
          principal.targetId,
          registrationRevision,
          documentHash,
          now,
          principal.tokenId,
        ),
      this.db
        .prepare(
          `SELECT CASE WHEN EXISTS (
             SELECT 1 FROM registration_revisions
             WHERE target_id = ? AND registration_revision = ?
               AND document_hash = ?
           ) THEN 1 ELSE json('') END AS revision_guard`,
        )
        .bind(principal.targetId, registrationRevision, documentHash),
    ];
  }
}

function resultView(
  targetId: string,
  declaration: WorkerRegistrationV1,
  unchanged: boolean,
  retiredSchedules: number,
  registeredAt: number,
): AppliedRegistration {
  return {
    targetId,
    registrationRevision: declaration.registrationRevision,
    unchanged,
    actions: declaration.actions.length,
    schedules: declaration.schedules.length,
    retiredSchedules,
    registeredAt: new Date(registeredAt).toISOString(),
  };
}

function revisionConflict(): DomainError {
  return new DomainError(
    "conflict",
    "REGISTRATION_REVISION_CONFLICT",
    "相同 registrationRevision 已用于不同声明",
  );
}

function scheduleLimitReached(): DomainError {
  return new DomainError(
    "rate_limited",
    "SCHEDULE_LIMIT_REACHED",
    "平台最多管理 50 个未退役 Schedule",
  );
}

function replayIdempotency(
  stored: StoredRegistrationIdempotency,
  requestHash: string,
): AppliedRegistration {
  if (stored.request_hash !== requestHash) {
    throw new DomainError(
      "conflict",
      "IDEMPOTENCY_CONFLICT",
      "相同 Idempotency-Key 已用于不同请求体",
    );
  }
  return appliedRegistrationSchema.parse(JSON.parse(stored.response_json));
}

async function sha256Bytes(value: Uint8Array): Promise<string> {
  const bytes = new Uint8Array(value.byteLength);
  bytes.set(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
