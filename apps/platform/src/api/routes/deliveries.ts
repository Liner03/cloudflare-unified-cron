import { triggerResultSchema } from "@unified-cron/contracts";
import { TriggerDeliveryRepository } from "../../infrastructure/d1/trigger-delivery-repository";
import { enforceJsonRequest } from "../../infrastructure/auth/access";
import { parseMutationBody } from "../request-body";
import { parseOrThrow } from "../http-support";
import { ApiError } from "../errors";
import type { ApiRouter } from "../router";

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
    const limit = Number(context.req.query("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new ApiError(422, "INVALID_LIMIT", "limit 必须为 1..1000");
    return context.json({
      summary: await new TriggerDeliveryRepository(context.env.DB).summary(),
      data: await new TriggerDeliveryRepository(context.env.DB).list(
        context.req.query("scheduleId") ?? "",
        limit,
      ),
    });
  });
}
