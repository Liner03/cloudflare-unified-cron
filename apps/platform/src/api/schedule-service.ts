import {
  LIMITS,
  jsonByteLength,
  jsonValueSchema,
  retryPolicySchema,
  type JsonValue,
} from "@unified-cron/contracts";
import { z } from "zod";
import type { ScheduleSnapshot } from "../domain/model";
import { CronCalculator } from "../infrastructure/cron/cron-calculator";
import { resolveTargetCapability } from "../targets.manifest";
import { ApiError } from "./errors";
import type { ScheduleInput } from "./schemas";

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
  created_at: z.number(),
  updated_at: z.number(),
});

export type ScheduleRow = z.infer<typeof scheduleRowSchema>;

export async function readSchedule(
  db: D1Database,
  id: string,
): Promise<ScheduleRow> {
  const value = await db
    .prepare(
      `SELECT id, name, description, target_id, action, action_version,
              cron_expression, timezone, enabled, archived_at, revision,
              payload_json, retry_policy_json, timeout_ms, misfire_policy,
              misfire_grace_seconds, next_run_at, created_at, updated_at
       FROM schedules WHERE id = ?`,
    )
    .bind(id)
    .first();
  if (!value) throw new ApiError(404, "SCHEDULE_NOT_FOUND", "计划不存在");
  return scheduleRowSchema.parse(value);
}

export function scheduleRowToInput(row: ScheduleRow): ScheduleInput {
  return {
    name: row.name,
    description: row.description,
    targetId: row.target_id,
    action: row.action,
    actionVersion: row.action_version,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    enabled: row.enabled === 1,
    payload: parseJsonValue(row.payload_json),
    retryPolicy: retryPolicySchema.parse(JSON.parse(row.retry_policy_json)),
    timeoutMs: row.timeout_ms,
    misfirePolicy: row.misfire_policy,
    misfireGraceSeconds: row.misfire_grace_seconds,
  };
}

export function validateScheduleInput(
  input: ScheduleInput,
  cron: CronCalculator,
  nowMs: number,
) {
  if (jsonByteLength(input.payload) > LIMITS.payloadBytes) {
    throw new ApiError(
      422,
      "PAYLOAD_TOO_LARGE",
      "Schedule payload 不得超过 16 KiB",
    );
  }
  const capability = resolveTargetCapability(
    input.targetId,
    input.action,
    input.actionVersion,
  );
  if (!capability) {
    throw new ApiError(
      422,
      "TARGET_ACTION_NOT_DECLARED",
      "Target、Action 或版本不在部署白名单中",
    );
  }
  const { target, action } = capability;
  if (input.retryPolicy.maxAttempts > 1 && !action.idempotent) {
    throw new ApiError(
      422,
      "NON_IDEMPOTENT_RETRY_FORBIDDEN",
      "非幂等 Action 不允许自动重试",
    );
  }
  if (input.retryPolicy.retryOnUnknown && !action.idempotent) {
    throw new ApiError(
      422,
      "NON_IDEMPOTENT_UNKNOWN_RETRY_FORBIDDEN",
      "非幂等 Action 不允许重试未知结果",
    );
  }
  const nextRunAt = cron.nextAfter(input.cronExpression, input.timezone, nowMs);
  return { target, action, nextRunAt };
}

export function buildScheduleSnapshot(
  input: ScheduleInput,
  revision: number,
): ScheduleSnapshot {
  const capability = resolveTargetCapability(
    input.targetId,
    input.action,
    input.actionVersion,
  );
  if (!capability) {
    throw new ApiError(
      422,
      "TARGET_ACTION_NOT_DECLARED",
      "Target、Action 或版本不在部署白名单中",
    );
  }
  const { target, action } = capability;
  return {
    scheduleId: "",
    scheduleRevision: revision,
    targetId: input.targetId,
    action: input.action,
    actionVersion: input.actionVersion,
    targetManifestRevision: target.manifestRevision,
    targetActionIdempotent: action.idempotent,
    payload: input.payload,
    retryPolicy: input.retryPolicy,
    timeoutMs: input.timeoutMs,
    cronExpression: input.cronExpression,
    timezone: input.timezone,
  };
}

export function serializeSchedule(row: ScheduleRow) {
  return {
    id: row.id,
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
    payload: parseJsonValue(row.payload_json),
    retryPolicy: retryPolicySchema.parse(JSON.parse(row.retry_policy_json)),
    timeoutMs: row.timeout_ms,
    misfirePolicy: row.misfire_policy,
    misfireGraceSeconds: row.misfire_grace_seconds,
    nextRunAt: toIso(row.next_run_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function requireRevision(header: string | undefined): number {
  if (!header)
    throw new ApiError(
      422,
      "IF_MATCH_REQUIRED",
      "修改计划需要 If-Match revision",
    );
  const match = /^(?:W\/)?"(\d+)"$/.exec(header.trim());
  const revision = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new ApiError(
      422,
      "IF_MATCH_INVALID",
      'If-Match 格式应为 "<revision>"',
    );
  }
  return revision;
}

function parseJsonValue(value: string): JsonValue {
  return jsonValueSchema.parse(JSON.parse(value));
}

function toIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
