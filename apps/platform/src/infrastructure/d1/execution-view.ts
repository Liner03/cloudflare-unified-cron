import { jsonValueSchema, type JsonValue } from "@unified-cron/contracts";
import { z } from "zod";
import { parseSnapshot } from "./execution-repository";
import { DomainError } from "../../domain/error";

export function serializeExecutionSummary(value: unknown) {
  const row = z
    .object({
      id: z.string(),
      schedule_id: z.string(),
      target_id: z.string(),
      source: z.string(),
      status: z.string(),
      reason_code: z.string().nullable(),
      scheduled_for: z.number().nullable(),
      attempt_count: z.number(),
      created_at: z.number(),
      finished_at: z.number().nullable(),
    })
    .parse(value);
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    targetId: row.target_id,
    source: row.source,
    status: row.status,
    reasonCode: row.reason_code,
    scheduledFor: toIso(row.scheduled_for),
    attemptCount: row.attempt_count,
    createdAt: toIso(row.created_at),
    finishedAt: toIso(row.finished_at),
  };
}

const executionRowSchema = z.object({
  id: z.string(),
  schedule_id: z.string(),
  target_id: z.string(),
  source: z.enum(["cron", "manual", "rerun"]),
  scheduled_for: z.number().nullable(),
  parent_execution_id: z.string().nullable(),
  dedupe_key: z.string(),
  schedule_revision: z.number(),
  snapshot_json: z.string(),
  status: z.enum([
    "pending",
    "running",
    "retry_wait",
    "succeeded",
    "failed",
    "unknown",
    "skipped",
    "cancelled",
  ]),
  reason_code: z.string().nullable(),
  available_at: z.number(),
  next_attempt_reason: z.enum(["initial", "automatic_retry", "operator_retry"]),
  attempt_count: z.number(),
  attempt_limit: z.number(),
  max_auto_attempts: z.number(),
  retry_deadline_at: z.number(),
  lease_expires_at: z.number().nullable(),
  started_at: z.number().nullable(),
  finished_at: z.number().nullable(),
  result_json: z.string().nullable(),
  last_error_json: z.string().nullable(),
  operator_resolved_at: z.number().nullable(),
  operator_resolution_note: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});

export type ExecutionRow = z.infer<typeof executionRowSchema>;

export async function readExecution(
  db: D1Database,
  id: string,
): Promise<ExecutionRow> {
  const row = await db
    .prepare("SELECT * FROM executions WHERE id = ?")
    .bind(id)
    .first();
  if (!row) {
    throw new DomainError(
      "not_found",
      "EXECUTION_NOT_FOUND",
      "执行不存在或已清理",
    );
  }
  return executionRowSchema.parse(row);
}

export function serializeExecution(row: ExecutionRow) {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    targetId: row.target_id,
    source: row.source,
    scheduledFor: toIso(row.scheduled_for),
    parentExecutionId: row.parent_execution_id,
    scheduleRevision: row.schedule_revision,
    snapshot: parseJson(row.snapshot_json),
    status: row.status,
    reasonCode: row.reason_code,
    availableAt: toIso(row.available_at),
    nextAttemptReason: row.next_attempt_reason,
    attemptCount: row.attempt_count,
    attemptLimit: row.attempt_limit,
    maxAutoAttempts: row.max_auto_attempts,
    retryDeadlineAt: toIso(row.retry_deadline_at),
    leaseExpiresAt: toIso(row.lease_expires_at),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    result: row.result_json === null ? null : parseJson(row.result_json),
    lastError:
      row.last_error_json === null ? null : parseJson(row.last_error_json),
    operatorResolvedAt: toIso(row.operator_resolved_at),
    operatorResolutionNote: row.operator_resolution_note,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function serializeAttempt(value: unknown) {
  const row = z
    .object({
      id: z.string(),
      number: z.number(),
      reason: z.string(),
      status: z.string(),
      started_at: z.number(),
      deadline_at: z.number(),
      finished_at: z.number().nullable(),
      duration_ms: z.number().nullable(),
      result_json: z.string().nullable(),
      error_json: z.string().nullable(),
      target_build_id: z.string().nullable(),
    })
    .parse(value);
  return {
    id: row.id,
    number: row.number,
    reason: row.reason,
    status: row.status,
    startedAt: toIso(row.started_at),
    deadlineAt: toIso(row.deadline_at),
    finishedAt: toIso(row.finished_at),
    durationMs: row.duration_ms,
    result: row.result_json === null ? null : parseJson(row.result_json),
    error: row.error_json === null ? null : parseJson(row.error_json),
    targetBuildId: row.target_build_id,
  };
}

export function parseSnapshotJson(value: string) {
  return parseSnapshot(value);
}

export function parseJson(value: string): JsonValue {
  return jsonValueSchema.parse(JSON.parse(value));
}

function toIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
