import {
  LIMITS,
  cronRequestV1Schema,
  jsonByteLength,
  stringByteLength,
  workerRegistrationV1Schema,
  type CronRequestV1,
  type CronResultV1,
  type CronTargetDescriptionV1,
  type JsonValue,
  type WorkerRegistrationV1,
  type WorkerRegistrationV1Input,
} from "@unified-cron/contracts";
import { z } from "zod";

const registrationResponseSchema = z.object({
  data: z.object({
    targetId: z.string(),
    registrationRevision: z.string(),
    unchanged: z.boolean(),
    actions: z.number().int().min(0),
    schedules: z.number().int().min(0),
    retiredSchedules: z.number().int().min(0),
    registeredAt: z.iso.datetime(),
  }),
});

const registrationErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});

const REGISTRATION_RESPONSE_LIMIT_BYTES = 64 * 1024;

export type RegistrationResult = z.infer<
  typeof registrationResponseSchema
>["data"];

export class RegistrationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "RegistrationError";
  }
}

export interface RegistrationClient {
  register(declaration: WorkerRegistrationV1Input): Promise<RegistrationResult>;
}

/** Creates a write-only client for publishing this Worker's complete desired state. */
export function createRegistrationClient(options: {
  endpoint: string;
  token: string;
  fetcher?: typeof fetch;
}): RegistrationClient {
  const endpoint = validateRegistrationEndpoint(options.endpoint);
  if (!/^ucrt_[A-Za-z0-9_-]{43}$/.test(options.token)) {
    throw new Error("Registration token has an invalid format");
  }
  const fetcher = options.fetcher ?? fetch;
  return {
    async register(value) {
      const declaration = workerRegistrationV1Schema.parse(value);
      const response = await fetcher(endpoint, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${options.token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": await registrationIdempotencyKey(declaration),
        },
        body: JSON.stringify(declaration),
      });
      const body = await readBoundedJson(response);
      if (!response.ok) {
        const parsed = registrationErrorSchema.safeParse(body);
        throw new RegistrationError(
          response.status,
          parsed.success ? parsed.data.error.code : "REGISTRATION_FAILED",
          parsed.success
            ? parsed.data.error.message
            : `Registration failed with HTTP ${response.status}`,
          parsed.success ? parsed.data.error.requestId : null,
        );
      }
      const parsed = registrationResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new RegistrationError(
          response.status,
          "INVALID_REGISTRATION_RESPONSE",
          "Registration endpoint returned an incompatible response",
          null,
        );
      }
      return parsed.data.data;
    },
  };
}

function validateRegistrationEndpoint(value: string): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Registration endpoint must use HTTPS");
  }
  if (url.username || url.password || url.hash) {
    throw new Error(
      "Registration endpoint must not contain credentials or a hash",
    );
  }
  return url.toString();
}

async function registrationIdempotencyKey(
  declaration: WorkerRegistrationV1,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${declaration.registrationRevision}:${JSON.stringify(declaration)}`,
    ),
  );
  const suffix = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `registration:${suffix}`;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("Content-Length"));
  if (
    Number.isFinite(declared) &&
    declared > REGISTRATION_RESPONSE_LIMIT_BYTES
  ) {
    throw new RegistrationError(
      response.status,
      "REGISTRATION_RESPONSE_TOO_LARGE",
      "Registration response exceeded 64 KiB",
      null,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > REGISTRATION_RESPONSE_LIMIT_BYTES) {
      await reader.cancel("registration response too large");
      throw new RegistrationError(
        response.status,
        "REGISTRATION_RESPONSE_TOO_LARGE",
        "Registration response exceeded 64 KiB",
        null,
      );
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text === "" ? null : JSON.parse(text);
  } catch {
    throw new RegistrationError(
      response.status,
      "INVALID_REGISTRATION_RESPONSE",
      "Registration endpoint returned invalid JSON",
      null,
    );
  }
}

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
