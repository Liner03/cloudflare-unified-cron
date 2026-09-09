import { jsonValueSchema, retryPolicySchema } from "@unified-cron/contracts";
import { z } from "zod";
import {
  canAutomaticallyRetry,
  retryDelayMs,
  type DispatchReason,
  type ScheduleSnapshot,
} from "../../domain/model";
import { CronCalculator } from "../cron/cron-calculator";
import { RegisteredTargetCatalog } from "./registered-target-catalog";

const AUTOMATIC_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 90_000;

const dueScheduleSchema = z.object({
  id: z.string(),
  revision: z.number(),
  next_run_at: z.number(),
  cron_expression: z.string(),
  timezone: z.string(),
  target_id: z.string(),
  action: z.string(),
  action_version: z.number(),
  payload_json: z.string(),
  retry_policy_json: z.string(),
  timeout_ms: z.number(),
  misfire_policy: z.enum(["coalesce", "skip"]),
  misfire_grace_seconds: z.number(),
});

type DueScheduleRow = z.infer<typeof dueScheduleSchema>;

const readyExecutionSchema = z.object({
  id: z.string(),
  schedule_id: z.string(),
  target_id: z.string(),
  source: z.enum(["cron", "manual", "rerun"]),
  scheduled_for: z.number().nullable(),
  snapshot_json: z.string(),
  attempt_count: z.number(),
  next_attempt_reason: z.enum(["initial", "automatic_retry", "operator_retry"]),
  retry_deadline_at: z.number(),
  available_at: z.number(),
  created_at: z.number(),
});

export type ReadyExecution = z.infer<typeof readyExecutionSchema>;

const claimedExecutionSchema = readyExecutionSchema
  .omit({ available_at: true, created_at: true })
  .extend({
    lease_token: z.string(),
    attempt_id: z.string(),
    deadline_at: z.number(),
  });

export type ClaimedExecution = z.infer<typeof claimedExecutionSchema>;

const expiredLeaseSchema = z.object({
  id: z.string(),
  target_id: z.string(),
  snapshot_json: z.string(),
  attempt_count: z.number(),
  retry_deadline_at: z.number(),
  lease_token: z.string(),
  attempt_id: z.string(),
});

export interface TickState {
  dispatchPaused: boolean;
}

export interface FinalizeDecision {
  executionStatus: "succeeded" | "failed" | "retry_wait" | "unknown";
  attemptStatus: "succeeded" | "failed" | "unknown";
  availableAt: number;
  nextAttemptReason: DispatchReason;
  resultJson: string | null;
  errorJson: string | null;
  targetBuildId: string | null;
}

export class ExecutionRepository {
  constructor(
    private readonly db: D1Database,
    private readonly cron: CronCalculator,
    private readonly targets = new RegisteredTargetCatalog(db),
  ) {}

  async beginTick(input: {
    tickId: string;
    scheduledAt: number;
    startedAt: number;
    buildVersion: string;
  }): Promise<TickState> {
    const row = await this.db
      .prepare(
        `UPDATE platform_state
         SET last_tick_id = ?, last_tick_scheduled_at = ?, last_tick_started_at = ?,
             last_tick_outcome = 'running', last_tick_error = NULL,
             build_version = ?, updated_at = ?
         WHERE id = 1
         RETURNING dispatch_paused`,
      )
      .bind(
        input.tickId,
        input.scheduledAt,
        input.startedAt,
        input.buildVersion,
        input.startedAt,
      )
      .first<{ dispatch_paused: number }>();
    if (!row) throw new Error("PLATFORM_STATE_MISSING");
    return { dispatchPaused: row.dispatch_paused === 1 };
  }

  async finishTick(input: {
    tickId: string;
    finishedAt: number;
    outcome: "succeeded" | "degraded" | "failed" | "paused";
    error: string | null;
  }): Promise<void> {
    await this.db
      .prepare(
        `UPDATE platform_state
         SET last_tick_finished_at = ?,
             last_successful_tick_at = CASE WHEN ? IN ('succeeded', 'paused') THEN ? ELSE last_successful_tick_at END,
             last_tick_outcome = ?, last_tick_error = ?, updated_at = ?
         WHERE id = 1 AND last_tick_id = ?`,
      )
      .bind(
        input.finishedAt,
        input.outcome,
        input.finishedAt,
        input.outcome,
        input.error,
        input.finishedAt,
        input.tickId,
      )
      .run();
  }

  async expireAutomaticRetryWindows(nowMs: number): Promise<number> {
    const result = await this.db
      .prepare(
        `UPDATE executions
         SET status = 'failed', reason_code = 'AUTOMATIC_RETRY_WINDOW_EXPIRED',
             finished_at = ?, available_at = ?, next_attempt_reason = 'initial',
             last_error_json = ?, updated_at = ?
         WHERE status = 'retry_wait'
           AND next_attempt_reason = 'automatic_retry'
           AND retry_deadline_at <= ?`,
      )
      .bind(
        nowMs,
        nowMs,
        JSON.stringify({
          code: "AUTOMATIC_RETRY_WINDOW_EXPIRED",
          message: "自动重试的 24 小时窗口已结束",
        }),
        nowMs,
        nowMs,
      )
      .run();
    return result.meta.changes;
  }

  async listDue(nowMs: number, limit: number): Promise<DueScheduleRow[]> {
    const result = await this.db
      .prepare(
        `SELECT s.id, s.revision, s.next_run_at, s.cron_expression, s.timezone,
                s.target_id, s.action, s.action_version, s.payload_json,
                s.retry_policy_json, s.timeout_ms, s.misfire_policy,
                s.misfire_grace_seconds
         FROM schedules s
         JOIN targets t ON t.id = s.target_id AND t.enabled = 1
         WHERE s.enabled = 1 AND s.managed_by_registration = 1
           AND s.retired_at IS NULL AND s.archived_at IS NULL
           AND s.next_run_at <= ?
         ORDER BY s.next_run_at, s.id
         LIMIT ?`,
      )
      .bind(nowMs, limit)
      .all();
    return z.array(dueScheduleSchema).parse(result.results);
  }

  async materializeDue(row: DueScheduleRow, nowMs: number): Promise<boolean> {
    const capability = await this.targets.findCapability(
      row.target_id,
      row.action,
      row.action_version,
    );
    if (!capability) {
      await this.disableInvalidSchedule(
        row,
        nowMs,
        "TARGET_ACTION_NOT_DECLARED",
      );
      return false;
    }
    const { target, action } = capability;
    const retryPolicy = retryPolicySchema.parse(
      JSON.parse(row.retry_policy_json),
    );
    const payload = jsonValueSchema.parse(JSON.parse(row.payload_json));
    const snapshot: ScheduleSnapshot = {
      scheduleId: row.id,
      scheduleRevision: row.revision,
      targetId: row.target_id,
      action: row.action,
      actionVersion: row.action_version,
      targetManifestRevision: target.manifestRevision,
      targetActionIdempotent: action.idempotent,
      payload,
      retryPolicy,
      timeoutMs: row.timeout_ms,
      cronExpression: row.cron_expression,
      timezone: row.timezone,
    };
    const nextRunAt = this.cron.nextAfter(
      row.cron_expression,
      row.timezone,
      nowMs,
    );
    const executionId = crypto.randomUUID();
    const dedupeKey = `cron:${row.id}:${row.next_run_at}`;
    const isMisfire =
      row.misfire_policy === "skip" &&
      nowMs - row.next_run_at > row.misfire_grace_seconds * 1000;

    const statements = [
      this.db
        .prepare(
          `INSERT INTO executions (
             id, schedule_id, target_id, source, scheduled_for, dedupe_key,
             schedule_revision, snapshot_json, status, reason_code, coalesced_until,
             available_at, next_attempt_reason, attempt_limit, max_auto_attempts,
             retry_deadline_at, finished_at, created_at, updated_at
           )
           SELECT ?, s.id, s.target_id, 'cron', s.next_run_at, ?, s.revision, ?,
             CASE
               WHEN t.enabled = 0 THEN 'skipped'
               WHEN ? = 1 THEN 'skipped'
               WHEN EXISTS (
                 SELECT 1 FROM executions active
                 WHERE active.schedule_id = s.id
                   AND active.status IN ('pending', 'running', 'retry_wait', 'unknown')
               ) THEN 'skipped'
               ELSE 'pending'
             END,
             CASE
               WHEN t.enabled = 0 THEN 'TARGET_DISABLED'
               WHEN ? = 1 THEN 'MISFIRE'
               WHEN EXISTS (
                 SELECT 1 FROM executions active
                 WHERE active.schedule_id = s.id
                   AND active.status IN ('pending', 'running', 'retry_wait', 'unknown')
               ) THEN 'OVERLAP'
               ELSE NULL
             END,
             CASE WHEN s.misfire_policy = 'coalesce' AND s.next_run_at < ? THEN ? ELSE NULL END,
             ?, 'initial', ?, ?, ?,
             CASE
               WHEN t.enabled = 0 OR ? = 1 THEN ?
               WHEN EXISTS (
                 SELECT 1 FROM executions active
                 WHERE active.schedule_id = s.id
                   AND active.status IN ('pending', 'running', 'retry_wait', 'unknown')
               ) THEN ?
               ELSE NULL
             END,
             ?, ?
           FROM schedules s
           JOIN targets t ON t.id = s.target_id
           WHERE s.id = ? AND s.revision = ? AND s.next_run_at = ?
             AND s.enabled = 1 AND s.archived_at IS NULL
             AND EXISTS (SELECT 1 FROM platform_state p WHERE p.id = 1 AND p.dispatch_paused = 0)
           ON CONFLICT(dedupe_key) DO NOTHING
           RETURNING id, status, reason_code`,
        )
        .bind(
          executionId,
          dedupeKey,
          JSON.stringify(snapshot),
          isMisfire ? 1 : 0,
          isMisfire ? 1 : 0,
          nowMs,
          nowMs,
          nowMs,
          retryPolicy.maxAttempts,
          retryPolicy.maxAttempts,
          nowMs + AUTOMATIC_RETRY_WINDOW_MS,
          isMisfire ? 1 : 0,
          nowMs,
          nowMs,
          nowMs,
          nowMs,
          row.id,
          row.revision,
          row.next_run_at,
        ),
      this.db
        .prepare(
          `UPDATE schedules
           SET next_run_at = ?, last_materialized_for = ?, updated_at = ?
           WHERE id = ? AND revision = ? AND next_run_at = ? AND enabled = 1
             AND EXISTS (
               SELECT 1 FROM executions e
               WHERE e.id = ? AND e.dedupe_key = ? AND e.scheduled_for = ?
             )`,
        )
        .bind(
          nextRunAt,
          row.next_run_at,
          nowMs,
          row.id,
          row.revision,
          row.next_run_at,
          executionId,
          dedupeKey,
          row.next_run_at,
        ),
    ];
    const result = await this.db.batch(statements);
    return result[0]?.results.length === 1 && result[1]?.meta.changes === 1;
  }

  async listReady(nowMs: number, limit: number): Promise<ReadyExecution[]> {
    const result = await this.db
      .prepare(
        `SELECT e.id, e.schedule_id, e.target_id, e.source, e.scheduled_for,
                e.snapshot_json, e.attempt_count, e.next_attempt_reason,
                e.retry_deadline_at, e.available_at, e.created_at
         FROM executions e
         JOIN targets t ON t.id = e.target_id AND t.enabled = 1
         JOIN platform_state p ON p.id = 1 AND p.dispatch_paused = 0
         WHERE e.status IN ('pending', 'retry_wait') AND e.available_at <= ?
           AND e.attempt_count < e.attempt_limit
         ORDER BY e.available_at, e.created_at, e.id
         LIMIT ?`,
      )
      .bind(nowMs, limit)
      .all();
    return z.array(readyExecutionSchema).parse(result.results);
  }

  async claim(
    row: ReadyExecution,
    nowMs: number,
  ): Promise<ClaimedExecution | null> {
    const snapshot = parseSnapshot(row.snapshot_json);
    const leaseToken = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const deadlineAt = nowMs + snapshot.timeoutMs;
    const result = await this.db.batch([
      this.db
        .prepare(
          `UPDATE executions
           SET status = 'running', attempt_count = attempt_count + 1,
               lease_token = ?, lease_expires_at = ?,
               started_at = COALESCE(started_at, ?), updated_at = ?
           WHERE id = ?
             AND status IN ('pending', 'retry_wait')
             AND available_at <= ? AND attempt_count < attempt_limit
             AND EXISTS (SELECT 1 FROM targets t WHERE t.id = executions.target_id AND t.enabled = 1)
             AND EXISTS (SELECT 1 FROM platform_state p WHERE p.id = 1 AND p.dispatch_paused = 0)
           RETURNING id, schedule_id, target_id, source, scheduled_for,
                     snapshot_json, attempt_count, next_attempt_reason,
                     retry_deadline_at, lease_token`,
        )
        .bind(leaseToken, nowMs + LEASE_MS, nowMs, nowMs, row.id, nowMs),
      this.db
        .prepare(
          `INSERT INTO attempts (
             id, execution_id, number, reason, status, lease_token, started_at, deadline_at
           )
           SELECT ?, id, attempt_count, next_attempt_reason, 'running', lease_token, ?, ?
           FROM executions
           WHERE id = ? AND status = 'running' AND lease_token = ?
           RETURNING id`,
        )
        .bind(attemptId, nowMs, deadlineAt, row.id, leaseToken),
    ]);
    const claimed = result[0]?.results[0];
    if (!claimed || result[1]?.results.length !== 1) return null;
    return claimedExecutionSchema.parse({
      ...claimed,
      attempt_id: attemptId,
      deadline_at: deadlineAt,
    });
  }

  async finalize(
    claim: ClaimedExecution,
    decision: FinalizeDecision,
    finishedAt: number,
  ): Promise<boolean> {
    const attemptPayload =
      decision.attemptStatus === "succeeded"
        ? decision.resultJson
        : decision.errorJson;
    const result = await this.db.batch([
      this.db
        .prepare(
          `UPDATE attempts
           SET status = ?, finished_at = ?, duration_ms = MAX(0, ? - started_at),
               result_json = CASE WHEN ? = 'succeeded' THEN ? ELSE NULL END,
               error_json = CASE WHEN ? <> 'succeeded' THEN ? ELSE NULL END,
               target_build_id = ?
           WHERE id = ? AND execution_id = ? AND lease_token = ? AND status = 'running'
           RETURNING id`,
        )
        .bind(
          decision.attemptStatus,
          finishedAt,
          finishedAt,
          decision.attemptStatus,
          attemptPayload,
          decision.attemptStatus,
          attemptPayload,
          decision.targetBuildId,
          claim.attempt_id,
          claim.id,
          claim.lease_token,
        ),
      this.db
        .prepare(
          `UPDATE executions
           SET status = ?, reason_code = ?, available_at = ?, next_attempt_reason = ?,
               lease_token = NULL, lease_expires_at = NULL,
               finished_at = CASE WHEN ? IN ('succeeded', 'failed') THEN ? ELSE NULL END,
               result_json = CASE WHEN ? = 'succeeded' THEN ? ELSE NULL END,
               last_error_json = CASE WHEN ? <> 'succeeded' THEN ? ELSE NULL END,
               updated_at = ?
           WHERE id = ? AND status = 'running' AND lease_token = ?
             AND EXISTS (
               SELECT 1 FROM attempts a
               WHERE a.id = ? AND a.execution_id = executions.id
                 AND a.lease_token = ? AND a.status = ? AND a.finished_at = ?
             )
           RETURNING id`,
        )
        .bind(
          decision.executionStatus,
          decision.executionStatus === "retry_wait"
            ? "AUTOMATIC_RETRY_SCHEDULED"
            : null,
          decision.availableAt,
          decision.nextAttemptReason,
          decision.executionStatus,
          finishedAt,
          decision.executionStatus,
          decision.resultJson,
          decision.executionStatus,
          decision.errorJson,
          finishedAt,
          claim.id,
          claim.lease_token,
          claim.attempt_id,
          claim.lease_token,
          decision.attemptStatus,
          finishedAt,
        ),
    ]);
    return result[0]?.results.length === 1 && result[1]?.results.length === 1;
  }

  async recoverExpiredLeases(nowMs: number, limit: number): Promise<number> {
    const rows = await this.db
      .prepare(
        `SELECT e.id, e.target_id, e.snapshot_json, e.attempt_count,
                e.retry_deadline_at, e.lease_token,
                a.id AS attempt_id
         FROM executions e
         JOIN attempts a ON a.execution_id = e.id AND a.lease_token = e.lease_token
         WHERE e.status = 'running' AND e.lease_expires_at <= ? AND a.status = 'running'
         ORDER BY e.lease_expires_at, e.id
         LIMIT ?`,
      )
      .bind(nowMs, limit)
      .all();
    let recovered = 0;
    for (const value of z.array(expiredLeaseSchema).parse(rows.results)) {
      const snapshot = parseSnapshot(value.snapshot_json);
      const current = await this.targets.findCapability(
        value.target_id,
        snapshot.action,
        snapshot.actionVersion,
      );
      const retry = canAutomaticallyRetry({
        policy: snapshot.retryPolicy,
        snapshotIdempotent: snapshot.targetActionIdempotent,
        currentIdempotent: current?.action.idempotent === true,
        completedAttemptNumber: value.attempt_count,
        retryable: false,
        outcomeUnknown: true,
        nowMs,
        retryDeadlineAt: value.retry_deadline_at,
      });
      const delay = retry
        ? retryDelayMs(snapshot.retryPolicy, value.attempt_count)
        : null;
      const claim = claimedExecutionSchema.parse({
        id: value.id,
        schedule_id: snapshot.scheduleId,
        target_id: value.target_id,
        source: "cron",
        scheduled_for: null,
        snapshot_json: value.snapshot_json,
        attempt_count: value.attempt_count,
        next_attempt_reason: "initial",
        retry_deadline_at: value.retry_deadline_at,
        lease_token: value.lease_token,
        attempt_id: value.attempt_id,
        deadline_at: nowMs,
      });
      const errorJson = JSON.stringify({
        code: "LEASE_EXPIRED_RESULT_UNKNOWN",
        message: "平台租约过期，无法确认目标最终结果",
      });
      const finalized = await this.finalize(
        claim,
        {
          executionStatus: delay === null ? "unknown" : "retry_wait",
          attemptStatus: "unknown",
          availableAt: delay === null ? nowMs : nowMs + delay,
          nextAttemptReason: delay === null ? "initial" : "automatic_retry",
          resultJson: null,
          errorJson,
          targetBuildId: null,
        },
        nowMs,
      );
      if (finalized) recovered += 1;
    }
    return recovered;
  }

  async cleanupHistory(
    nowMs: number,
  ): Promise<{ executions: number; audit: number; idempotency: number }> {
    const successCutoff = nowMs - 14 * 24 * 60 * 60 * 1000;
    const failureCutoff = nowMs - 30 * 24 * 60 * 60 * 1000;
    const auditCutoff = nowMs - 90 * 24 * 60 * 60 * 1000;
    const results = await this.db.batch([
      this.db
        .prepare(
          `DELETE FROM executions
           WHERE id IN (
             SELECT id FROM executions
             WHERE (
               status IN ('succeeded', 'skipped', 'cancelled')
               AND COALESCE(finished_at, created_at) < ?
             )
                OR (status = 'failed' AND finished_at < ?)
             ORDER BY finished_at, id LIMIT 50
           )`,
        )
        .bind(successCutoff, failureCutoff),
      this.db
        .prepare(
          `DELETE FROM audit_events WHERE id IN (
             SELECT id FROM audit_events WHERE created_at < ? ORDER BY created_at, id LIMIT 50
           )`,
        )
        .bind(auditCutoff),
      this.db
        .prepare(
          `DELETE FROM api_idempotency WHERE (scope, key) IN (
             SELECT scope, key FROM api_idempotency WHERE expires_at <= ? ORDER BY expires_at LIMIT 100
           )`,
        )
        .bind(nowMs),
      this.db
        .prepare(
          `DELETE FROM admin_sessions WHERE token_hash IN (
             SELECT token_hash FROM admin_sessions
             WHERE expires_at <= ? ORDER BY expires_at LIMIT 100
           )`,
        )
        .bind(nowMs),
      this.db
        .prepare(
          `DELETE FROM admin_login_limits WHERE key_hash IN (
             SELECT key_hash FROM admin_login_limits
             WHERE window_started_at <= ?
               AND (blocked_until IS NULL OR blocked_until <= ?)
             ORDER BY window_started_at LIMIT 100
           )`,
        )
        .bind(nowMs - 24 * 60 * 60 * 1000, nowMs),
    ]);
    return {
      executions: results[0]?.meta.changes ?? 0,
      audit: results[1]?.meta.changes ?? 0,
      idempotency: results[2]?.meta.changes ?? 0,
    };
  }

  private async disableInvalidSchedule(
    row: DueScheduleRow,
    nowMs: number,
    reason: string,
  ): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO audit_events (id, actor, action, entity_type, entity_id, changes_json, created_at)
           SELECT ?, 'system', 'schedule.disabled_invalid_configuration', 'schedule', id, ?, ?
           FROM schedules
           WHERE id = ? AND revision = ? AND next_run_at = ? AND enabled = 1`,
        )
        .bind(
          crypto.randomUUID(),
          JSON.stringify({ reason }),
          nowMs,
          row.id,
          row.revision,
          row.next_run_at,
        ),
      this.db
        .prepare(
          `UPDATE schedules SET enabled = 0, next_run_at = NULL, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND next_run_at = ? AND enabled = 1`,
        )
        .bind(nowMs, row.id, row.revision, row.next_run_at),
    ]);
  }
}

export function parseSnapshot(value: string): ScheduleSnapshot {
  const schema = z.object({
    scheduleId: z.string(),
    scheduleRevision: z.number().int().min(1),
    targetId: z.string(),
    action: z.string(),
    actionVersion: z.number().int().min(1),
    targetManifestRevision: z.string(),
    targetActionIdempotent: z.boolean(),
    payload: jsonValueSchema,
    retryPolicy: retryPolicySchema,
    timeoutMs: z.number().int().min(1000).max(30_000),
    cronExpression: z.string(),
    timezone: z.string(),
  });
  return schema.parse(JSON.parse(value));
}

export function makeFailureDecision(input: {
  snapshot: ScheduleSnapshot;
  attemptNumber: number;
  nowMs: number;
  retryDeadlineAt: number;
  currentIdempotent: boolean;
  retryable: boolean;
  unknown: boolean;
  errorJson: string;
}): FinalizeDecision {
  const canRetry = canAutomaticallyRetry({
    policy: input.snapshot.retryPolicy,
    snapshotIdempotent: input.snapshot.targetActionIdempotent,
    currentIdempotent: input.currentIdempotent,
    completedAttemptNumber: input.attemptNumber,
    retryable: input.retryable,
    outcomeUnknown: input.unknown,
    nowMs: input.nowMs,
    retryDeadlineAt: input.retryDeadlineAt,
  });
  const delay = canRetry
    ? retryDelayMs(input.snapshot.retryPolicy, input.attemptNumber)
    : null;
  return {
    executionStatus:
      delay === null ? (input.unknown ? "unknown" : "failed") : "retry_wait",
    attemptStatus: input.unknown ? "unknown" : "failed",
    availableAt: delay === null ? input.nowMs : input.nowMs + delay,
    nextAttemptReason: delay === null ? "initial" : "automatic_retry",
    resultJson: null,
    errorJson: input.errorJson,
    targetBuildId: null,
  };
}
