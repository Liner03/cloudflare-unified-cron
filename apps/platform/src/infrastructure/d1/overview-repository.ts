import { DomainError } from "../../domain/error";
import { serializeExecutionSummary } from "./execution-view";
import { SuccessRateRepository } from "./success-rate-repository";

/** Reads one internally consistent operational overview for the administrator. */
export class OverviewRepository {
  constructor(private readonly db: D1Database) {}

  async read(now: number) {
    const [batch, successRates] = await Promise.all([
      this.db.batch([
        this.db.prepare(
          `SELECT
             SUM(CASE WHEN s.enabled = 1 AND t.enabled = 1
                       AND p.dispatch_paused = 0
                       AND s.managed_by_registration = 1
                       AND s.retired_at IS NULL THEN 1 ELSE 0 END)
               AS active_schedules,
             SUM(CASE WHEN s.managed_by_registration = 1
                       AND s.retired_at IS NULL THEN 1 ELSE 0 END)
               AS total_schedules
           FROM schedules s
           JOIN targets t ON t.id = s.target_id
           JOIN platform_state p ON p.id = 1`,
        ),
        this.db.prepare(
          `SELECT id, schedule_id, target_id, source, status, reason_code,
                  scheduled_for, attempt_count, created_at, finished_at
           FROM executions ORDER BY created_at DESC, id DESC LIMIT 10`,
        ),
        this.db
          .prepare(
            `SELECT status, COUNT(*) AS count FROM executions
           WHERE created_at >= ? GROUP BY status`,
          )
          .bind(now - 24 * 60 * 60 * 1000),
        this.db.prepare("SELECT * FROM platform_state WHERE id = 1"),
      ]),
      new SuccessRateRepository(this.db).readGlobalWindows(now),
    ]);
    const [counts, recent, summary, state] = batch;
    if (!counts || !recent || !summary || !state) {
      throw new DomainError(
        "unavailable",
        "D1_BATCH_INCOMPLETE",
        "D1 未返回完整 overview 结果",
      );
    }
    return {
      data: {
        schedules: counts.results[0] ?? {
          active_schedules: 0,
          total_schedules: 0,
        },
        executions24h: summary.results,
        recentExecutions: recent.results.map(serializeExecutionSummary),
        system: state.results[0] ?? null,
        successRates,
      },
      meta: { serverTime: new Date(now).toISOString() },
    };
  }
}
