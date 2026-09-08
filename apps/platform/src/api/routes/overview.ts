import { ApiError } from "../errors";
import { serializeExecutionSummary } from "../execution-view";
import type { ApiRouter } from "../router";

export function registerOverviewRoutes(app: ApiRouter): void {
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
      throw new ApiError(
        503,
        "D1_BATCH_INCOMPLETE",
        "D1 未返回完整 overview 结果",
      );
    }
    return context.json({
      data: {
        schedules: counts.results[0] ?? {
          active_schedules: 0,
          total_schedules: 0,
        },
        executions24h: summary.results,
        recentExecutions: recent.results.map(serializeExecutionSummary),
        system: state.results[0] ?? null,
      },
      meta: { serverTime: new Date().toISOString() },
    });
  });
}
