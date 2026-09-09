import {
  LIMITS,
  jsonByteLength,
  jsonValueSchema,
  retryPolicySchema,
  type JsonValue,
} from "@unified-cron/contracts";
import { z } from "zod";
import type { ScheduleSnapshot } from "../../domain/model";
import { ApiError } from "../../api/errors";
import { serializeExecutionSummary } from "./execution-view";
import type { MutationPlan } from "./idempotent-mutation";
import { CronCalculator } from "../cron/cron-calculator";
import {
  RegisteredTargetCatalog,
  type RegisteredTargetCapability,
} from "./registered-target-catalog";

const scheduleRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  target_id: z.string(),
  action: z.string(),
  action_version: z.number(),
  cron_expression: z.string(),
  timezone: z.string(),
  enabled: z.number(),
  archived_at: z.number().nullable(),
  revision: z.number(),
  payload_json: z.string(),
  retry_policy_json: z.string(),
  timeout_ms: z.number(),
  misfire_policy: z.enum(["coalesce", "skip"]),
  misfire_grace_seconds: z.number(),
  next_run_at: z.number().nullable(),
  registration_key: z.string().nullable(),
  managed_by_registration: z.number(),
  declared_enabled: z.number(),
  operator_paused: z.number(),
  retired_at: z.number().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});

const scheduleListRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  target_id: z.string(),
  action: z.string(),
  action_version: z.number(),
  cron_expression: z.string(),
  timezone: z.string(),
  enabled: z.number(),
  declared_enabled: z.number(),
  operator_paused: z.number(),
  registration_key: z.string(),
  revision: z.number(),
  next_run_at: z.number().nullable(),
  last_status: z.string().nullable(),
  last_execution_at: z.number().nullable(),
});

type ScheduleRow = z.infer<typeof scheduleRowSchema>;

interface ScheduleInput {
  name: string;
  description: string;
  targetId: string;
  action: string;
  actionVersion: number;
  cronExpression: string;
  timezone: string;
  payload: JsonValue;
  retryPolicy: z.infer<typeof retryPolicySchema>;
  timeoutMs: number;
  misfirePolicy: "coalesce" | "skip";
  misfireGraceSeconds: number;
}

/** Read and operator-command interface for Registration-managed schedules. */
export class ManagedScheduleRepository {
  constructor(
    private readonly db: D1Database,
    private readonly cron = new CronCalculator(),
    private readonly targets = new RegisteredTargetCatalog(db),
  ) {}

  async list(filters: {
    search: string;
    target: string;
    enabled: "" | "true" | "false";
  }) {
    const result = await this.db
      .prepare(
        `SELECT s.id, s.name, s.description, s.target_id, s.action,
                s.action_version, s.cron_expression, s.timezone, s.enabled,
                s.declared_enabled, s.operator_paused, s.registration_key,
                s.revision, s.next_run_at,
                (SELECT e.status FROM executions e WHERE e.schedule_id = s.id
                 ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS last_status,
                (SELECT e.created_at FROM executions e WHERE e.schedule_id = s.id
                 ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS last_execution_at
         FROM schedules s
         WHERE s.managed_by_registration = 1 AND s.retired_at IS NULL
           AND (? = '' OR s.name LIKE '%' || ? || '%' ESCAPE '\\')
           AND (? = '' OR s.target_id = ?)
           AND (? = '' OR s.enabled = CASE ? WHEN 'true' THEN 1 ELSE 0 END)
         ORDER BY s.name, s.id
         LIMIT 50`,
      )
      .bind(
        filters.search,
        escapeLike(filters.search),
        filters.target,
        filters.target,
        filters.enabled,
        filters.enabled,
      )
      .all();
    return result.results.map(serializeListRow);
  }

  async detail(id: string) {
    const row = await this.requireManaged(id);
    const recent = await this.db
      .prepare(
        `SELECT id, schedule_id, target_id, source, status, reason_code,
                scheduled_for, attempt_count, created_at, finished_at
         FROM executions WHERE schedule_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 10`,
      )
      .bind(row.id)
      .all();
    return {
      ...serializeSchedule(row),
      recentExecutions: recent.results.map(serializeExecutionSummary),
    };
  }

  async planPause(
    id: string,
    revision: number,
    now: number,
  ): Promise<MutationPlan> {
    const row = await this.requireManaged(id);
    return {
      statement: this.db
        .prepare(
          `UPDATE schedules
           SET operator_paused = 1, enabled = 0, next_run_at = NULL,
               revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND managed_by_registration = 1
             AND retired_at IS NULL AND operator_paused = 0`,
        )
        .bind(now, row.id, revision),
      response: {
        data: {
          id: row.id,
          enabled: false,
          operatorPaused: true,
          revision: revision + 1,
        },
      },
      status: 200,
      action: "schedule.operator_paused",
      entityType: "schedule",
      entityId: row.id,
      changes: { operatorPaused: true, revision: revision + 1 },
      conflictCode: "SCHEDULE_REVISION_CONFLICT",
      conflictMessage: "计划状态已变化，请刷新后重试",
    };
  }

  async planResume(
    id: string,
    revision: number,
    now: number,
  ): Promise<MutationPlan> {
    const row = await this.requireManaged(id);
    const input = rowToInput(row);
    const capability = await this.validate(input, now);
    const effectiveEnabled = row.declared_enabled === 1;
    const nextRunAt = effectiveEnabled ? capability.nextRunAt : null;
    return {
      statement: this.db
        .prepare(
          `UPDATE schedules
           SET operator_paused = 0, enabled = declared_enabled, next_run_at = ?,
               revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND managed_by_registration = 1
             AND retired_at IS NULL AND operator_paused = 1`,
        )
        .bind(nextRunAt, now, row.id, revision),
      response: {
        data: {
          id: row.id,
          enabled: effectiveEnabled,
          operatorPaused: false,
          revision: revision + 1,
          nextRunAt: toIso(nextRunAt),
        },
      },
      status: 200,
      action: "schedule.operator_resumed",
      entityType: "schedule",
      entityId: row.id,
      changes: { operatorPaused: false, revision: revision + 1, nextRunAt },
      conflictCode: "SCHEDULE_REVISION_CONFLICT",
      conflictMessage: "计划状态已变化，请刷新后重试",
    };
  }

  async planRun(id: string, now: number): Promise<MutationPlan> {
    const row = await this.requireManaged(id);
    const input = rowToInput(row);
    const capability = await this.validate(input, now);
    await this.requireTargetEnabled(row.target_id);
    const executionId = crypto.randomUUID();
    const snapshot = buildSnapshot(input, row.revision, capability);
    snapshot.scheduleId = row.id;
    return {
      statement: this.db
        .prepare(
          `INSERT INTO executions (
             id, schedule_id, target_id, source, scheduled_for, dedupe_key,
             schedule_revision, snapshot_json, status, available_at,
             next_attempt_reason, attempt_limit, max_auto_attempts,
             retry_deadline_at, created_at, updated_at
           )
           SELECT ?, id, target_id, 'manual', NULL, ?, revision, ?, 'pending', ?,
                  'initial', ?, ?, ?, ?, ?
           FROM schedules
           WHERE id = ? AND revision = ? AND managed_by_registration = 1
             AND retired_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM executions active WHERE active.schedule_id = schedules.id
                 AND active.status IN ('pending', 'running', 'retry_wait', 'unknown')
             )`,
        )
        .bind(
          executionId,
          `manual:${executionId}`,
          JSON.stringify(snapshot),
          now,
          input.retryPolicy.maxAttempts,
          input.retryPolicy.maxAttempts,
          now + 24 * 60 * 60 * 1000,
          now,
          now,
          row.id,
          row.revision,
        ),
      response: { data: { executionId, status: "pending" } },
      status: 202,
      action: "execution.run_now_requested",
      entityType: "execution",
      entityId: executionId,
      changes: { scheduleId: row.id, source: "manual" },
      conflictCode: "SCHEDULE_RUN_CONFLICT",
      conflictMessage: "计划 revision 已变化或已有尚未完成的执行，请刷新后重试",
    };
  }

  private async requireManaged(id: string): Promise<ScheduleRow> {
    const value = await this.db
      .prepare(
        `SELECT id, name, description, target_id, action, action_version,
                cron_expression, timezone, enabled, archived_at, revision,
                payload_json, retry_policy_json, timeout_ms, misfire_policy,
                misfire_grace_seconds, next_run_at, registration_key,
                managed_by_registration, declared_enabled, operator_paused,
                retired_at, created_at, updated_at
         FROM schedules WHERE id = ? LIMIT 1`,
      )
      .bind(id)
      .first();
    if (!value) throw new ApiError(404, "SCHEDULE_NOT_FOUND", "计划不存在");
    const row = scheduleRowSchema.parse(value);
    if (row.managed_by_registration !== 1 || row.retired_at !== null) {
      throw new ApiError(404, "SCHEDULE_NOT_FOUND", "计划不存在");
    }
    return row;
  }

  private async validate(input: ScheduleInput, now: number) {
    if (jsonByteLength(input.payload) > LIMITS.payloadBytes) {
      throw new ApiError(
        422,
        "PAYLOAD_TOO_LARGE",
        "Schedule payload 不得超过 16 KiB",
      );
    }
    const capability = await this.targets.findCapability(
      input.targetId,
      input.action,
      input.actionVersion,
    );
    if (!capability) {
      throw new ApiError(
        422,
        "TARGET_ACTION_NOT_DECLARED",
        "Target、Action 或版本不在最新 Registration 中",
      );
    }
    if (input.retryPolicy.maxAttempts > 1 && !capability.action.idempotent) {
      throw new ApiError(
        422,
        "NON_IDEMPOTENT_RETRY_FORBIDDEN",
        "非幂等 Action 不允许自动重试",
      );
    }
    if (input.retryPolicy.retryOnUnknown && !capability.action.idempotent) {
      throw new ApiError(
        422,
        "NON_IDEMPOTENT_UNKNOWN_RETRY_FORBIDDEN",
        "非幂等 Action 不允许重试未知结果",
      );
    }
    return {
      ...capability,
      nextRunAt: this.cron.nextAfter(input.cronExpression, input.timezone, now),
    };
  }

  private async requireTargetEnabled(targetId: string): Promise<void> {
    const state = await this.db
      .prepare("SELECT enabled FROM targets WHERE id = ? LIMIT 1")
      .bind(targetId)
      .first<{ enabled: number }>();
    if (!state) {
      throw new ApiError(
        422,
        "TARGET_NOT_SYNCED",
        "Target manifest 尚未同步到 D1",
      );
    }
    if (state.enabled !== 1) {
      throw new ApiError(409, "TARGET_DISABLED", "Target 当前已禁用");
    }
  }
}

function rowToInput(row: ScheduleRow): ScheduleInput {
  return {
    name: row.name,
    description: row.description,
    targetId: row.target_id,
    action: row.action,
    actionVersion: row.action_version,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    payload: jsonValueSchema.parse(JSON.parse(row.payload_json)),
    retryPolicy: retryPolicySchema.parse(JSON.parse(row.retry_policy_json)),
    timeoutMs: row.timeout_ms,
    misfirePolicy: row.misfire_policy,
    misfireGraceSeconds: row.misfire_grace_seconds,
  };
}

function buildSnapshot(
  input: ScheduleInput,
  revision: number,
  capability: RegisteredTargetCapability,
): ScheduleSnapshot {
  return {
    scheduleId: "",
    scheduleRevision: revision,
    targetId: input.targetId,
    action: input.action,
    actionVersion: input.actionVersion,
    targetManifestRevision: capability.target.manifestRevision,
    targetActionIdempotent: capability.action.idempotent,
    payload: input.payload,
    retryPolicy: input.retryPolicy,
    timeoutMs: input.timeoutMs,
    cronExpression: input.cronExpression,
    timezone: input.timezone,
  };
}

function serializeSchedule(row: ScheduleRow) {
  return {
    id: row.id,
    key: row.registration_key,
    name: row.name,
    description: row.description,
    targetId: row.target_id,
    action: row.action,
    actionVersion: row.action_version,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    enabled: row.enabled === 1,
    archivedAt: toIso(row.archived_at),
    revision: row.revision,
    payload: jsonValueSchema.parse(JSON.parse(row.payload_json)),
    retryPolicy: retryPolicySchema.parse(JSON.parse(row.retry_policy_json)),
    timeoutMs: row.timeout_ms,
    misfirePolicy: row.misfire_policy,
    misfireGraceSeconds: row.misfire_grace_seconds,
    nextRunAt: toIso(row.next_run_at),
    managedByRegistration: row.managed_by_registration === 1,
    declaredEnabled: row.declared_enabled === 1,
    operatorPaused: row.operator_paused === 1,
    retiredAt: toIso(row.retired_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function serializeListRow(value: unknown) {
  const row = scheduleListRowSchema.parse(value);
  return {
    id: row.id,
    key: row.registration_key,
    name: row.name,
    description: row.description,
    targetId: row.target_id,
    action: row.action,
    actionVersion: row.action_version,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    enabled: row.enabled === 1,
    declaredEnabled: row.declared_enabled === 1,
    operatorPaused: row.operator_paused === 1,
    revision: row.revision,
    nextRunAt: toIso(row.next_run_at),
    lastExecution:
      row.last_status === null
        ? null
        : { status: row.last_status, at: toIso(row.last_execution_at) },
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function toIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
