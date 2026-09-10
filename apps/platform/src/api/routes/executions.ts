import { z } from "zod";
import { ExecutionOperationsRepository } from "../../infrastructure/d1/execution-operations-repository";
import { ApiError } from "../errors";
import { parseCursor, parseOptionalTime, parseOrThrow } from "../http-support";
import { executeIdempotentMutation } from "../idempotent-mutation";
import { parseMutationBody } from "../request-body";
import type { ApiRouter } from "../router";
import { resolveExecutionSchema, riskConfirmationSchema } from "../schemas";

const statuses = [
  "pending",
  "running",
  "retry_wait",
  "succeeded",
  "failed",
  "unknown",
  "skipped",
  "cancelled",
] as const;

export function registerExecutionRoutes(app: ApiRouter): void {
  app.get("/executions", async (context) => {
    const status = context.req.query("status")?.trim() ?? "";
    const source = context.req.query("source")?.trim() ?? "";
    const scheduleId = context.req.query("scheduleId")?.trim() ?? "";
    const limit = Math.min(
      50,
      Math.max(1, Number(context.req.query("limit") ?? 20)),
    );
    if (
      (status !== "" &&
        !statuses.includes(status as (typeof statuses)[number])) ||
      !["", "cron", "manual", "rerun"].includes(source) ||
      !Number.isInteger(limit)
    ) {
      throw new ApiError(422, "INVALID_FILTER", "Execution 筛选参数不合法");
    }
    const result = await new ExecutionOperationsRepository(context.env.DB).list(
      {
        status,
        source,
        scheduleId,
        from: parseOptionalTime(context.req.query("from")),
        to: parseOptionalTime(context.req.query("to")),
        cursor: parseCursor(context.req.query("cursor")),
        limit,
        now: Date.now(),
      },
    );
    return context.json(result);
  });

  app.get("/executions/:id", async (context) => {
    const execution = await new ExecutionOperationsRepository(
      context.env.DB,
    ).detail(context.req.param("id"));
    return context.json({ data: execution });
  });

  app.post("/executions/:id/retry", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    const input = parseOrThrow(riskConfirmationSchema, body.value);
    return executeIdempotentMutation(context, body.raw, () =>
      new ExecutionOperationsRepository(context.env.DB).planRetry({
        id: context.req.param("id"),
        confirmRisk: input.confirmRisk,
        now: Date.now(),
      }),
    );
  });

  app.post("/executions/:id/rerun", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    const input = parseOrThrow(riskConfirmationSchema, body.value);
    return executeIdempotentMutation(context, body.raw, () =>
      new ExecutionOperationsRepository(context.env.DB).planRerun({
        id: context.req.param("id"),
        confirmRisk: input.confirmRisk,
        now: Date.now(),
      }),
    );
  });

  app.post("/executions/:id/cancel", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    parseOrThrow(z.object({}).strict(), body.value);
    return executeIdempotentMutation(context, body.raw, () =>
      new ExecutionOperationsRepository(context.env.DB).planCancel(
        context.req.param("id"),
        Date.now(),
      ),
    );
  });

  app.post("/executions/:id/resolve", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    const input = parseOrThrow(resolveExecutionSchema, body.value);
    return executeIdempotentMutation(context, body.raw, () =>
      new ExecutionOperationsRepository(context.env.DB).planResolve({
        id: context.req.param("id"),
        resolution: input.resolution,
        note: input.note,
        now: Date.now(),
      }),
    );
  });

  app.get("/audit-events", async (context) => {
    const limit = Math.min(
      50,
      Math.max(1, Number(context.req.query("limit") ?? 20)),
    );
    if (!Number.isInteger(limit)) {
      throw new ApiError(422, "INVALID_FILTER", "审计分页参数不合法");
    }
    const result = await new ExecutionOperationsRepository(
      context.env.DB,
    ).listAudit({
      limit,
      cursor: parseCursor(context.req.query("cursor")),
    });
    return context.json(result);
  });
}
