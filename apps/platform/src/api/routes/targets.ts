import { cronTargetDescriptionV1Schema } from "@unified-cron/contracts";
import { z } from "zod";
import { ServiceBindingAdapter } from "../../infrastructure/rpc/service-binding-adapter";
import { TARGETS, getTargetManifest } from "../../targets.manifest";
import { ApiError } from "../errors";
import { parseOrThrow } from "../http-support";
import {
  executeIdempotentMutation,
  parseMutationBody,
  type MutationPlan,
} from "../mutation";
import type { ApiRouter } from "../router";

export function registerTargetRoutes(app: ApiRouter): void {
  app.get("/targets", async (context) => {
    const result = await context.env.DB.prepare(
      "SELECT * FROM targets ORDER BY id",
    ).all();
    const stateById = new Map(
      result.results.flatMap((row) =>
        typeof row.id === "string" ? ([[row.id, row]] as const) : [],
      ),
    );
    return context.json({
      data: TARGETS.map((target) => ({
        ...target,
        state: stateById.get(target.id) ?? null,
      })),
    });
  });

  app.get("/targets/:id", async (context) => {
    const target = getTargetManifest(context.req.param("id"));
    if (!target) {
      throw new ApiError(404, "TARGET_NOT_FOUND", "Target 不在部署白名单中");
    }
    const [state, schedules] = await context.env.DB.batch([
      context.env.DB.prepare("SELECT * FROM targets WHERE id = ?").bind(
        target.id,
      ),
      context.env.DB.prepare(
        `SELECT id, name, action, action_version, enabled, next_run_at
           FROM schedules WHERE target_id = ? AND archived_at IS NULL ORDER BY name LIMIT 50`,
      ).bind(target.id),
    ]);
    if (!state || !schedules) {
      throw new ApiError(
        503,
        "D1_BATCH_INCOMPLETE",
        "D1 未返回完整 Target 结果",
      );
    }
    return context.json({
      data: {
        ...target,
        state: state.results[0] ?? null,
        schedules: schedules.results,
      },
    });
  });

  app.post("/targets/:id/check", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    parseOrThrow(z.object({}), body.value);
    return executeIdempotentMutation(context, body.raw, async () => {
      const target = getTargetManifest(context.req.param("id"));
      if (!target) {
        throw new ApiError(404, "TARGET_NOT_FOUND", "Target 不在部署白名单中");
      }
      let checkStatus: "compatible" | "incompatible" | "unreachable";
      let message: string;
      try {
        const remote = cronTargetDescriptionV1Schema.parse(
          await new ServiceBindingAdapter(context.env).describe(target),
        );
        const compatible = target.actions.every((expected) =>
          remote.actions.some(
            (actual) =>
              actual.name === expected.name &&
              actual.version === expected.version &&
              actual.idempotent === expected.idempotent,
          ),
        );
        checkStatus = compatible ? "compatible" : "incompatible";
        message = compatible
          ? "协议与 Action manifest 一致"
          : "远端 Action manifest 与部署声明不一致";
      } catch {
        checkStatus = "unreachable";
        message = "无法调用无副作用 describe() 或响应不合法";
      }
      const now = Date.now();
      return {
        statement: context.env.DB.prepare(
          `UPDATE targets SET last_check_at = ?, last_check_status = ?,
                                last_check_message = ?, updated_at = ?
             WHERE id = ?`,
        ).bind(now, checkStatus, message, now, target.id),
        response: {
          data: {
            targetId: target.id,
            status: checkStatus,
            message,
            checkedAt: new Date(now).toISOString(),
          },
        },
        status: 200,
        action: "target.checked",
        entityType: "target",
        entityId: target.id,
        changes: { status: checkStatus },
        conflictCode: "TARGET_NOT_SYNCED",
        conflictMessage: "Target manifest 尚未同步到 D1",
      } satisfies MutationPlan;
    });
  });

  for (const operation of ["enable", "disable"] as const) {
    app.post(`/targets/:id/${operation}`, async (context) => {
      const body = await parseMutationBody(context.req.raw);
      parseOrThrow(z.object({}), body.value);
      return executeIdempotentMutation(context, body.raw, () => {
        const target = getTargetManifest(context.req.param("id"));
        if (!target) {
          throw new ApiError(
            404,
            "TARGET_NOT_FOUND",
            "Target 不在部署白名单中",
          );
        }
        const enabled = operation === "enable";
        const now = Date.now();
        return {
          statement: context.env.DB.prepare(
            "UPDATE targets SET enabled = ?, updated_at = ? WHERE id = ? AND enabled <> ?",
          ).bind(enabled ? 1 : 0, now, target.id, enabled ? 1 : 0),
          response: { data: { targetId: target.id, enabled } },
          status: 200,
          action: `target.${operation}d`,
          entityType: "target",
          entityId: target.id,
          changes: { enabled },
          conflictCode: "TARGET_STATE_CONFLICT",
          conflictMessage: "Target 状态已变化或尚未同步",
        } satisfies MutationPlan;
      });
    });
  }
}
