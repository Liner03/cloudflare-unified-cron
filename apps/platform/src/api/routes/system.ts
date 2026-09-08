import { z } from "zod";
import { ApiError } from "../errors";
import { parseOrThrow } from "../http-support";
import {
  executeIdempotentMutation,
  parseMutationBody,
  type MutationPlan,
} from "../mutation";
import type { ApiRouter } from "../router";

export function registerSystemRoutes(app: ApiRouter): void {
  for (const operation of ["pause", "resume"] as const) {
    app.post(`/system/${operation}`, async (context) => {
      const body = await parseMutationBody(context.req.raw);
      parseOrThrow(z.object({}), body.value);
      return executeIdempotentMutation(context, body.raw, () => {
        const paused = operation === "pause";
        const now = Date.now();
        return {
          statement: context.env.DB.prepare(
            "UPDATE platform_state SET dispatch_paused = ?, updated_at = ? WHERE id = 1 AND dispatch_paused <> ?",
          ).bind(paused ? 1 : 0, now, paused ? 1 : 0),
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

  app.get("/system", async (context) => {
    const state = await context.env.DB.prepare(
      "SELECT * FROM platform_state WHERE id = 1",
    ).first();
    if (!state) {
      throw new ApiError(503, "PLATFORM_STATE_MISSING", "平台尚未初始化");
    }
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
}
