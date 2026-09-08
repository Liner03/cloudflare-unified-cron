import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { MiddlewareHandler } from "hono";
import { ApiError } from "../../api/errors";

const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const MAX_JWKS_CONFIGS = 4;

export interface ApiVariables {
  actor: string;
  requestId: string;
}

export const authenticate: MiddlewareHandler<{ Bindings: Env; Variables: ApiVariables }> = async (
  context,
  next,
) => {
  const requestId = crypto.randomUUID();
  context.set("requestId", requestId);
  const authMode: string = context.env.AUTH_MODE;
  const appEnv: string = context.env.APP_ENV;

  if (authMode === "local" && appEnv !== "production") {
    context.set("actor", "local-admin");
    await next();
    return;
  }
  if (authMode !== "access") {
    throw new ApiError(503, "AUTH_CONFIGURATION_INVALID", "生产认证配置不完整");
  }

  const token = context.req.header("Cf-Access-Jwt-Assertion");
  if (!token) throw new ApiError(401, "AUTH_REQUIRED", "需要 Cloudflare Access 登录");
  const teamDomain = normalizeTeamDomain(context.env.ACCESS_TEAM_DOMAIN);
  const jwksUrl = `${teamDomain}/cdn-cgi/access/certs`;
  let jwks = jwksByUrl.get(jwksUrl);
  if (!jwks) {
    if (jwksByUrl.size >= MAX_JWKS_CONFIGS) jwksByUrl.clear();
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    jwksByUrl.set(jwksUrl, jwks);
  }
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: teamDomain,
      audience: context.env.ACCESS_AUD,
    }));
  } catch {
    throw new ApiError(401, "AUTH_TOKEN_INVALID", "Access 会话无效或已过期");
  }
  const actor =
    typeof payload.email === "string"
      ? payload.email
      : typeof payload.sub === "string"
        ? payload.sub
        : null;
  if (!actor) throw new ApiError(401, "AUTH_IDENTITY_MISSING", "Access Token 缺少可信身份");
  context.set("actor", actor);
  await next();
};

export function enforceMutationRequest(
  request: Request,
  publicOrigin: string,
): void {
  const origin = request.headers.get("Origin");
  if (origin !== publicOrigin) {
    throw new ApiError(403, "ORIGIN_FORBIDDEN", "请求来源不被允许");
  }
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError(422, "JSON_REQUIRED", "写操作只接受 application/json");
  }
}

function normalizeTeamDomain(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(503, "AUTH_CONFIGURATION_INVALID", "Access team domain 无效");
  }
  if (url.protocol !== "https:" || url.pathname !== "/") {
    throw new ApiError(503, "AUTH_CONFIGURATION_INVALID", "Access team domain 必须是 HTTPS origin");
  }
  return url.origin;
}
