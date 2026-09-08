import { z } from "zod";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const cronRequestV1Schema = z.object({
  protocolVersion: z.literal(1),
  executionId: z.string().min(1).max(128),
  attemptId: z.string().min(1).max(128),
  scheduleId: z.string().min(1).max(128),
  targetId: z.string().min(1).max(128),
  action: z.string().min(1).max(128),
  actionVersion: z.number().int().min(1),
  source: z.enum(["cron", "manual", "rerun"]),
  dispatchReason: z.enum(["initial", "automatic_retry", "operator_retry"]),
  attemptNumber: z.number().int().min(1).max(10),
  scheduledFor: z.iso.datetime().nullable(),
  requestedAt: z.iso.datetime(),
  deadlineAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1).max(256),
  payload: jsonValueSchema,
});

export type CronRequestV1 = z.infer<typeof cronRequestV1Schema>;

const cronResultIdentitySchema = z.object({
  protocolVersion: z.literal(1),
  executionId: z.string().min(1).max(128),
  attemptId: z.string().min(1).max(128),
  targetBuildId: z.string().max(256).optional(),
});

export const cronResultV1Schema = z.discriminatedUnion("ok", [
  cronResultIdentitySchema.extend({
    ok: z.literal(true),
    summary: z.string(),
    output: jsonValueSchema.optional(),
  }),
  cronResultIdentitySchema.extend({
    ok: z.literal(false),
    error: z.object({
      code: z.string().min(1).max(128),
      message: z.string(),
      retryable: z.boolean(),
    }),
  }),
]);

export type CronResultV1 = z.infer<typeof cronResultV1Schema>;

export const retryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(5),
    delaysSeconds: z.array(z.number().int().min(60).max(86_400)).max(4),
    retryOnUnknown: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.delaysSeconds.length !== value.maxAttempts - 1) {
      ctx.addIssue({
        code: "custom",
        path: ["delaysSeconds"],
        message: "delaysSeconds 必须恰好包含 maxAttempts - 1 项",
      });
    }
  });

export type RetryPolicy = z.infer<typeof retryPolicySchema>;

export interface TargetManifest {
  id: string;
  label: string;
  binding: string;
  service: string;
  entrypoint: "CronEntrypoint";
  protocolVersion: 1;
  manifestRevision: string;
  actions: Array<{
    name: string;
    version: number;
    label: string;
    description?: string;
    idempotent: boolean;
    examplePayload?: JsonValue;
  }>;
}

export interface CronTargetDescriptionV1 {
  protocolVersion: 1;
  actions: Array<{
    name: string;
    version: number;
    idempotent: boolean;
  }>;
}

export const cronTargetDescriptionV1Schema = z.object({
  protocolVersion: z.literal(1),
  actions: z.array(
    z.object({
      name: z.string().min(1).max(128),
      version: z.number().int().min(1),
      idempotent: z.boolean(),
    }),
  ),
});

export const LIMITS = {
  payloadBytes: 16 * 1024,
  summaryBytes: 1024,
  outputBytes: 8 * 1024,
  errorMessageBytes: 2 * 1024,
  requestBodyBytes: 64 * 1024,
} as const;

const encoder = new TextEncoder();

export function jsonByteLength(value: JsonValue): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

export function stringByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function assertCronResultIdentity(
  result: CronResultV1,
  request: CronRequestV1,
): void {
  if (
    result.protocolVersion !== request.protocolVersion ||
    result.executionId !== request.executionId ||
    result.attemptId !== request.attemptId
  ) {
    throw new Error("RPC_RESULT_IDENTITY_MISMATCH");
  }
}

export function assertResultWithinLimits(result: CronResultV1): void {
  if (result.ok) {
    if (stringByteLength(result.summary) > LIMITS.summaryBytes) {
      throw new Error("RPC_RESULT_SUMMARY_TOO_LARGE");
    }
    if (
      result.output !== undefined &&
      jsonByteLength(result.output) > LIMITS.outputBytes
    ) {
      throw new Error("RPC_RESULT_OUTPUT_TOO_LARGE");
    }
  } else if (
    stringByteLength(result.error.message) > LIMITS.errorMessageBytes
  ) {
    throw new Error("RPC_RESULT_ERROR_TOO_LARGE");
  }
}
