import { z } from "zod";

const rateRowSchema = z.object({
  denominator: z.number(),
  succeeded: z.number(),
  first_attempt_succeeded: z.number(),
});

export type SuccessRateWindow = "24h" | "7d" | "30d";

export interface RateValue {
  numerator: number;
  denominator: number;
  rate: number | null;
}

export interface SuccessRateView {
  window: SuccessRateWindow;
  from: string;
  to: string;
  execution: RateValue;
  firstAttempt: RateValue;
}

const WINDOW_MS: Record<SuccessRateWindow, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** Computes truthful resolved-execution rates and always exposes sample size. */
export class SuccessRateRepository {
  constructor(private readonly db: D1Database) {}

  async read(input: {
    window: SuccessRateWindow;
    targetId?: string;
    scheduleId?: string;
    now: number;
  }): Promise<SuccessRateView> {
    const from = input.now - WINDOW_MS[input.window];
    const clauses = [
      "created_at >= ?",
      "created_at <= ?",
      "status IN ('succeeded', 'failed', 'unknown')",
    ];
    const bindings: Array<string | number> = [from, input.now];
    if (input.targetId !== undefined) {
      clauses.push("target_id = ?");
      bindings.push(input.targetId);
    }
    if (input.scheduleId !== undefined) {
      clauses.push("schedule_id = ?");
      bindings.push(input.scheduleId);
    }
    const value = await this.db
      .prepare(
        `SELECT COUNT(*) AS denominator,
                COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END), 0)
                  AS succeeded,
                COALESCE(SUM(CASE WHEN status = 'succeeded' AND attempt_count = 1
                                  THEN 1 ELSE 0 END), 0)
                  AS first_attempt_succeeded
         FROM executions
         WHERE ${clauses.join(" AND ")}`,
      )
      .bind(...bindings)
      .first();
    const row = rateRowSchema.parse(
      value ?? {
        denominator: 0,
        succeeded: 0,
        first_attempt_succeeded: 0,
      },
    );
    return {
      window: input.window,
      from: new Date(from).toISOString(),
      to: new Date(input.now).toISOString(),
      execution: toRate(row.succeeded, row.denominator),
      firstAttempt: toRate(row.first_attempt_succeeded, row.denominator),
    };
  }

  async readGlobalWindows(now: number): Promise<SuccessRateView[]> {
    return Promise.all(
      (["24h", "7d", "30d"] as const).map((window) =>
        this.read({ window, now }),
      ),
    );
  }
}

function toRate(numerator: number, denominator: number): RateValue {
  return {
    numerator,
    denominator,
    rate: denominator === 0 ? null : numerator / denominator,
  };
}
