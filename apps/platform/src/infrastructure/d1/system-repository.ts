import { DomainError } from "../../domain/error";
import type { MutationPlan } from "./idempotent-mutation";
import {
  readSchedulerSettings,
  type SchedulerSettings,
} from "./scheduler-settings";

export class SystemRepository {
  constructor(private readonly db: D1Database) {}

  async read(now: number) {
    const settings = await readSchedulerSettings(this.db);
    const settingsRevision = await this.db
      .prepare("SELECT revision FROM scheduler_settings WHERE id=1")
      .first<{ revision: number }>();
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
        schedulerSettings: settings,
        settingsRevision: settingsRevision?.revision ?? 1,
        budgets: {
          maxSchedules: settings.max_schedules,
          maxMaterializePerTick: settings.materialize_budget,
          maxAttemptsPerTick: settings.rpc_budget,
          maxDeliveriesPerTick: settings.delivery_budget,
          concurrency: settings.concurrency,
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

  planSettings(settings: SchedulerSettings, revision: number): MutationPlan {
    return {
      statement: this.db
        .prepare(
          `UPDATE scheduler_settings SET max_schedules=?,materialize_budget=?,delivery_budget=?,rpc_budget=?,concurrency=?,per_target_batch=?,revision=revision+1 WHERE id=1 AND revision=?`,
        )
        .bind(
          settings.max_schedules,
          settings.materialize_budget,
          settings.delivery_budget,
          settings.rpc_budget,
          settings.concurrency,
          settings.per_target_batch,
          revision,
        ),
      response: { data: { revision: revision + 1 } },
      status: 200,
      action: "scheduler.settings_updated",
      entityType: "system",
      entityId: "1",
      changes: settings,
      conflictCode: "SETTINGS_REVISION_CONFLICT",
      conflictMessage: "调度配置已变化，请刷新后重试",
    };
  }
}
