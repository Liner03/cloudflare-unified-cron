import {
  cronTargetDescriptionV1Schema,
  jsonValueSchema,
  type JsonValue,
} from "@unified-cron/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { CronCalculator } from "../infrastructure/cron/cron-calculator";
import { ServiceBindingAdapter } from "../infrastructure/rpc/service-binding-adapter";
import { parseSnapshot } from "../infrastructure/d1/execution-repository";
import { TARGETS, getTargetManifest } from "../targets.manifest";
import { ApiError, errorResponse } from "./errors";
import {
  executeIdempotentMutation,
  parseMutationBody,
  type MutationPlan,
} from "./mutation";
import {
  buildScheduleSnapshot,
  readSchedule,
  requireRevision,
  scheduleRowToInput,
  serializeSchedule,
  validateScheduleInput,
} from "./schedule-service";
import {
  cronPreviewSchema,
  resolveExecutionSchema,
  riskConfirmationSchema,
  scheduleInputSchema,
  schedulePatchSchema,
} from "./schemas";
import {
  authenticate,
  enforceMutationRequest,
  type ApiVariables,
} from "../infrastructure/auth/access";

const MAX_SCHEDULES = 50;
const app = new Hono<{ Bindings: Env; Variables: ApiVariables }>().basePath("/api/v1");

app.use("*", authenticate);
app.use("*", async (context, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(context.req.method)) {
    enforceMutationRequest(context.req.raw, context.env.PUBLIC_ORIGIN);
  }
  await next();
  context.res.headers.set("Cache-Control", "no-store");
  context.res.headers.set("X-Content-Type-Options", "nosniff");
  context.res.headers.set("Referrer-Policy", "same-origin");
  context.res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
  );
});

app.onError((error, context) => errorResponse(error, context.get("requestId") ?? crypto.randomUUID()));

app.get("/overview", async (context) => {
  const [counts, recent] = await context.env.DB.batch([
    context.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN enabled = 1 AND archived_at IS NULL THEN 1 ELSE 0 END) AS active_schedules,
         SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS total_schedules
       FROM schedules`,
    ),
    context.env.DB.prepare(
      `SELECT id, schedule_id, target_id, source, status, reason_code,
              scheduled_for, attempt_count, created_at, finished_at
       FROM executions ORDER BY created_at DESC, id DESC LIMIT 10`,
    ),
  ]);
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const [summary, state] = await context.env.DB.batch([
    context.env.DB.prepare(
      `SELECT status, COUNT(*) AS count FROM executions
       WHERE created_at >= ? GROUP BY status`,
    ).bind(since),
    context.env.DB.prepare("SELECT * FROM platform_state WHERE id = 1"),
  ]);
  if (!counts || !recent || !summary || !state) {
    throw new ApiError(503, "D1_BATCH_INCOMPLETE", "D1 未返回完整 overview 结果");
  }
  return context.json({
    data: {
      schedules: counts.results[0] ?? { active_schedules: 0, total_schedules: 0 },
      executions24h: summary.results,
      recentExecutions: recent.results.map(serializeExecutionSummary),
      system: state.results[0] ?? null,
    },
    meta: { serverTime: new Date().toISOString() },
  });
});

app.get("/schedules", async (context) => {
  const search = context.req.query("search")?.trim() ?? "";
  const target = context.req.query("target")?.trim() ?? "";
  const enabled = context.req.query("enabled")?.trim() ?? "";
  if (search.length > 100 || target.length > 128 || !["", "true", "false"].includes(enabled)) {
    throw new ApiError(422, "INVALID_FILTER", "Schedule 筛选参数不合法");
  }
  const result = await context.env.DB
    .prepare(
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
    const count = await context.env.DB
      .prepare("SELECT COUNT(*) AS count FROM schedules WHERE archived_at IS NULL")
      .first<{ count: number }>();
    if ((count?.count ?? 0) >= MAX_SCHEDULES) {
      throw new ApiError(429, "SCHEDULE_LIMIT_REACHED", `V1 最多管理 ${MAX_SCHEDULES} 个未归档计划`);
    }
    const cron = new CronCalculator();
    const now = Date.now();
    const validated = validateScheduleInput(input, cron, now);
    await requireTargetState(context.env.DB, input.targetId, input.enabled);
    const id = crypto.randomUUID();
    return {
      statement: context.env.DB
        .prepare(
          `INSERT INTO schedules (
             id, name, description, target_id, action, action_version,
             cron_expression, timezone, enabled, revision, payload_json,
             retry_policy_json, timeout_ms, misfire_policy, misfire_grace_seconds,
             next_run_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
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
        ),
      response: { data: { id, revision: 1 } },
      status: 200,
      action: "schedule.created",
      entityType: "schedule",
      entityId: id,
      changes: { targetId: input.targetId, action: input.action, enabled: input.enabled },
      conflictCode: "SCHEDULE_CONFLICT",
      conflictMessage: "计划创建冲突，请使用新的名称或重试",
    } satisfies MutationPlan;
  });
});

app.get("/schedules/:id", async (context) => {
  const row = await readSchedule(context.env.DB, context.req.param("id"));
  const recent = await context.env.DB
    .prepare(
      `SELECT id, schedule_id, target_id, source, status, reason_code,
              scheduled_for, attempt_count, created_at, finished_at
       FROM executions WHERE schedule_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 10`,
    )
    .bind(row.id)
    .all();
  return context.json({
    data: { ...serializeSchedule(row), recentExecutions: recent.results.map(serializeExecutionSummary) },
  });
});

app.patch("/schedules/:id", async (context) => {
  const body = await parseMutationBody(context.req.raw);
  const patch = parseOrThrow(schedulePatchSchema, body.value);
  const expectedRevision = requireRevision(context.req.header("If-Match"));
  return executeIdempotentMutation(context, body.raw, async () => {
    const row = await readSchedule(context.env.DB, context.req.param("id"));
    if (row.archived_at !== null) throw new ApiError(409, "SCHEDULE_ARCHIVED", "已归档计划不能编辑");
    const merged = scheduleInputSchema.parse({ ...scheduleRowToInput(row), ...patch });
    const now = Date.now();
    const validated = validateScheduleInput(merged, new CronCalculator(), now);
    await requireTargetState(context.env.DB, merged.targetId, row.enabled === 1);
    const recompute =
      patch.cronExpression !== undefined || patch.timezone !== undefined || patch.targetId !== undefined;
    const nextRunAt = row.enabled === 1 && recompute ? validated.nextRunAt : row.next_run_at;
    return {
      statement: context.env.DB
        .prepare(
          `UPDATE schedules SET
             name = ?, description = ?, target_id = ?, action = ?, action_version = ?,
             cron_expression = ?, timezone = ?, payload_json = ?, retry_policy_json = ?,
             timeout_ms = ?, misfire_policy = ?, misfire_grace_seconds = ?,
             next_run_at = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND archived_at IS NULL`,
        )
        .bind(
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
      changes: { fromRevision: expectedRevision, toRevision: expectedRevision + 1 },
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
    if (row.archived_at !== null) throw new ApiError(409, "SCHEDULE_ARCHIVED", "已归档计划不能暂停");
    const now = Date.now();
    return {
      statement: context.env.DB
        .prepare(
          `UPDATE schedules
           SET enabled = 0, next_run_at = NULL, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND archived_at IS NULL AND enabled = 1`,
        )
        .bind(now, row.id, revision),
      response: { data: { id: row.id, enabled: false, revision: revision + 1 } },
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
    if (row.archived_at !== null) throw new ApiError(409, "SCHEDULE_ARCHIVED", "已归档计划不能恢复");
    const input = scheduleRowToInput(row);
    const now = Date.now();
    const { nextRunAt } = validateScheduleInput(input, new CronCalculator(), now);
    await requireTargetState(context.env.DB, row.target_id, true);
    return {
      statement: context.env.DB
        .prepare(
          `UPDATE schedules
           SET enabled = 1, next_run_at = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND archived_at IS NULL AND enabled = 0`,
        )
        .bind(nextRunAt, now, row.id, revision),
      response: {
        data: { id: row.id, enabled: true, revision: revision + 1, nextRunAt: new Date(nextRunAt).toISOString() },
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
      statement: context.env.DB
        .prepare(
          `UPDATE schedules
           SET archived_at = ?, enabled = 0, next_run_at = NULL,
               revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND archived_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM executions e WHERE e.schedule_id = schedules.id
                 AND e.status IN ('pending', 'running', 'retry_wait', 'unknown')
             )`,
        )
        .bind(now, now, row.id, revision),
      response: { data: { id: row.id, archivedAt: new Date(now).toISOString(), revision: revision + 1 } },
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
    if (row.archived_at !== null) throw new ApiError(409, "SCHEDULE_ARCHIVED", "已归档计划不能运行");
    const input = scheduleRowToInput(row);
    const now = Date.now();
    validateScheduleInput(input, new CronCalculator(), now);
    await requireTargetState(context.env.DB, row.target_id, true);
    const executionId = crypto.randomUUID();
    const snapshot = buildScheduleSnapshot(input, row.revision);
    snapshot.scheduleId = row.id;
    return {
      statement: context.env.DB
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
           WHERE id = ? AND archived_at IS NULL
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
        ),
      response: { data: { executionId, status: "pending" } },
      status: 202,
      action: "execution.run_now_requested",
      entityType: "execution",
      entityId: executionId,
      changes: { scheduleId: row.id, source: "manual" },
      conflictCode: "SCHEDULE_BUSY",
      conflictMessage: "该计划已有尚未完成的执行",
    } satisfies MutationPlan;
  });
});

app.post("/cron/preview", async (context) => {
  const body = await parseMutationBody(context.req.raw);
  const input = parseOrThrow(cronPreviewSchema, body.value);
  const afterMs = input.after === undefined ? Date.now() : Date.parse(input.after);
  const values = new CronCalculator().preview(input.cronExpression, input.timezone, afterMs, input.count);
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: input.timezone,
    dateStyle: "medium",
    timeStyle: "long",
    hourCycle: "h23",
  });
  return context.json({
    data: values.map((value) => ({ utc: new Date(value).toISOString(), local: formatter.format(value) })),
  });
});

app.get("/targets", async (context) => {
  const result = await context.env.DB.prepare("SELECT * FROM targets ORDER BY id").all();
  const stateById = new Map(
    result.results.flatMap((row) =>
      typeof row.id === "string" ? ([[row.id, row]] as const) : [],
    ),
  );
  return context.json({
    data: TARGETS.map((target) => ({ ...target, state: stateById.get(target.id) ?? null })),
  });
});

app.get("/targets/:id", async (context) => {
  const target = getTargetManifest(context.req.param("id"));
  if (!target) throw new ApiError(404, "TARGET_NOT_FOUND", "Target 不在部署白名单中");
  const [state, schedules] = await context.env.DB.batch([
    context.env.DB.prepare("SELECT * FROM targets WHERE id = ?").bind(target.id),
    context.env.DB
      .prepare(
        `SELECT id, name, action, action_version, enabled, next_run_at
         FROM schedules WHERE target_id = ? AND archived_at IS NULL ORDER BY name LIMIT 50`,
      )
      .bind(target.id),
  ]);
  if (!state || !schedules) throw new ApiError(503, "D1_BATCH_INCOMPLETE", "D1 未返回完整 Target 结果");
  return context.json({ data: { ...target, state: state.results[0] ?? null, schedules: schedules.results } });
});

app.post("/targets/:id/check", async (context) => {
  const body = await parseMutationBody(context.req.raw);
  parseOrThrow(z.object({}), body.value);
  return executeIdempotentMutation(context, body.raw, async () => {
    const target = getTargetManifest(context.req.param("id"));
    if (!target) throw new ApiError(404, "TARGET_NOT_FOUND", "Target 不在部署白名单中");
    let checkStatus: "compatible" | "incompatible" | "unreachable";
    let message: string;
    try {
      const remote = cronTargetDescriptionV1Schema.parse(
        await new ServiceBindingAdapter(context.env).describe(target),
      );
      const compatible = target.actions.every((expected) =>
        remote.actions.some(
          (actual) =>
            actual.name === expected.name &&
            actual.version === expected.version &&
            actual.idempotent === expected.idempotent,
        ),
      );
      checkStatus = compatible ? "compatible" : "incompatible";
      message = compatible ? "协议与 Action manifest 一致" : "远端 Action manifest 与部署声明不一致";
    } catch {
      checkStatus = "unreachable";
      message = "无法调用无副作用 describe() 或响应不合法";
    }
    const now = Date.now();
    return {
      statement: context.env.DB
        .prepare(
          `UPDATE targets SET last_check_at = ?, last_check_status = ?,
                              last_check_message = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(now, checkStatus, message, now, target.id),
      response: { data: { targetId: target.id, status: checkStatus, message, checkedAt: new Date(now).toISOString() } },
      status: 200,
      action: "target.checked",
      entityType: "target",
      entityId: target.id,
      changes: { status: checkStatus },
      conflictCode: "TARGET_NOT_SYNCED",
      conflictMessage: "Target manifest 尚未同步到 D1",
    } satisfies MutationPlan;
  });
});

for (const operation of ["enable", "disable"] as const) {
  app.post(`/targets/:id/${operation}`, async (context) => {
    const body = await parseMutationBody(context.req.raw);
    parseOrThrow(z.object({}), body.value);
    return executeIdempotentMutation(context, body.raw, () => {
      const target = getTargetManifest(context.req.param("id"));
      if (!target) throw new ApiError(404, "TARGET_NOT_FOUND", "Target 不在部署白名单中");
      const enabled = operation === "enable";
      const now = Date.now();
      return {
        statement: context.env.DB
          .prepare("UPDATE targets SET enabled = ?, updated_at = ? WHERE id = ? AND enabled <> ?")
          .bind(enabled ? 1 : 0, now, target.id, enabled ? 1 : 0),
        response: { data: { targetId: target.id, enabled } },
        status: 200,
        action: `target.${operation}d`,
        entityType: "target",
        entityId: target.id,
        changes: { enabled },
        conflictCode: "TARGET_STATE_CONFLICT",
        conflictMessage: "Target 状态已变化或尚未同步",
      } satisfies MutationPlan;
    });
  });
}

for (const operation of ["pause", "resume"] as const) {
  app.post(`/system/${operation}`, async (context) => {
    const body = await parseMutationBody(context.req.raw);
    parseOrThrow(z.object({}), body.value);
    return executeIdempotentMutation(context, body.raw, () => {
      const paused = operation === "pause";
      const now = Date.now();
      return {
        statement: context.env.DB
          .prepare("UPDATE platform_state SET dispatch_paused = ?, updated_at = ? WHERE id = 1 AND dispatch_paused <> ?")
          .bind(paused ? 1 : 0, now, paused ? 1 : 0),
        response: { data: { dispatchPaused: paused } },
        status: 200,
        action: `system.${operation}d`,
        entityType: "system",
        entityId: "1",
        changes: { dispatchPaused: paused },
        conflictCode: "SYSTEM_STATE_CONFLICT",
        conflictMessage: "全局派发状态已经变化",
      } satisfies MutationPlan;
    });
  });
}

app.get("/executions", async (context) => {
  const status = context.req.query("status")?.trim() ?? "";
  const source = context.req.query("source")?.trim() ?? "";
  const scheduleId = context.req.query("scheduleId")?.trim() ?? "";
  const limit = Math.min(50, Math.max(1, Number(context.req.query("limit") ?? 20)));
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
  if ((status !== "" && !allowedStatuses.includes(status)) || !["", "cron", "manual", "rerun"].includes(source)) {
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
  const result = await context.env.DB
    .prepare(
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
    result.results.length > limit && last && typeof last.created_at === "number" && typeof last.id === "string"
      ? createCursor(last.created_at, last.id)
      : null;
  return context.json({
    data: values.map((value) => ({
      ...serializeExecutionSummary(value),
      scheduleName:
        typeof value.schedule_name === "string" ? value.schedule_name : "已清理或未知计划",
      availableAt: typeof value.available_at === "number" ? toIso(value.available_at) : null,
    })),
    meta: { nextCursor, serverTime: new Date().toISOString() },
  });
});

app.get("/executions/:id", async (context) => {
  const execution = await readExecution(context.env.DB, context.req.param("id"));
  const attempts = await context.env.DB
    .prepare(
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
    const execution = await readExecution(context.env.DB, context.req.param("id"));
    if (!(["failed", "unknown"] as const).includes(execution.status as "failed" | "unknown")) {
      throw new ApiError(409, "EXECUTION_NOT_RETRYABLE", "只有 failed 或 unknown 执行可人工重试");
    }
    const snapshot = parseSnapshotJson(execution.snapshot_json);
    const target = getTargetManifest(execution.target_id);
    const action = target?.actions.find(
      (candidate) => candidate.name === snapshot.action && candidate.version === snapshot.actionVersion,
    );
    if (!target || !action) throw new ApiError(409, "TARGET_CAPABILITY_REMOVED", "目标 Action 或版本已移除");
    await requireTargetState(context.env.DB, execution.target_id, true);
    if (Date.now() - execution.created_at > 7 * 24 * 60 * 60 * 1000) {
      throw new ApiError(409, "OPERATOR_RETRY_WINDOW_EXPIRED", "人工重试的 7 天窗口已结束");
    }
    if (execution.attempt_limit >= 10) throw new ApiError(409, "ATTEMPT_HARD_LIMIT", "Attempt 总数已达到 10 次上限");
    if ((execution.status === "unknown" || !action.idempotent) && !input.confirmRisk) {
      throw new ApiError(422, "RISK_CONFIRMATION_REQUIRED", "必须确认原业务可能已经执行的风险");
    }
    const now = Date.now();
    return {
      statement: context.env.DB
        .prepare(
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
        )
        .bind(now, now, execution.id, execution.status, now - 7 * 24 * 60 * 60 * 1000),
      response: { data: { executionId: execution.id, status: "retry_wait", availableAt: new Date(now).toISOString() } },
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
  if (!input.confirmRisk) throw new ApiError(422, "RISK_CONFIRMATION_REQUIRED", "新建运行会使用新的幂等键，必须确认风险");
  return executeIdempotentMutation(context, body.raw, async () => {
    const parent = await readExecution(context.env.DB, context.req.param("id"));
    if (!["succeeded", "failed", "skipped", "cancelled"].includes(parent.status)) {
      throw new ApiError(409, "EXECUTION_NOT_RERUNNABLE", "活跃或 unknown 执行不能直接 Run again");
    }
    const snapshot = parseSnapshotJson(parent.snapshot_json);
    const target = getTargetManifest(parent.target_id);
    const action = target?.actions.find(
      (candidate) => candidate.name === snapshot.action && candidate.version === snapshot.actionVersion,
    );
    if (!target || !action) throw new ApiError(409, "TARGET_CAPABILITY_REMOVED", "目标 Action 或版本已移除");
    await requireTargetState(context.env.DB, parent.target_id, true);
    const executionId = crypto.randomUUID();
    const now = Date.now();
    return {
      statement: context.env.DB
        .prepare(
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
        )
        .bind(
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
      response: { data: { executionId, parentExecutionId: parent.id, status: "pending" } },
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
    const execution = await readExecution(context.env.DB, context.req.param("id"));
    const now = Date.now();
    return {
      statement: context.env.DB
        .prepare(
          `UPDATE executions
           SET status = 'cancelled', reason_code = 'OPERATOR_CANCELLED',
               finished_at = ?, available_at = ?, updated_at = ?
           WHERE id = ? AND status IN ('pending', 'retry_wait')`,
        )
        .bind(now, now, now, execution.id),
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
    const execution = await readExecution(context.env.DB, context.req.param("id"));
    const nextStatus =
      input.resolution === "confirmed_succeeded"
        ? "succeeded"
        : input.resolution === "confirmed_failed"
          ? "failed"
          : "cancelled";
    const now = Date.now();
    const resultJson =
      nextStatus === "succeeded"
        ? JSON.stringify({ operatorResolution: input.resolution, note: input.note })
        : null;
    return {
      statement: context.env.DB
        .prepare(
          `UPDATE executions
           SET status = ?, reason_code = 'OPERATOR_RESOLVED_UNKNOWN',
               finished_at = ?, available_at = ?, result_json = ?,
               operator_resolved_at = ?, operator_resolution_note = ?, updated_at = ?
           WHERE id = ? AND status = 'unknown'`,
        )
        .bind(nextStatus, now, now, resultJson, now, input.note, now, execution.id),
      response: { data: { executionId: execution.id, status: nextStatus, resolution: input.resolution } },
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
  const limit = Math.min(50, Math.max(1, Number(context.req.query("limit") ?? 20)));
  const cursor = parseCursor(context.req.query("cursor"));
  const result = cursor
    ? await context.env.DB
        .prepare(
          `SELECT id, actor, action, entity_type, entity_id, changes_json, created_at
           FROM audit_events
           WHERE created_at < ? OR (created_at = ? AND id < ?)
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .bind(cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
        .all()
    : await context.env.DB
        .prepare(
          `SELECT id, actor, action, entity_type, entity_id, changes_json, created_at
           FROM audit_events ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .bind(limit + 1)
        .all();
  const values = result.results.slice(0, limit);
  const last = values.at(-1);
  const nextCursor =
    result.results.length > limit && last && typeof last.created_at === "number" && typeof last.id === "string"
      ? createCursor(last.created_at, last.id)
      : null;
  return context.json({
    data: values.map((value) => ({
      ...value,
      changes: typeof value.changes_json === "string" ? parseJson(value.changes_json) : null,
      changes_json: undefined,
      createdAt: typeof value.created_at === "number" ? toIso(value.created_at) : null,
      created_at: undefined,
    })),
    meta: { nextCursor },
  });
});

app.get("/system", async (context) => {
  const state = await context.env.DB.prepare("SELECT * FROM platform_state WHERE id = 1").first();
  if (!state) throw new ApiError(503, "PLATFORM_STATE_MISSING", "平台尚未初始化");
  return context.json({
    data: {
      ...state,
      protocolVersion: 1,
      budgets: {
        maxSchedules: 50,
        maxMaterializePerTick: 2,
        maxAttemptsPerTick: 2,
        maxRecoveriesPerTick: 2,
        tickSoftWallBudgetMs: 45_000,
        leaseMs: 90_000,
      },
    },
    meta: { serverTime: new Date().toISOString() },
  });
});

app.all("*", () => {
  throw new ApiError(404, "NOT_FOUND", "API endpoint not found");
});

function parseOrThrow<Schema extends z.ZodType>(schema: Schema, value: unknown): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(422, "VALIDATION_FAILED", "请求字段不合法", {
      field: parsed.error.issues[0]?.path.join(".") ?? "body",
    });
  }
  return parsed.data;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
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
    lastExecution: row.last_status === null ? null : { status: row.last_status, at: toIso(row.last_execution_at) },
  };
}

function serializeExecutionSummary(value: unknown) {
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

type ExecutionRow = z.infer<typeof executionRowSchema>;

async function readExecution(db: D1Database, id: string): Promise<ExecutionRow> {
  const row = await db.prepare("SELECT * FROM executions WHERE id = ?").bind(id).first();
  if (!row) throw new ApiError(404, "EXECUTION_NOT_FOUND", "执行不存在或已清理");
  return executionRowSchema.parse(row);
}

function serializeExecution(row: ExecutionRow) {
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
    lastError: row.last_error_json === null ? null : parseJson(row.last_error_json),
    operatorResolvedAt: toIso(row.operator_resolved_at),
    operatorResolutionNote: row.operator_resolution_note,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function serializeAttempt(value: unknown) {
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

function parseSnapshotJson(value: string) {
  return parseSnapshot(value);
}

function parseJson(value: string): JsonValue {
  return jsonValueSchema.parse(JSON.parse(value));
}

function parseOptionalTime(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new ApiError(422, "INVALID_TIME_FILTER", "时间筛选必须是 ISO 8601");
  return parsed;
}

function createCursor(createdAt: number, id: string): string {
  return btoa(JSON.stringify([createdAt, id]));
}

function parseCursor(value: string | undefined): { createdAt: number; id: string } | null {
  if (value === undefined || value === "") return null;
  try {
    const parsed = z.tuple([z.number(), z.string().min(1)]).parse(JSON.parse(atob(value)));
    return { createdAt: parsed[0], id: parsed[1] };
  } catch {
    throw new ApiError(422, "INVALID_CURSOR", "分页游标无效");
  }
}

async function requireTargetState(db: D1Database, targetId: string, requireEnabled: boolean): Promise<void> {
  const state = await db.prepare("SELECT enabled FROM targets WHERE id = ?").bind(targetId).first<{ enabled: number }>();
  if (!state) throw new ApiError(422, "TARGET_NOT_SYNCED", "Target manifest 尚未同步到 D1");
  if (requireEnabled && state.enabled !== 1) throw new ApiError(409, "TARGET_DISABLED", "Target 当前已禁用");
}

function toIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export { app as api };
