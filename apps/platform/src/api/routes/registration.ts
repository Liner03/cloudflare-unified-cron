import { workerRegistrationV1Schema } from "@unified-cron/contracts";
import { RegistrationRepository } from "../../infrastructure/d1/registration-repository";
import { RegistrationTokenRepository } from "../../infrastructure/d1/registration-token-repository";
import { CronCalculator } from "../../infrastructure/cron/cron-calculator";
import { enforceJsonRequest } from "../../infrastructure/auth/access";
import { ApiError } from "../errors";
import { parseOrThrow } from "../http-support";
import { parseMutationBody } from "../request-body";
import type { ApiRouter } from "../router";

export function registerWorkerRegistrationRoute(app: ApiRouter): void {
  app.put("/registration", async (context) => {
    enforceJsonRequest(context.req.raw);
    const idempotencyKey = context.req.header("Idempotency-Key");
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new ApiError(
        422,
        "IDEMPOTENCY_KEY_REQUIRED",
        "Registration 需要 8..128 字符的 Idempotency-Key",
      );
    }
    const authorization = context.req.header("Authorization") ?? "";
    const match = /^Bearer (ucrt_[A-Za-z0-9_-]{43})$/.exec(authorization);
    if (!match?.[1]) {
      throw new ApiError(
        401,
        "REGISTRATION_TOKEN_REQUIRED",
        "需要有效的 Registration Token",
      );
    }
    const principal = await new RegistrationTokenRepository(
      context.env.DB,
    ).authenticate(match[1], Date.now());
    if (!principal) {
      throw new ApiError(
        401,
        "REGISTRATION_TOKEN_INVALID",
        "Registration Token 无效、已过期或已撤销",
      );
    }
    const body = await parseMutationBody(context.req.raw);
    const declaration = parseOrThrow(workerRegistrationV1Schema, body.value);
    const result = await new RegistrationRepository(
      context.env.DB,
      new CronCalculator(),
    ).apply(principal, declaration);
    return context.json({ data: result });
  });
}
