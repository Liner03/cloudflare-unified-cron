import type { MiddlewareHandler } from "hono";
import { pbkdf2 } from "node:crypto";
import { promisify } from "node:util";
import { ApiError } from "../../api/errors";
import { ADMIN_SESSION_TTL_MS } from "../../domain/auth";
import { AdminSessionRepository } from "../d1/admin-session-repository";
import { timingSafeEqual } from "../security/crypto";

const MIN_PBKDF2_ITERATIONS = 600_000;
const derivePbkdf2 = promisify(pbkdf2);

export interface ApiVariables {
  actor: string;
  requestId: string;
}

export interface CreatedAdminSession {
  cookie: string;
  expiresAt: number;
}

export const authenticate: MiddlewareHandler<{
  Bindings: Env;
  Variables: ApiVariables;
}> = async (context, next) => {
  const actor = await readAdminActor(context.req.raw, context.env);
  if (actor === null) {
    throw new ApiError(401, "AUTH_REQUIRED", "需要管理员登录");
  }
  context.set("actor", actor);
  await next();
};

export async function readAdminActor(
  request: Request,
  env: Env,
): Promise<string | null> {
  const rawToken = readCookie(request.headers.get("Cookie"), cookieName(env));
  if (rawToken === null || !/^ucas_[A-Za-z0-9_-]{43}$/.test(rawToken)) {
    return null;
  }
  return new AdminSessionRepository(env.DB).findActor(rawToken, Date.now());
}

export async function verifyConfiguredPassword(
  suppliedPassword: string,
  encodedHash: string,
): Promise<boolean> {
  const parts = encodedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") {
    throw invalidAuthConfiguration();
  }
  const iterations = Number(parts[1]);
  const salt = decodeBase64Url(parts[2] ?? "");
  const expected = decodeBase64Url(parts[3] ?? "");
  if (
    !Number.isInteger(iterations) ||
    iterations < MIN_PBKDF2_ITERATIONS ||
    iterations > 2_000_000 ||
    salt.byteLength < 16 ||
    expected.byteLength !== 32
  ) {
    throw invalidAuthConfiguration();
  }
  const derived = await derivePbkdf2(
    suppliedPassword,
    salt,
    iterations,
    expected.byteLength,
    "sha256",
  );
  const derivedBytes = new Uint8Array(derived.byteLength);
  derivedBytes.set(derived);
  return timingSafeEqual(derivedBytes.buffer, new Uint8Array(expected).buffer);
}

export async function createAdminSession(
  env: Env,
  username: string,
): Promise<CreatedAdminSession> {
  const now = Date.now();
  const { token, expiresAt } = await new AdminSessionRepository(env.DB).create(
    username,
    now,
  );
  return {
    cookie: serializeSessionCookie(
      env,
      token,
      Math.floor(ADMIN_SESSION_TTL_MS / 1000),
    ),
    expiresAt,
  };
}

export async function deleteAdminSession(
  request: Request,
  env: Env,
): Promise<void> {
  const token = readCookie(request.headers.get("Cookie"), cookieName(env));
  if (token !== null) {
    await new AdminSessionRepository(env.DB).revoke(token, Date.now());
  }
}

export function clearAdminSessionCookie(env: Env): string {
  return serializeSessionCookie(env, "", 0);
}

export function enforceMutationRequest(
  request: Request,
  env: Pick<Env, "APP_ENV" | "PUBLIC_ORIGIN">,
): void {
  if (!isAllowedMutationOrigin(request.headers.get("Origin"), env)) {
    throw new ApiError(403, "ORIGIN_FORBIDDEN", "请求来源不被允许");
  }
  enforceJsonRequest(request);
}

export function enforceJsonRequest(request: Request): void {
  const contentType = request.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError(422, "JSON_REQUIRED", "写操作只接受 application/json");
  }
}

function invalidAuthConfiguration(): ApiError {
  return new ApiError(
    503,
    "AUTH_CONFIGURATION_INVALID",
    "管理员密码哈希配置无效",
  );
}

function isAllowedMutationOrigin(
  suppliedOrigin: string | null,
  env: Pick<Env, "APP_ENV" | "PUBLIC_ORIGIN">,
): boolean {
  const publicOrigin = String(env.PUBLIC_ORIGIN);
  if (suppliedOrigin === publicOrigin) return true;
  if (suppliedOrigin === null || String(env.APP_ENV) === "production") {
    return false;
  }
  try {
    const supplied = new URL(suppliedOrigin);
    const configured = new URL(publicOrigin);
    return (
      supplied.origin === suppliedOrigin &&
      configured.origin === publicOrigin &&
      supplied.protocol === configured.protocol &&
      supplied.port === configured.port &&
      isLoopbackHostname(supplied.hostname) &&
      isLoopbackHostname(configured.hostname)
    );
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

function cookieName(env: Env): string {
  return isSecureSessionEnvironment(String(env.APP_ENV))
    ? "__Host-ucp_session"
    : "ucp_session";
}

export function isSecureSessionEnvironment(value: string): boolean {
  return value === "staging" || value === "production";
}

function serializeSessionCookie(
  env: Env,
  value: string,
  maxAgeSeconds: number,
): string {
  const secure = isSecureSessionEnvironment(String(env.APP_ENV))
    ? "; Secure"
    : "";
  return `${cookieName(env)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return new Uint8Array();
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(
      value.replaceAll("-", "+").replaceAll("_", "/") + padding,
    );
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}
