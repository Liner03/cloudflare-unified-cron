import { LIMITS, type JsonValue } from "@unified-cron/contracts";
import type { Context } from "hono";
import type { ApiVariables } from "../infrastructure/auth/access";
import { ApiError } from "./errors";

const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface MutationPlan {
  statement: D1PreparedStatement;
  response: JsonValue;
  status: 200 | 202;
  action: string;
  entityType: string;
  entityId: string;
  changes: JsonValue;
  conflictCode: string;
  conflictMessage: string;
  conflictStatus?: 409 | 429;
}

interface StoredIdempotency {
  request_hash: string;
  status_code: number;
  response_json: string;
}

export async function parseMutationBody(request: Request): Promise<{
  raw: Uint8Array;
  value: unknown;
}> {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > LIMITS.requestBodyBytes) {
    throw new ApiError(413, "REQUEST_TOO_LARGE", "请求体不得超过 64 KiB");
  }
  const reader = request.body?.getReader();
  if (!reader) return { raw: new Uint8Array(), value: {} };
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > LIMITS.requestBodyBytes) {
      await reader.cancel("request too large");
      throw new ApiError(413, "REQUEST_TOO_LARGE", "请求体不得超过 64 KiB");
    }
    chunks.push(chunk.value);
  }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return { raw, value: text.length === 0 ? {} : JSON.parse(text) };
  } catch {
    throw new ApiError(422, "INVALID_JSON", "请求体不是有效 UTF-8 JSON");
  }
}

export async function executeIdempotentMutation(
  context: Context<{ Bindings: Env; Variables: ApiVariables }>,
  rawBody: Uint8Array,
  createPlan: () => Promise<MutationPlan> | MutationPlan,
): Promise<Response> {
  const key = context.req.header("Idempotency-Key");
  if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new ApiError(
      422,
      "IDEMPOTENCY_KEY_REQUIRED",
      "写操作需要 8..128 字符的 Idempotency-Key",
    );
  }
  const actor = context.get("actor");
  const scope = `${actor}:${context.req.method}:${new URL(context.req.url).pathname}`;
  const requestHash = await sha256(rawBody);
  const stored = await readStored(context.env.DB, scope, key);
  if (stored) return replay(stored, requestHash);

  const plan = await createPlan();
  const now = Date.now();
  const responseJson = JSON.stringify(plan.response);
  try {
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO api_idempotency (
             scope, key, request_hash, status_code, response_json, created_at, expires_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        scope,
        key,
        requestHash,
        plan.status,
        responseJson,
        now,
        now + IDEMPOTENCY_TTL_MS,
      ),
      plan.statement,
      context.env.DB.prepare(
        "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json('') END AS mutation_applied",
      ),
      context.env.DB.prepare(
        `INSERT INTO audit_events (
             id, actor, action, entity_type, entity_id, changes_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        actor,
        plan.action,
        plan.entityType,
        plan.entityId,
        JSON.stringify(plan.changes),
        now,
      ),
    ]);
  } catch (error) {
    const raced = await readStored(context.env.DB, scope, key);
    if (raced) return replay(raced, requestHash);
    if (isMutationConflict(error)) {
      throw new ApiError(
        plan.conflictStatus ?? 409,
        plan.conflictCode,
        plan.conflictMessage,
      );
    }
    throw error;
  }
  return Response.json(plan.response, {
    status: plan.status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function readStored(
  db: D1Database,
  scope: string,
  key: string,
): Promise<StoredIdempotency | null> {
  return db
    .prepare(
      `SELECT request_hash, status_code, response_json
       FROM api_idempotency WHERE scope = ? AND key = ? AND expires_at > ?`,
    )
    .bind(scope, key, Date.now())
    .first<StoredIdempotency>();
}

function replay(stored: StoredIdempotency, requestHash: string): Response {
  if (stored.request_hash !== requestHash) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "相同 Idempotency-Key 已用于不同请求体",
    );
  }
  return new Response(stored.response_json, {
    status: stored.status_code,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
    },
  });
}

async function sha256(value: Uint8Array): Promise<string> {
  const bytes = new Uint8Array(value.byteLength);
  bytes.set(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function isMutationConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /constraint failed|malformed JSON|UNIQUE constraint/i.test(
    error.message,
  );
}
