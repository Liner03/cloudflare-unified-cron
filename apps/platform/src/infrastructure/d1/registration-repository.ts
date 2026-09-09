import {
  LIMITS,
  jsonByteLength,
  type WorkerRegistrationV1,
} from "@unified-cron/contracts";
import { z } from "zod";
import { ApiError } from "../../api/errors";
import { getTargetManifest } from "../../targets.manifest";
import { CronCalculator } from "../cron/cron-calculator";
import { sha256Hex } from "../security/crypto";

const existingRegistrationSchema = z.object({
  registration_revision: z.string(),
  document_hash: z.string(),
  registered_at: z.number(),
});

const countSchema = z.object({ count: z.number() });

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
  ): Promise<AppliedRegistration> {
    if (!getTargetManifest(principal.targetId)) {
      throw new ApiError(
        403,
        "TARGET_NOT_PREAUTHORIZED",
        "Token 绑定的 Target 不在部署白名单中",
      );
    }
    const target = await this.db
      .prepare("SELECT id FROM targets WHERE id = ? LIMIT 1")
      .bind(principal.targetId)
      .first();
    if (!target) {
      throw new ApiError(
        409,
        "TARGET_NOT_SYNCED",
        "Target manifest 尚未同步到 D1",
      );
    }

    const documentHash = await sha256Hex(JSON.stringify(declaration));
    const currentValue = await this.db
      .prepare(
        `SELECT registration_revision, document_hash, registered_at
         FROM registrations WHERE target_id = ? LIMIT 1`,
      )
      .bind(principal.targetId)
      .first();
    const current = currentValue
      ? existingRegistrationSchema.parse(currentValue)
      : null;
    if (current?.registration_revision === declaration.registrationRevision) {
      if (current.document_hash !== documentHash) {
        throw new ApiError(
          409,
          "REGISTRATION_REVISION_CONFLICT",
          "相同 registrationRevision 已用于不同声明",
        );
      }
      await this.db
        .prepare("UPDATE registration_tokens SET last_used_at = ? WHERE id = ?")
        .bind(Date.now(), principal.tokenId)
        .run();
      return resultView(
        principal.targetId,
        declaration,
        true,
        0,
        current.registered_at,
      );
    }

    const now = Date.now();
    const scheduleRows = declaration.schedules.map((schedule) => {
      if (jsonByteLength(schedule.payload) > LIMITS.payloadBytes) {
        throw new ApiError(
          422,
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
          ? this.cron.nextAfter(schedule.cronExpression, schedule.timezone, now)
          : null,
      };
    });
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

    const statements: D1PreparedStatement[] = [
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
               operator_paused, retired_at
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
               NULL
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
                   OR schedules.name <> excluded.name
                   OR schedules.description <> excluded.description
                   OR schedules.action <> excluded.action
                   OR schedules.action_version <> excluded.action_version
                   OR schedules.cron_expression <> excluded.cron_expression
                   OR schedules.timezone <> excluded.timezone
                   OR schedules.declared_enabled <> excluded.declared_enabled
                   OR schedules.payload_json <> excluded.payload_json
                   OR schedules.retry_policy_json <> excluded.retry_policy_json
                   OR schedules.timeout_ms <> excluded.timeout_ms
                   OR schedules.misfire_policy <> excluded.misfire_policy
                   OR schedules.misfire_grace_seconds <> excluded.misfire_grace_seconds
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
                   AND schedules.name = excluded.name
                   AND schedules.description = excluded.description
                   AND schedules.action = excluded.action
                   AND schedules.action_version = excluded.action_version
                   AND schedules.cron_expression = excluded.cron_expression
                   AND schedules.timezone = excluded.timezone
                   AND schedules.declared_enabled = excluded.declared_enabled
                   AND schedules.payload_json = excluded.payload_json
                   AND schedules.retry_policy_json = excluded.retry_policy_json
                   AND schedules.timeout_ms = excluded.timeout_ms
                   AND schedules.misfire_policy = excluded.misfire_policy
                   AND schedules.misfire_grace_seconds = excluded.misfire_grace_seconds
                   AND schedules.next_run_at IS NOT NULL
                 THEN schedules.next_run_at
                 ELSE excluded.next_run_at
               END,
               declared_enabled = excluded.declared_enabled,
               retired_at = NULL,
               updated_at = excluded.updated_at`,
          )
          .bind(principal.targetId, now, now, JSON.stringify(scheduleRows)),
      );
    }
    statements.push(
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
      if (error instanceof Error && /malformed JSON/i.test(error.message)) {
        throw new ApiError(
          409,
          "REGISTRATION_CONCURRENT_UPDATE",
          "Registration 已被并发更新，请以新 revision 重试",
        );
      }
      throw error;
    }
    return resultView(
      principal.targetId,
      declaration,
      false,
      retiredSchedules,
      now,
    );
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
