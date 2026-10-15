import { z } from "zod";
import { DomainError } from "../../domain/error";
import { serializeRun } from "./run-history-repository";
import { SuccessRateRepository } from "./success-rate-repository";

const countSchema = z.object({ status: z.string(), count: z.number() });
const bucketSchema = z.object({
  schedule_id: z.string(),
  bucket: z.number(),
  count: z.number(),
  at: z.number(),
  run_id: z.string(),
  mode: z.enum(["rpc", "queue"]),
  severity: z.number(),
});
const statuses = [
  "succeeded",
  "skipped",
  "cancelled",
  "pending",
  "running",
  "unreported",
  "retry_wait",
  "unknown",
  "failed",
] as const;

/** Complete-window aggregates are independent of the history page's cursor. */
export class OverviewRepository {
  constructor(private readonly db: D1Database) {}

  async read(now: number) {
    const from = now - 86400000;
    const attentionWhere =
      "created_at >= ? AND created_at <= ? AND (status IN ('failed','unknown','retry_wait') OR (status='running' AND started_at<=?))";
    const [batch, successRates] = await Promise.all([
      this.db.batch([
        this.db
          .prepare(`SELECT COALESCE(SUM(effective_enabled),0) active_schedules, COUNT(*) total_schedules,
          COALESCE(SUM(CASE WHEN NOT EXISTS(SELECT 1 FROM run_history r WHERE r.schedule_id=state.schedule_id AND r.status IN ('succeeded','failed','unknown')) THEN 1 ELSE 0 END),0) unverified_schedules
          FROM managed_schedule_effective_state state`),
        this.db.prepare(
          "SELECT * FROM run_history ORDER BY created_at DESC,id DESC LIMIT 10",
        ),
        this.db
          .prepare(
            "SELECT status,COUNT(*) count FROM run_history WHERE created_at>=? AND created_at<=? GROUP BY status",
          )
          .bind(from, now),
        this.db.prepare("SELECT * FROM platform_state WHERE id=1"),
        this.db
          .prepare(
            `SELECT COUNT(*) total FROM run_history WHERE ${attentionWhere}`,
          )
          .bind(from, now, now - 15 * 60000),
        this.db
          .prepare(
            `SELECT * FROM run_history WHERE ${attentionWhere} ORDER BY CASE status WHEN 'failed' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END,created_at DESC,id DESC LIMIT 4`,
          )
          .bind(from, now, now - 15 * 60000),
        this.db
          .prepare(
            `SELECT schedule_id, CAST((created_at-?)/3600000 AS INTEGER) bucket,
          COUNT(*) count, MAX(created_at) at, MAX(id) run_id, MAX(mode) mode,
          MAX(CASE status WHEN 'failed' THEN 8 WHEN 'unknown' THEN 7 WHEN 'retry_wait' THEN 6
            WHEN 'unreported' THEN 5 WHEN 'running' THEN 4 WHEN 'pending' THEN 3
            WHEN 'cancelled' THEN 2 WHEN 'skipped' THEN 1 ELSE 0 END) severity
          FROM run_history WHERE created_at>=? AND created_at<=? GROUP BY schedule_id,bucket
          ORDER BY schedule_id,bucket`,
          )
          .bind(from, from, now),
      ]),
      new SuccessRateRepository(this.db).readGlobalWindows(now),
    ]);
    const [
      counts,
      recent,
      summary,
      state,
      attentionCount,
      attentionRows,
      signals,
    ] = batch;
    if (
      !counts ||
      !recent ||
      !summary ||
      !state ||
      !attentionCount ||
      !attentionRows ||
      !signals
    )
      throw new DomainError(
        "unavailable",
        "D1_BATCH_INCOMPLETE",
        "D1 未返回完整 overview 结果",
      );
    const scheduleCounts = z
      .object({
        active_schedules: z.number(),
        total_schedules: z.number(),
        unverified_schedules: z.number(),
      })
      .parse(counts.results[0]);
    const summaries = summary.results.map((value) => countSchema.parse(value));
    const count = (status: string) =>
      summaries.find((row) => row.status === status)?.count ?? 0;
    return {
      data: {
        schedules: {
          active_schedules: scheduleCounts.active_schedules,
          total_schedules: scheduleCounts.total_schedules,
        },
        executions24h: summaries,
        recentExecutions: recent.results.map(serializeRun),
        system: state.results[0] ?? null,
        successRates,
        attention: {
          total: z
            .object({ total: z.number() })
            .parse(attentionCount.results[0]).total,
          items: attentionRows.results.map((value) => {
            const run = serializeRun(value);
            return run.status === "running"
              ? { ...run, reasonCode: "运行超过 15 分钟，等待核实结果" }
              : run;
          }),
        },
        coverage: {
          total: summaries.reduce((sum, row) => sum + row.count, 0),
          succeeded: count("succeeded"),
          unreported: count("unreported"),
          active: count("running") + count("pending"),
          unverifiedSchedules: scheduleCounts.unverified_schedules,
        },
        signalBuckets: signals.results.map((value) => {
          const row = bucketSchema.parse(value);
          return {
            scheduleId: row.schedule_id,
            count: row.count,
            at: new Date(row.at).toISOString(),
            from: new Date(from + row.bucket * 3600000).toISOString(),
            to: new Date(
              Math.min(now, from + (row.bucket + 1) * 3600000 - 1),
            ).toISOString(),
            runId: row.count === 1 ? row.run_id : null,
            mode: row.mode,
            status: statuses[row.severity] ?? "unknown",
          };
        }),
      },
      meta: { serverTime: new Date(now).toISOString() },
    };
  }
}
