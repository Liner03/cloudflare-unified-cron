import { z } from "zod";
import {
  clearAdminSessionCookie,
  createAdminSession,
  deleteAdminSession,
  enforceMutationRequest,
  readAdminActor,
  verifyConfiguredPassword,
} from "../../infrastructure/auth/access";
import { ApiError } from "../errors";
import { parseOrThrow } from "../http-support";
import { parseMutationBody } from "../request-body";
import type { ApiRouter } from "../router";
import { AdminLoginLimitRepository } from "../../infrastructure/d1/admin-login-limit-repository";

const loginSchema = z
  .object({
    username: z.string().min(1).max(128),
    password: z.string().min(1).max(1024),
  })
  .strict();

export function registerAuthRoutes(app: ApiRouter): void {
  app.get("/auth/session", async (context) => {
    const actor = await readAdminActor(context.req.raw, context.env);
    return context.json({
      data:
        actor === null
          ? { authenticated: false, username: null }
          : { authenticated: true, username: actor },
    });
  });

  app.post("/auth/login", async (context) => {
    enforceMutationRequest(context.req.raw, context.env);
    const body = await parseMutationBody(context.req.raw);
    const input = parseOrThrow(loginSchema, body.value);
    const loginLimits = new AdminLoginLimitRepository(context.env.DB);
    const limitKey = await loginLimits.requireAllowed(
      context.req.header("CF-Connecting-IP") ?? "unknown-source",
      Date.now(),
    );
    const passwordMatches = await verifyConfiguredPassword(
      input.password,
      context.env.ADMIN_PASSWORD_HASH,
    );
    if (input.username !== context.env.ADMIN_USERNAME || !passwordMatches) {
      await loginLimits.recordFailure(limitKey, Date.now());
      throw new ApiError(401, "INVALID_CREDENTIALS", "用户名或密码不正确");
    }
    await loginLimits.clear(limitKey);
    const session = await createAdminSession(context.env, input.username);
    return context.json(
      {
        data: {
          authenticated: true,
          username: input.username,
          expiresAt: new Date(session.expiresAt).toISOString(),
        },
      },
      200,
      { "Set-Cookie": session.cookie },
    );
  });

  app.post("/auth/logout", async (context) => {
    enforceMutationRequest(context.req.raw, context.env);
    await deleteAdminSession(context.req.raw, context.env);
    return context.json(
      { data: { authenticated: false, username: null } },
      200,
      { "Set-Cookie": clearAdminSessionCookie(context.env) },
    );
  });
}
