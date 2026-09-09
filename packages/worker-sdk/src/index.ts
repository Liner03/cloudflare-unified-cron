import {
  LIMITS,
  cronRequestV1Schema,
  jsonByteLength,
  stringByteLength,
  type CronRequestV1,
  type CronResultV1,
  type CronTargetDescriptionV1,
  type JsonValue,
} from "@unified-cron/contracts";
import type { z } from "zod";

export class CronError extends Error {
  private constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "CronError";
  }

  static retryable(code: string, message: string): CronError {
    return new CronError(code, message, true);
  }

  static permanent(code: string, message: string): CronError {
    return new CronError(code, message, false);
  }
}

export interface ActionContext<Env> {
  env: Env;
  ctx: ExecutionContext;
  request: CronRequestV1;
  signal: AbortSignal;
}

export interface ActionSuccess {
  summary: string;
  output?: JsonValue;
  targetBuildId?: string;
}

export interface ActionDefinition<Env, Payload extends JsonValue> {
  version: number;
  idempotent: boolean;
  payloadSchema: z.ZodType<Payload>;
  run(payload: Payload, context: ActionContext<Env>): Promise<ActionSuccess>;
}

export function defineAction<Env, Payload extends JsonValue>(
  definition: ActionDefinition<Env, Payload>,
): ActionDefinition<Env, Payload> {
  return definition;
}

type AnyAction<Env> = ActionDefinition<Env, JsonValue>;
type ActionRegistration<Env> = AnyAction<Env> | AnyAction<Env>[];

export interface CronHandler<Env> {
  cron(
    input: unknown,
    runtime: { env: Env; ctx: ExecutionContext },
  ): Promise<CronResultV1>;
  describe(): CronTargetDescriptionV1;
}

export function createCronHandler<Env>(
  actions: Record<string, ActionRegistration<Env>>,
): CronHandler<Env> {
  const registry = new Map<
    string,
    { name: string; definition: AnyAction<Env> }
  >();
  for (const [name, registration] of Object.entries(actions)) {
    const definitions = Array.isArray(registration)
      ? registration
      : [registration];
    if (definitions.length === 0) {
      throw new Error(`Action ${name} must register at least one version`);
    }
    for (const definition of definitions) {
      const key = actionKey(name, definition.version);
      if (registry.has(key)) {
        throw new Error(
          `Duplicate action registration: ${name} v${definition.version}`,
        );
      }
      registry.set(key, { name, definition });
    }
  }

  return {
    describe() {
      return {
        protocolVersion: 1,
        actions: Array.from(registry.values(), ({ name, definition }) => ({
          name,
          version: definition.version,
          idempotent: definition.idempotent,
        })),
      };
    },

    async cron(input, runtime) {
      const request = cronRequestV1Schema.parse(input);
      if (jsonByteLength(request.payload) > LIMITS.payloadBytes) {
        return failure(
          request,
          "PAYLOAD_TOO_LARGE",
          "Payload exceeds 16 KiB",
          false,
        );
      }

      const action = registry.get(
        actionKey(request.action, request.actionVersion),
      )?.definition;
      if (!action) {
        return failure(
          request,
          "ACTION_NOT_SUPPORTED",
          "Action or version is not supported",
          false,
        );
      }

      const payload = action.payloadSchema.safeParse(request.payload);
      if (!payload.success) {
        return failure(
          request,
          "INVALID_PAYLOAD",
          "Payload does not match the action schema",
          false,
        );
      }

      const remainingMs = Date.parse(request.deadlineAt) - Date.now();
      if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
        return failure(
          request,
          "DEADLINE_EXCEEDED",
          "Deadline elapsed before action started",
          true,
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort("deadline exceeded"),
        remainingMs,
      );
      try {
        const value = await action.run(payload.data, {
          env: runtime.env,
          ctx: runtime.ctx,
          request,
          signal: controller.signal,
        });
        if (stringByteLength(value.summary) > LIMITS.summaryBytes) {
          return failure(
            request,
            "SUMMARY_TOO_LARGE",
            "Action summary exceeds 1 KiB",
            false,
          );
        }
        if (
          value.output !== undefined &&
          jsonByteLength(value.output) > LIMITS.outputBytes
        ) {
          return failure(
            request,
            "OUTPUT_TOO_LARGE",
            "Action output exceeds 8 KiB",
            false,
          );
        }
        return {
          protocolVersion: 1,
          executionId: request.executionId,
          attemptId: request.attemptId,
          ok: true,
          summary: value.summary,
          ...(value.output === undefined ? {} : { output: value.output }),
          ...(value.targetBuildId === undefined
            ? {}
            : { targetBuildId: value.targetBuildId }),
        };
      } catch (error) {
        if (error instanceof CronError) {
          return failure(
            request,
            error.code,
            boundedErrorMessage(error.message),
            error.retryable,
          );
        }
        console.error(
          JSON.stringify({
            event: "cron_action_unexpected_error",
            executionId: request.executionId,
            attemptId: request.attemptId,
            targetId: request.targetId,
            action: request.action,
          }),
        );
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function actionKey(name: string, version: number): string {
  return `${name}:${version}`;
}

function failure(
  request: CronRequestV1,
  code: string,
  message: string,
  retryable: boolean,
): CronResultV1 {
  return {
    protocolVersion: 1,
    executionId: request.executionId,
    attemptId: request.attemptId,
    ok: false,
    error: {
      code: validErrorCode(code),
      message: boundedErrorMessage(message),
      retryable,
    },
  };
}

function validErrorCode(code: string): string {
  return code.length >= 1 && code.length <= 128
    ? code
    : "INVALID_CRON_ERROR_CODE";
}

function boundedErrorMessage(message: string): string {
  if (stringByteLength(message) <= LIMITS.errorMessageBytes) return message;
  let result = message;
  while (
    result.length > 0 &&
    stringByteLength(`${result}…`) > LIMITS.errorMessageBytes
  ) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}
