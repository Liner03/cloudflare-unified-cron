import { z } from "zod";

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      )
      .optional(),
  }),
});

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function apiGet<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  signal?: AbortSignal,
): Promise<z.output<Schema>> {
  return request(path, schema, {
    method: "GET",
    ...(signal === undefined ? {} : { signal }),
  });
}

export async function apiMutate<Schema extends z.ZodType>(
  path: string,
  body: unknown,
  schema: Schema,
  options: {
    method?: "POST" | "PATCH";
    revision?: number;
    idempotencyKey?: string;
  } = {},
): Promise<z.output<Schema>> {
  return request(path, schema, {
    method: options.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": options.idempotencyKey ?? `ui:${crypto.randomUUID()}`,
      ...(options.revision === undefined
        ? {}
        : { "If-Match": `"${options.revision}"` }),
    },
    body: JSON.stringify(body),
  });
}

async function request<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init: RequestInit,
): Promise<z.output<Schema>> {
  const response = await fetch(path, { ...init, credentials: "same-origin" });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ApiClientError(
      response.status,
      "INVALID_API_RESPONSE",
      "服务器返回了非 JSON 响应",
      "unknown",
    );
  }
  if (!response.ok) {
    const error = errorEnvelopeSchema.safeParse(value);
    if (error.success) {
      throw new ApiClientError(
        response.status,
        error.data.error.code,
        error.data.error.message,
        error.data.error.requestId,
      );
    }
    throw new ApiClientError(
      response.status,
      "API_ERROR",
      `请求失败（HTTP ${response.status}）`,
      "unknown",
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiClientError(
      response.status,
      "INVALID_API_SCHEMA",
      "服务器响应结构与当前控制台不兼容",
      "unknown",
    );
  }
  return parsed.data;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误";
}
