import type { Context } from "hono";
import type { ApiVariables } from "../infrastructure/auth/access";
import {
  IdempotentMutationRepository,
  type MutationPlan,
} from "../infrastructure/d1/idempotent-mutation";
import { ApiError } from "./errors";

/** Adapts HTTP mutation identity to the transport-neutral D1 implementation. */
export async function executeIdempotentMutation(
  context: Context<{ Bindings: Env; Variables: ApiVariables }>,
  rawBody: Uint8Array,
  createPlan: () => Promise<MutationPlan> | MutationPlan,
): Promise<Response> {
  const key = requireIdempotencyKey(context.req.raw);
  const actor = context.get("actor");
  const outcome = await new IdempotentMutationRepository(
    context.env.DB,
  ).execute(
    {
      scope: `${actor}:${context.req.method}:${new URL(context.req.url).pathname}`,
      key,
      actor,
      rawBody,
      now: Date.now(),
    },
    createPlan,
  );
  return new Response(outcome.responseJson, {
    status: outcome.status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
    },
  });
}

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get("Idempotency-Key");
  if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new ApiError(
      422,
      "IDEMPOTENCY_KEY_REQUIRED",
      "写操作需要 8..128 字符的 Idempotency-Key",
    );
  }
  return key;
}
