import { cronTargetDescriptionV1Schema } from "@unified-cron/contracts";
import { z } from "zod";
import { ServiceBindingAdapter } from "../../infrastructure/rpc/service-binding-adapter";
import { getTargetManifest } from "../../targets.manifest";
import { RegisteredTargetCatalog } from "../../infrastructure/d1/registered-target-catalog";
import { TargetRepository } from "../../infrastructure/d1/target-repository";
import { ApiError } from "../errors";
import { parseOrThrow } from "../http-support";
import { executeIdempotentMutation } from "../../infrastructure/d1/idempotent-mutation";
import { parseMutationBody } from "../request-body";
import type { ApiRouter } from "../router";

export function registerTargetRoutes(app: ApiRouter): void {
  app.get("/targets", async (context) => {
    return context.json({
      data: await new TargetRepository(context.env.DB).list(),
    });
  });

  app.get("/targets/:id", async (context) => {
    const target = getTargetManifest(context.req.param("id"));
    if (!target) {
      throw new ApiError(404, "TARGET_NOT_FOUND", "Target 不在部署白名单中");
    }
    return context.json({
      data: await new TargetRepository(context.env.DB).detail(target.id),
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
        const registered = await new RegisteredTargetCatalog(
          context.env.DB,
        ).listActions(target.id);
        const remote = cronTargetDescriptionV1Schema.parse(
          await new ServiceBindingAdapter(context.env).describe(target),
        );
        const compatible =
          registered.length > 0 &&
          registered.length === remote.actions.length &&
          registered.every((expected) =>
            remote.actions.some(
              (actual) =>
                actual.name === expected.name &&
                actual.version === expected.version &&
                actual.idempotent === expected.idempotent,
            ),
          );
        checkStatus = compatible ? "compatible" : "incompatible";
        message = compatible
          ? "RPC describe() 与最新 Registration 一致"
          : registered.length === 0
            ? "Target 尚未提交 Registration"
            : "RPC describe() 与最新 Registration 不一致";
      } catch {
        checkStatus = "unreachable";
        message = "无法调用无副作用 describe() 或响应不合法";
      }
      return new TargetRepository(context.env.DB).planRecordCheck({
        targetId: target.id,
        status: checkStatus,
        message,
        now: Date.now(),
      });
    });
  });

  for (const operation of ["enable", "disable"] as const) {
    app.post(`/targets/:id/${operation}`, async (context) => {
      const body = await parseMutationBody(context.req.raw);
      parseOrThrow(z.object({}), body.value);
      return executeIdempotentMutation(context, body.raw, () => {
        return new TargetRepository(context.env.DB).planEnabledState(
          context.req.param("id"),
          operation,
          Date.now(),
        );
      });
    });
  }
}
