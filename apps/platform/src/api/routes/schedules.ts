import { z } from "zod";
import { CronCalculator } from "../../infrastructure/cron/cron-calculator";
import { ApiError } from "../errors";
import { serializeExecutionSummary } from "../execution-view";
import {
  escapeLike,
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
import {
  buildScheduleSnapshot,
  readSchedule,
  requireRevision,
  scheduleRowToInput,
  serializeSchedule,
  validateScheduleInput,
} from "../schedule-service";
import {
  cronPreviewSchema,
  scheduleInputSchema,
  schedulePatchSchema,
} from "../schemas";

const MAX_SCHEDULES = 50;

export function registerScheduleRoutes(app: ApiRouter): void {
  app.get("/schedules", async (context) => {
    const search = context.req.query("search")?.trim() ?? "";
    const target = context.req.query("target")?.trim() ?? "";
    const enabled = context.req.query("enabled")?.trim() ?? "";
    if (
      search.length > 100 ||
      target.length > 128 ||
      !["", "true", "false"].includes(enabled)
    ) {
      throw new ApiError(422, "INVALID_FILTER", "Schedule 筛选参数不合法");
    }
    const result = await context.env.DB.prepare(
      `SELECT s.id, s.name, s.description, s.target_id, s.action, s.action_version,
              s.cron_expression, s.timezone, s.enabled, s.archived_at, s.revision,
              s.payload_json, s.retry_policy_json, s.timeout_ms, s.misfire_policy,
              s.misfire_grace_seconds, s.next_run_at, s.created_at, s.updated_at,
              (SELECT e.status FROM executions e WHERE e.schedule_id = s.id
               ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS last_status,
              (SELECT e.created_at FROM executions e WHERE e.schedule_id = s.id
               ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS last_execution_at
       FROM schedules s
       WHERE s.archived_at IS NULL
         AND (? = '' OR s.name LIKE '%' || ? || '%' ESCAPE '\\')
         AND (? = '' OR s.target_id = ?)
         AND (? = '' OR s.enabled = CASE ? WHEN 'true' THEN 1 ELSE 0 END)
       ORDER BY s.name, s.id
       LIMIT 50`,
    )
      .bind(search, escapeLike(search), target, target, enabled, enabled)
      .all();
    return context.json({ data: result.results.map(serializeScheduleListRow) });
  });

  app.post("/schedules", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    const input = parseOrThrow(scheduleInputSchema, body.value);
    return executeIdempotentMutation(context, body.raw, async () => {
      const count = await context.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM schedules WHERE archived_at IS NULL",
      ).first<{ count: number }>();
      if ((count?.count ?? 0) >= MAX_SCHEDULES) {
        throw new ApiError(
          429,
          "SCHEDULE_LIMIT_REACHED",
          `V1 最多管理 ${MAX_SCHEDULES} 个未归档计划`,
        );
      }
      const now = Date.now();
      const validated = validateScheduleInput(input, new CronCalculator(), now);
      await requireTargetState(context.env.DB, input.targetId, input.enabled);
      const id = crypto.randomUUID();
      return {
        statement: context.env.DB.prepare(
          `INSERT INTO schedules (
               id, name, description, target_id, action, action_version,
               cron_expression, timezone, enabled, revision, payload_json,
               retry_policy_json, timeout_ms, misfire_policy, misfire_grace_seconds,
               next_run_at, created_at, updated_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE (
               SELECT COUNT(*) FROM schedules WHERE archived_at IS NULL
             ) < ?`,
        ).bind(
          id,
          input.name,
          input.description,
          input.targetId,
          input.action,
          input.actionVersion,
          input.cronExpression,
          input.timezone,
          input.enabled ? 1 : 0,
          JSON.stringify(input.payload),
          JSON.stringify(input.retryPolicy),
          input.timeoutMs,
          input.misfirePolicy,
          input.misfireGraceSeconds,
          input.enabled ? validated.nextRunAt : null,
          now,
          now,
          MAX_SCHEDULES,
        ),
        response: { data: { id, revision: 1 } },
        status: 200,
        action: "schedule.created",
        entityType: "schedule",
        entityId: id,
        changes: {
          targetId: input.targetId,
          action: input.action,
          enabled: input.enabled,
        },
        conflictCode: "SCHEDULE_LIMIT_REACHED",
        conflictMessage: `V1 最多管理 ${MAX_SCHEDULES} 个未归档计划`,
        conflictStatus: 429,
      } satisfies MutationPlan;
    });
  });

  app.get("/schedules/:id", async (context) => {
    const row = await readSchedule(context.env.DB, context.req.param("id"));
    const recent = await context.env.DB.prepare(
      `SELECT id, schedule_id, target_id, source, status, reason_code,
                scheduled_for, attempt_count, created_at, finished_at
         FROM executions WHERE schedule_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 10`,
    )
      .bind(row.id)
      .all();
    return context.json({
      data: {
        ...serializeSchedule(row),
        recentExecutions: recent.results.map(serializeExecutionSummary),
      },
    });
  });

  app.patch("/schedules/:id", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    const patch = parseOrThrow(schedulePatchSchema, body.value);
    const expectedRevision = requireRevision(context.req.header("If-Match"));
    return executeIdempotentMutation(context, body.raw, async () => {
      const row = await readSchedule(context.env.DB, context.req.param("id"));
      if (row.archived_at !== null) {
        throw new ApiError(409, "SCHEDULE_ARCHIVED", "已归档计划不能编辑");
      }
      const merged = scheduleInputSchema.parse({
        ...scheduleRowToInput(row),
        ...patch,
      });
      const now = Date.now();
      const validated = validateScheduleInput(
        merged,
        new CronCalculator(),
        now,
      );
      await requireTargetState(
        context.env.DB,
        merged.targetId,
        row.enabled === 1,
      );
      const recompute =
        patch.cronExpression !== undefined ||
        patch.timezone !== undefined ||
        patch.targetId !== undefined;
      const nextRunAt =
        row.enabled === 1 && recompute ? validated.nextRunAt : row.next_run_at;
      return {
        statement: context.env.DB.prepare(
          `UPDATE schedules SET
               name = ?, description = ?, target_id = ?, action = ?, action_version = ?,
               cron_expression = ?, timezone = ?, payload_json = ?, retry_policy_json = ?,
               timeout_ms = ?, misfire_policy = ?, misfire_grace_seconds = ?,
               next_run_at = ?, revision = revision + 1, updated_at = ?
             WHERE id = ? AND revision = ? AND archived_at IS NULL`,
        ).bind(
          merged.name,
          merged.description,
          merged.targetId,
          merged.action,
          merged.actionVersion,
          merged.cronExpression,
          merged.timezone,
          JSON.stringify(merged.payload),
          JSON.stringify(merged.retryPolicy),
          merged.timeoutMs,
          merged.misfirePolicy,
          merged.misfireGraceSeconds,
          nextRunAt,
          now,
          row.id,
          expectedRevision,
        ),
        response: { data: { id: row.id, revision: expectedRevision + 1 } },
        status: 200,
        action: "schedule.updated",
        entityType: "schedule",
        entityId: row.id,
        changes: {
          fromRevision: expectedRevision,
          toRevision: expectedRevision + 1,
        },
        conflictCode: "SCHEDULE_REVISION_CONFLICT",
        conflictMessage: "计划已被其他操作修改，请刷新后重试",
      } satisfies MutationPlan;
    });
  });

  app.post("/schedules/:id/pause", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    parseOrThrow(z.object({}), body.value);
    const revision = requireRevision(context.req.header("If-Match"));
    return executeIdempotentMutation(context, body.raw, async () => {
      const row = await readSchedule(context.env.DB, context.req.param("id"));
      if (row.archived_at !== null) {
        throw new ApiError(409, "SCHEDULE_ARCHIVED", "已归档计划不能暂停");
      }
      const now = Date.now();
      return {
        statement: context.env.DB.prepare(
          `UPDATE schedules
             SET enabled = 0, next_run_at = NULL, revision = revision + 1, updated_at = ?
             WHERE id = ? AND revision = ? AND archived_at IS NULL AND enabled = 1`,
        ).bind(now, row.id, revision),
        response: {
          data: { id: row.id, enabled: false, revision: revision + 1 },
        },
        status: 200,
        action: "schedule.paused",
        entityType: "schedule",
        entityId: row.id,
        changes: { revision: revision + 1 },
        conflictCode: "SCHEDULE_REVISION_CONFLICT",
        conflictMessage: "计划状态已变化，请刷新后重试",
      } satisfies MutationPlan;
    });
  });

  app.post("/schedules/:id/resume", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    parseOrThrow(z.object({}), body.value);
    const revision = requireRevision(context.req.header("If-Match"));
    return executeIdempotentMutation(context, body.raw, async () => {
      const row = await readSchedule(context.env.DB, context.req.param("id"));
      if (row.archived_at !== null) {
        throw new ApiError(409, "SCHEDULE_ARCHIVED", "已归档计划不能恢复");
      }
      const input = scheduleRowToInput(row);
      const now = Date.now();
      const { nextRunAt } = validateScheduleInput(
        input,
        new CronCalculator(),
        now,
      );
      await requireTargetState(context.env.DB, row.target_id, true);
      return {
        statement: context.env.DB.prepare(
          `UPDATE schedules
             SET enabled = 1, next_run_at = ?, revision = revision + 1, updated_at = ?
             WHERE id = ? AND revision = ? AND archived_at IS NULL AND enabled = 0`,
        ).bind(nextRunAt, now, row.id, revision),
        response: {
          data: {
            id: row.id,
            enabled: true,
            revision: revision + 1,
            nextRunAt: new Date(nextRunAt).toISOString(),
          },
        },
        status: 200,
        action: "schedule.resumed",
        entityType: "schedule",
        entityId: row.id,
        changes: { revision: revision + 1, nextRunAt },
        conflictCode: "SCHEDULE_REVISION_CONFLICT",
        conflictMessage: "计划状态已变化，请刷新后重试",
      } satisfies MutationPlan;
    });
  });

  app.post("/schedules/:id/archive", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    parseOrThrow(z.object({}), body.value);
    const revision = requireRevision(context.req.header("If-Match"));
    return executeIdempotentMutation(context, body.raw, async () => {
      const row = await readSchedule(context.env.DB, context.req.param("id"));
      const now = Date.now();
      return {
        statement: context.env.DB.prepare(
          `UPDATE schedules
             SET archived_at = ?, enabled = 0, next_run_at = NULL,
                 revision = revision + 1, updated_at = ?
             WHERE id = ? AND revision = ? AND archived_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM executions e WHERE e.schedule_id = schedules.id
                   AND e.status IN ('pending', 'running', 'retry_wait', 'unknown')
               )`,
        ).bind(now, now, row.id, revision),
        response: {
          data: {
            id: row.id,
            archivedAt: new Date(now).toISOString(),
            revision: revision + 1,
          },
        },
        status: 200,
        action: "schedule.archived",
        entityType: "schedule",
        entityId: row.id,
        changes: { revision: revision + 1 },
        conflictCode: "SCHEDULE_BUSY",
        conflictMessage: "计划已有活跃执行或 revision 已变化，暂时不能归档",
      } satisfies MutationPlan;
    });
  });

  app.post("/schedules/:id/run", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    parseOrThrow(z.object({}), body.value);
    return executeIdempotentMutation(context, body.raw, async () => {
      const row = await readSchedule(context.env.DB, context.req.param("id"));
      if (row.archived_at !== null) {
        throw new ApiError(409, "SCHEDULE_ARCHIVED", "已归档计划不能运行");
      }
      const input = scheduleRowToInput(row);
      const now = Date.now();
      validateScheduleInput(input, new CronCalculator(), now);
      await requireTargetState(context.env.DB, row.target_id, true);
      const executionId = crypto.randomUUID();
      const snapshot = buildScheduleSnapshot(input, row.revision);
      snapshot.scheduleId = row.id;
      return {
        statement: context.env.DB.prepare(
          `INSERT INTO executions (
               id, schedule_id, target_id, source, scheduled_for, dedupe_key,
               schedule_revision, snapshot_json, status, available_at,
               next_attempt_reason, attempt_limit, max_auto_attempts,
               retry_deadline_at, created_at, updated_at
             )
             SELECT ?, id, target_id, 'manual', NULL, ?, revision, ?, 'pending', ?,
                    'initial', ?, ?, ?, ?, ?
             FROM schedules
             WHERE id = ? AND revision = ? AND archived_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM executions active WHERE active.schedule_id = schedules.id
                   AND active.status IN ('pending', 'running', 'retry_wait', 'unknown')
               )`,
        ).bind(
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
        conflictMessage:
          "计划 revision 已变化或已有尚未完成的执行，请刷新后重试",
      } satisfies MutationPlan;
    });
  });

  app.post("/cron/preview", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    const input = parseOrThrow(cronPreviewSchema, body.value);
    const afterMs =
      input.after === undefined ? Date.now() : Date.parse(input.after);
    const values = new CronCalculator().preview(
      input.cronExpression,
      input.timezone,
      afterMs,
      input.count,
    );
    const formatter = new Intl.DateTimeFormat("zh-CN", {
      timeZone: input.timezone,
      dateStyle: "medium",
      timeStyle: "long",
      hourCycle: "h23",
    });
    return context.json({
      data: values.map((value) => ({
        utc: new Date(value).toISOString(),
        local: formatter.format(value),
      })),
    });
  });
}

function serializeScheduleListRow(value: unknown) {
  const row = z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      target_id: z.string(),
      action: z.string(),
      action_version: z.number(),
      cron_expression: z.string(),
      timezone: z.string(),
      enabled: z.number(),
      revision: z.number(),
      next_run_at: z.number().nullable(),
      last_status: z.string().nullable(),
      last_execution_at: z.number().nullable(),
    })
    .passthrough()
    .parse(value);
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
    revision: row.revision,
    nextRunAt: toIso(row.next_run_at),
    lastExecution:
      row.last_status === null
        ? null
        : { status: row.last_status, at: toIso(row.last_execution_at) },
  };
}
