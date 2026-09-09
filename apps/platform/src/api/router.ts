import { Hono } from "hono";
import type { ApiVariables } from "../infrastructure/auth/access";

export type ApiEnvironment = { Bindings: Env; Variables: ApiVariables };

export function createApiRouter() {
  return new Hono<ApiEnvironment>().basePath("/api/v1");
}

export type ApiRouter = ReturnType<typeof createApiRouter>;
