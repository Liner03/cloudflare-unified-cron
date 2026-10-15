import { z } from "zod";
import { RunHistoryRepository } from "../../infrastructure/d1/run-history-repository";
import { ApiError } from "../errors";
import { parseCursor, parseOptionalTime, parseOrThrow } from "../http-support";
import type { ApiRouter } from "../router";

const filters = z.object({
  status: z
    .enum([
      "",
      "pending",
      "running",
      "retry_wait",
      "succeeded",
      "failed",
      "unknown",
      "skipped",
      "cancelled",
      "unreported",
    ])
    .default(""),
  mode: z.enum(["", "queue", "rpc"]).default(""),
  source: z.enum(["", "cron", "manual", "rerun"]).default(""),
  targetId: z.string().max(128).default(""),
  scheduleId: z.string().max(128).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  direction: z.enum(["next", "previous"]).default("next"),
});

export function registerRunRoutes(app: ApiRouter) {
  app.get("/runs", async (context) => {
    const input = parseOrThrow(filters, context.req.query());
    const from = parseOptionalTime(context.req.query("from")),
      to = parseOptionalTime(context.req.query("to"));
    if (from !== null && to !== null && from > to)
      throw new ApiError(422, "INVALID_TIME_RANGE", "开始时间必须早于结束时间");
    return context.json(
      await new RunHistoryRepository(context.env.DB).list({
        ...input,
        from,
        to,
        cursor: parseCursor(context.req.query("cursor")),
        now: Date.now(),
      }),
    );
  });
  app.get("/runs/:id", async (context) =>
    context.json({
      data: await new RunHistoryRepository(context.env.DB).detail(
        context.req.param("id"),
      ),
    }),
  );
}
