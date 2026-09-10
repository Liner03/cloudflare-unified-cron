import { DomainError } from "../../domain/error";
import type { MutationPlan } from "./idempotent-mutation";

export class SystemRepository {
  constructor(private readonly db: D1Database) {}

  async read(now: number) {
    const state = await this.db
      .prepare("SELECT * FROM platform_state WHERE id = 1 LIMIT 1")
      .first();
    if (!state) {
      throw new DomainError(
        "unavailable",
        "PLATFORM_STATE_MISSING",
        "平台尚未初始化",
      );
    }
    return {
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
      meta: { serverTime: new Date(now).toISOString() },
    };
  }

  planDispatchState(operation: "pause" | "resume", now: number): MutationPlan {
    const paused = operation === "pause";
    return {
      statement: this.db
        .prepare(
          `UPDATE platform_state SET dispatch_paused = ?, updated_at = ?
           WHERE id = 1 AND dispatch_paused <> ?`,
        )
        .bind(paused ? 1 : 0, now, paused ? 1 : 0),
      response: { data: { dispatchPaused: paused } },
      status: 200,
      action: `system.${operation}d`,
      entityType: "system",
      entityId: "1",
      changes: { dispatchPaused: paused },
      conflictCode: "SYSTEM_STATE_CONFLICT",
      conflictMessage: "全局派发状态已经变化",
    };
  }
}
