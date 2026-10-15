import { triggerResultSchema } from "@unified-cron/contracts";
import { TriggerDeliveryRepository } from "../../infrastructure/d1/trigger-delivery-repository";
import { enforceJsonRequest } from "../../infrastructure/auth/access";
import { parseMutationBody } from "../request-body";
import { parseOrThrow } from "../http-support";
import { ApiError } from "../errors";
import type { ApiRouter } from "../router";
import { z } from "zod";
import { parseCursor, parseOptionalTime } from "../http-support";

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  direction: z.enum(["next", "previous"]).default("next"),
  scheduleId: z.string().max(128).default(""),
  targetId: z.string().max(128).default(""),
  status: z
    .enum([
      "",
      "pending",
      "sending",
      "unknown",
      "queued",
      "skipped",
      "cancelled",
    ])
    .default(""),
  result: z.enum(["", "succeeded", "failed", "unreported"]).default(""),
});

export function registerDeliveryReceiptRoute(app: ApiRouter) {
  app.post("/delivery-receipts/:id", async (context) => {
    enforceJsonRequest(context.req.raw);
    const token = /^Bearer (ucrr_[A-Za-z0-9_-]{43})$/.exec(
      context.req.header("Authorization") ?? "",
    )?.[1];
    if (!token)
      throw new ApiError(401, "RECEIPT_TOKEN_REQUIRED", "需要专用投递回报凭据");
    const body = await parseMutationBody(context.req.raw);
    const result = await new TriggerDeliveryRepository(context.env.DB).report(
      context.req.param("id"),
      token,
      parseOrThrow(triggerResultSchema, body.value),
      Date.now(),
    );
    return context.json({ data: result });
  });
}
export function registerDeliveryRoutes(app: ApiRouter) {
  app.get("/deliveries", async (context) => {
    const input = parseOrThrow(listSchema, context.req.query());
    const from = parseOptionalTime(context.req.query("from")),
      to = parseOptionalTime(context.req.query("to"));
    if (from !== null && to !== null && from > to)
      throw new ApiError(422, "INVALID_TIME_RANGE", "开始时间必须早于结束时间");
    return context.json(
      await new TriggerDeliveryRepository(context.env.DB).page({
        ...input,
        from,
        to,
        cursor: parseCursor(context.req.query("cursor")),
        now: Date.now(),
      }),
    );
  });
}
