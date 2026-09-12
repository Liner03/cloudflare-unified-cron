import { z } from "zod";
import { parseOrThrow } from "../http-support";
import { SystemRepository } from "../../infrastructure/d1/system-repository";
import { executeIdempotentMutation } from "../idempotent-mutation";
import { parseMutationBody } from "../request-body";
import type { ApiRouter } from "../router";
import { schedulerSettingsSchema } from "../../infrastructure/d1/scheduler-settings";
import { ApiError } from "../errors";

export function registerSystemRoutes(app: ApiRouter): void {
  app.post("/system/scheduler-settings", async (context) => {
    const body = await parseMutationBody(context.req.raw);
    return executeIdempotentMutation(context, body.raw, () => {
      const revision = Number(
        /^"([0-9]+)"$/.exec(context.req.header("If-Match") ?? "")?.[1],
      );
      if (!Number.isSafeInteger(revision) || revision < 1)
        throw new ApiError(
          422,
          "IF_MATCH_REQUIRED",
          "配置更新需要 If-Match revision",
        );
      return new SystemRepository(context.env.DB).planSettings(
        parseOrThrow(schedulerSettingsSchema, body.value),
        revision,
      );
    });
  });
  for (const operation of ["pause", "resume"] as const) {
    app.post(`/system/${operation}`, async (context) => {
      const body = await parseMutationBody(context.req.raw);
      return executeIdempotentMutation(context, body.raw, () => {
        parseOrThrow(z.object({}).strict(), body.value);
        return new SystemRepository(context.env.DB).planDispatchState(
          operation,
          Date.now(),
        );
      });
    });
  }

  app.get("/system", async (context) => {
    return context.json(
      await new SystemRepository(context.env.DB).read(Date.now()),
    );
  });
}
