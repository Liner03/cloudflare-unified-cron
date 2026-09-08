import { z } from "zod";
import { resolveTargetCapability } from "../../targets.manifest";
import { ApiError } from "../errors";
import {
  parseJson,
  parseSnapshotJson,
  readExecution,
  serializeAttempt,
  serializeExecution,
  serializeExecutionSummary,
} from "../execution-view";
import {
  createCursor,
  parseCursor,
  parseOptionalTime,
  parseOrThrow,
  requireTargetState,
  toIso,
} from "../http-support";
import {
  executeIdempotentMutation,
  parseMutationBody,
  type MutationPlan,
} from "../mutation";
import type { ApiRouter } from "../router";
import { resolveExecutionSchema, riskConfirmationSchema } from "../schemas";

export function registerExecutionRoutes(app: ApiRouter): void {
  app.get("/executions", async (context) => {
    const status = context.req.query("status")?.trim() ?? "";
    const source = context.req.query("source")?.trim() ?? "";
    const scheduleId = context.req.query("scheduleId")?.trim() ?? "";
    const limit = Math.min(
      50,
      Math.max(1, Number(context.req.query("limit") ?? 20)),
    );
    const allowedStatuses = [
      "pending",
      "running",
      "retry_wait",
      "succeeded",
      "failed",
      "unknown",
      "skipped",
      "cancelled",
    ];
    if (
      (status !== "" && !allowedStatuses.includes(status)) ||
      !["", "cron", "manual", "rerun"].includes(source)
    ) {
      throw new ApiError(422, "INVALID_FILTER", "Execution 筛选参数不合法");
    }
    const clauses: string[] = ["1 = 1"];
    const parameters: Array<string | number> = [];
    if (status !== "") {
      clauses.push("e.status = ?");
      parameters.push(status);
    }
    if (source !== "") {
      clauses.push("e.source = ?");
      parameters.push(source);
    }
    if (scheduleId !== "") {
      clauses.push("e.schedule_id = ?");
      parameters.push(scheduleId);
    }
    const from = parseOptionalTime(context.req.query("from"));
    const to = parseOptionalTime(context.req.query("to"));
    if (from !== null) {
      clauses.push("e.created_at >= ?");
      parameters.push(from);
    }
    if (to !== null) {
      clauses.push("e.created_at <= ?");
      parameters.push(to);
    }
    const cursor = parseCursor(context.req.query("cursor"));
    if (cursor) {
      clauses.push("(e.created_at < ? OR (e.created_at = ? AND e.id < ?))");
      parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    parameters.push(limit + 1);
    const result = await context.env.DB.prepare(
      `SELECT e.id, e.schedule_id, e.target_id, e.source, e.status, e.reason_code,
              e.scheduled_for, e.attempt_count, e.created_at, e.finished_at,
              e.available_at, s.name AS schedule_name
       FROM executions e
       LEFT JOIN schedules s ON s.id = e.schedule_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT ?`,
    )
      .bind(...parameters)
      .all();
    const values = result.results.slice(0, limit);
    const last = values.at(-1);
    const nextCursor =
      result.results.length > limit &&
      last &&
      typeof last.created_at === "number" &&
      typeof last.id === "string"
        ? createCursor(last.created_at, last.id)
        : null;
    return context.json({
      data: values.map((value) => ({
        ...serializeExecutionSummary(value),
        scheduleName:
          typeof value.schedule_name === "string"
            ? value.schedule_name
            : "已清理或未知计划",
        availableAt:
          typeof value.available_at === "number"
            ? toIso(value.available_at)
            : null,
      })),
      meta: { nextCursor, serverTime: new Date().toISOString() },
    });
  });

  app.get("/executions/:id", async (context) => {
    const execution = await readExecution(
      context.env.DB,
      context.req.param("id"),
    );
    const attempts = await context.env.DB.prepare(
      `SELECT id, number, reason, status, started_at, deadline_at, finished_at,
                duration_ms, result_json, error_json, target_build_id
         FROM attempts WHERE execution_id = ? ORDER BY number`,
    )
      .bind(execution.id)
      .all();
    return context.json({
      data: {
        ...serializeExecution(execution),
        attempts: attempts.results.map(serializeAttempt),
      },
    });
  });

  app.post("/executions/:id/retry", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    const input = parseOrThrow(riskConfirmationSchema, body.value);
    return executeIdempotentMutation(context, body.raw, async () => {
      const execution = await readExecution(
        context.env.DB,
        context.req.param("id"),
      );
      if (!isRetryableStatus(execution.status)) {
        throw new ApiError(
          409,
          "EXECUTION_NOT_RETRYABLE",
          "只有 failed 或 unknown 执行可人工重试",
        );
      }
      const snapshot = parseSnapshotJson(execution.snapshot_json);
      const capability = resolveTargetCapability(
        execution.target_id,
        snapshot.action,
        snapshot.actionVersion,
      );
      if (!capability) {
        throw new ApiError(
          409,
          "TARGET_CAPABILITY_REMOVED",
          "目标 Action 或版本已移除",
        );
      }
      if (!snapshot.targetActionIdempotent || !capability.action.idempotent) {
        throw new ApiError(
          409,
          "EXECUTION_RETRY_REQUIRES_IDEMPOTENCY",
          "Retry 仅允许快照和当前 Target 都声明幂等的执行；请核实结果后使用 Run again",
        );
      }
      await requireTargetState(context.env.DB, execution.target_id, true);
      if (Date.now() - execution.created_at > 7 * 24 * 60 * 60 * 1000) {
        throw new ApiError(
          409,
          "OPERATOR_RETRY_WINDOW_EXPIRED",
          "人工重试的 7 天窗口已结束",
        );
      }
      if (execution.attempt_limit >= 10) {
        throw new ApiError(
          409,
          "ATTEMPT_HARD_LIMIT",
          "Attempt 总数已达到 10 次上限",
        );
      }
      if (execution.status === "unknown" && !input.confirmRisk) {
        throw new ApiError(
          422,
          "RISK_CONFIRMATION_REQUIRED",
          "必须确认原业务可能已经执行的风险",
        );
      }
      const now = Date.now();
      return {
        statement: context.env.DB.prepare(
          `UPDATE executions
             SET status = 'retry_wait', available_at = ?, next_attempt_reason = 'operator_retry',
                 attempt_limit = attempt_limit + 1, finished_at = NULL,
                 operator_resolved_at = NULL, operator_resolution_note = NULL, updated_at = ?
             WHERE id = ? AND status = ? AND attempt_limit < 10
               AND created_at >= ?
               AND NOT EXISTS (
                 SELECT 1 FROM executions active
                 WHERE active.schedule_id = executions.schedule_id AND active.id <> executions.id
                   AND active.status IN ('pending', 'running', 'retry_wait', 'unknown')
               )`,
        ).bind(
          now,
          now,
          execution.id,
          execution.status,
          now - 7 * 24 * 60 * 60 * 1000,
        ),
        response: {
          data: {
            executionId: execution.id,
            status: "retry_wait",
            availableAt: new Date(now).toISOString(),
          },
        },
        status: 202,
        action: "execution.operator_retry_requested",
        entityType: "execution",
        entityId: execution.id,
        changes: { confirmRisk: input.confirmRisk, sameIdempotencyKey: true },
        conflictCode: "EXECUTION_RETRY_CONFLICT",
        conflictMessage: "执行状态、次数或计划执行槽已经变化",
      } satisfies MutationPlan;
    });
  });

  app.post("/executions/:id/rerun", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    const input = parseOrThrow(riskConfirmationSchema, body.value);
    if (!input.confirmRisk) {
      throw new ApiError(
        422,
        "RISK_CONFIRMATION_REQUIRED",
        "新建运行会使用新的幂等键，必须确认风险",
      );
    }
    return executeIdempotentMutation(context, body.raw, async () => {
      const parent = await readExecution(
        context.env.DB,
        context.req.param("id"),
      );
      if (!isRerunnableStatus(parent.status)) {
        throw new ApiError(
          409,
          "EXECUTION_NOT_RERUNNABLE",
          "活跃或 unknown 执行不能直接 Run again",
        );
      }
      const snapshot = parseSnapshotJson(parent.snapshot_json);
      const capability = resolveTargetCapability(
        parent.target_id,
        snapshot.action,
        snapshot.actionVersion,
      );
      if (!capability) {
        throw new ApiError(
          409,
          "TARGET_CAPABILITY_REMOVED",
          "目标 Action 或版本已移除",
        );
      }
      await requireTargetState(context.env.DB, parent.target_id, true);
      const executionId = crypto.randomUUID();
      const now = Date.now();
      return {
        statement: context.env.DB.prepare(
          `INSERT INTO executions (
               id, schedule_id, target_id, source, scheduled_for, parent_execution_id,
               dedupe_key, schedule_revision, snapshot_json, status, available_at,
               next_attempt_reason, attempt_limit, max_auto_attempts,
               retry_deadline_at, created_at, updated_at
             )
             SELECT ?, schedule_id, target_id, 'rerun', NULL, id, ?, schedule_revision,
                    snapshot_json, 'pending', ?, 'initial', ?, ?, ?, ?, ?
             FROM executions
             WHERE id = ? AND status IN ('succeeded', 'failed', 'skipped', 'cancelled')
               AND EXISTS (SELECT 1 FROM schedules s WHERE s.id = executions.schedule_id AND s.archived_at IS NULL)
               AND NOT EXISTS (
                 SELECT 1 FROM executions active
                 WHERE active.schedule_id = executions.schedule_id
                   AND active.status IN ('pending', 'running', 'retry_wait', 'unknown')
               )`,
        ).bind(
          executionId,
          `rerun:${executionId}`,
          now,
          snapshot.retryPolicy.maxAttempts,
          snapshot.retryPolicy.maxAttempts,
          now + 24 * 60 * 60 * 1000,
          now,
          now,
          parent.id,
        ),
        response: {
          data: {
            executionId,
            parentExecutionId: parent.id,
            status: "pending",
          },
        },
        status: 202,
        action: "execution.rerun_requested",
        entityType: "execution",
        entityId: executionId,
        changes: { parentExecutionId: parent.id, newIdempotencyKey: true },
        conflictCode: "SCHEDULE_BUSY",
        conflictMessage: "计划已有活跃执行或已归档，不能新建运行",
      } satisfies MutationPlan;
    });
  });

  app.post("/executions/:id/cancel", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    parseOrThrow(z.object({}), body.value);
    return executeIdempotentMutation(context, body.raw, async () => {
      const execution = await readExecution(
        context.env.DB,
        context.req.param("id"),
      );
      const now = Date.now();
      return {
        statement: context.env.DB.prepare(
          `UPDATE executions
             SET status = 'cancelled', reason_code = 'OPERATOR_CANCELLED',
                 finished_at = ?, available_at = ?, updated_at = ?
             WHERE id = ? AND status IN ('pending', 'retry_wait')`,
        ).bind(now, now, now, execution.id),
        response: { data: { executionId: execution.id, status: "cancelled" } },
        status: 200,
        action: "execution.cancelled",
        entityType: "execution",
        entityId: execution.id,
        changes: { previousStatus: execution.status },
        conflictCode: "EXECUTION_NOT_CANCELLABLE",
        conflictMessage: "只有 pending 或 retry_wait 执行可以取消",
      } satisfies MutationPlan;
    });
  });

  app.post("/executions/:id/resolve", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    const input = parseOrThrow(resolveExecutionSchema, body.value);
    return executeIdempotentMutation(context, body.raw, async () => {
      const execution = await readExecution(
        context.env.DB,
        context.req.param("id"),
      );
      const nextStatus =
        input.resolution === "confirmed_succeeded"
          ? "succeeded"
          : input.resolution === "confirmed_failed"
            ? "failed"
            : "cancelled";
      const now = Date.now();
      const resultJson =
        nextStatus === "succeeded"
          ? JSON.stringify({
              operatorResolution: input.resolution,
              note: input.note,
            })
          : null;
      return {
        statement: context.env.DB.prepare(
          `UPDATE executions
             SET status = ?, reason_code = 'OPERATOR_RESOLVED_UNKNOWN',
                 finished_at = ?, available_at = ?, result_json = ?,
                 operator_resolved_at = ?, operator_resolution_note = ?, updated_at = ?
             WHERE id = ? AND status = 'unknown'`,
        ).bind(
          nextStatus,
          now,
          now,
          resultJson,
          now,
          input.note,
          now,
          execution.id,
        ),
        response: {
          data: {
            executionId: execution.id,
            status: nextStatus,
            resolution: input.resolution,
          },
        },
        status: 200,
        action: "execution.unknown_resolved",
        entityType: "execution",
        entityId: execution.id,
        changes: { resolution: input.resolution, note: input.note },
        conflictCode: "EXECUTION_NOT_UNKNOWN",
        conflictMessage: "只有 unknown 执行可以人工核实",
      } satisfies MutationPlan;
    });
  });

  app.get("/audit-events", async (context) => {
    const limit = Math.min(
      50,
      Math.max(1, Number(context.req.query("limit") ?? 20)),
    );
    const cursor = parseCursor(context.req.query("cursor"));
    const result = cursor
      ? await context.env.DB.prepare(
          `SELECT id, actor, action, entity_type, entity_id, changes_json, created_at
             FROM audit_events
             WHERE created_at < ? OR (created_at = ? AND id < ?)
             ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
          .bind(cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
          .all()
      : await context.env.DB.prepare(
          `SELECT id, actor, action, entity_type, entity_id, changes_json, created_at
             FROM audit_events ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
          .bind(limit + 1)
          .all();
    const values = result.results.slice(0, limit);
    const last = values.at(-1);
    const nextCursor =
      result.results.length > limit &&
      last &&
      typeof last.created_at === "number" &&
      typeof last.id === "string"
        ? createCursor(last.created_at, last.id)
        : null;
    return context.json({
      data: values.map((value) => ({
        ...value,
        changes:
          typeof value.changes_json === "string"
            ? parseJson(value.changes_json)
            : null,
        changes_json: undefined,
        createdAt:
          typeof value.created_at === "number" ? toIso(value.created_at) : null,
        created_at: undefined,
      })),
      meta: { nextCursor },
    });
  });
}

function isRetryableStatus(status: string): status is "failed" | "unknown" {
  return status === "failed" || status === "unknown";
}

function isRerunnableStatus(status: string): boolean {
  return ["succeeded", "failed", "skipped", "cancelled"].includes(status);
}
