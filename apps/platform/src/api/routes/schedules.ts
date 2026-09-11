import { z } from "zod";
import { ManagedScheduleRepository } from "../../infrastructure/d1/managed-schedule-repository";
import { CronCalculator } from "../../infrastructure/cron/cron-calculator";
import { ApiError } from "../errors";
import { parseOrThrow } from "../http-support";
import { executeIdempotentMutation } from "../idempotent-mutation";
import { parseMutationBody } from "../request-body";
import type { ApiRouter } from "../router";
import { cronPreviewSchema } from "../schemas";

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
    const schedules = await new ManagedScheduleRepository(context.env.DB).list({
      search,
      target,
      enabled: enabled as "" | "true" | "false",
    });
    return context.json({ data: schedules });
  });

  app.get("/schedules/:id", async (context) => {
    const schedule = await new ManagedScheduleRepository(context.env.DB).detail(
      context.req.param("id"),
    );
    return context.json({ data: schedule });
  });

  for (const operation of ["pause", "resume"] as const) {
    app.post(`/schedules/:id/${operation}`, async (context) => {
      const body = await parseMutationBody(context.req.raw);
      return executeIdempotentMutation(context, body.raw, () => {
        parseOrThrow(z.object({}).strict(), body.value);
        const revision = requireRevision(context.req.header("If-Match"));
        const schedules = new ManagedScheduleRepository(context.env.DB);
        return operation === "pause"
          ? schedules.planPause(context.req.param("id"), revision, Date.now())
          : schedules.planResume(context.req.param("id"), revision, Date.now());
      });
    });
  }

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

function requireRevision(header: string | undefined): number {
  if (!header) {
    throw new ApiError(
      422,
      "IF_MATCH_REQUIRED",
      "修改计划需要 If-Match revision",
    );
  }
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
