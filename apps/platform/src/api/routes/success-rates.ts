import { z } from "zod";
import { SuccessRateRepository } from "../../infrastructure/d1/success-rate-repository";
import { parseOrThrow } from "../http-support";
import type { ApiRouter } from "../router";

const querySchema = z.object({
  window: z.enum(["24h", "7d", "30d"]).default("24h"),
  targetId: z.string().min(1).max(128).optional(),
  scheduleId: z.string().min(1).max(128).optional(),
});

export function registerSuccessRateRoutes(app: ApiRouter): void {
  app.get("/success-rates", async (context) => {
    const query = parseOrThrow(querySchema, {
      window: context.req.query("window"),
      targetId: optional(context.req.query("targetId")),
      scheduleId: optional(context.req.query("scheduleId")),
    });
    const result = await new SuccessRateRepository(context.env.DB).read({
      window: query.window,
      ...(query.targetId === undefined ? {} : { targetId: query.targetId }),
      ...(query.scheduleId === undefined
        ? {}
        : { scheduleId: query.scheduleId }),
      now: Date.now(),
    });
    return context.json({ data: result });
  });
}

function optional(value: string | undefined): string | undefined {
  return value === "" ? undefined : value;
}
