import { z } from "zod";
import { jsonValueSchema, type JsonValue } from "./json";
export { jsonValueSchema, type JsonValue } from "./json";
import { normalizeCronDialect } from "./cron-dialect";
export { normalizeCronDialect } from "./cron-dialect";
export {
  triggerMessageSchema,
  triggerResultSchema,
  type TriggerMessage,
  type TriggerResult,
} from "./trigger";

export {
  BoundedJsonError,
  readBoundedJson,
  type BoundedJsonErrorReason,
  type BoundedJsonResult,
} from "./bounded-json";

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
  .strict()
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

const registrationActionSchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    version: z.number().int().min(1),
    label: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).default(""),
    idempotent: z.boolean(),
    examplePayload: jsonValueSchema.optional(),
  })
  .strict();

const registrationScheduleSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).default(""),
    action: z.string().trim().min(1).max(128),
    actionVersion: z.number().int().min(1),
    cronExpression: z.string().trim().min(1).max(128),
    cronDialect: z.enum(["unix", "cloudflare"]).optional(),
    timezone: z.string().trim().min(1).max(128).default("UTC"),
    enabled: z.boolean().default(true),
    payload: jsonValueSchema.default({}),
    retryPolicy: retryPolicySchema,
    timeoutMs: z.number().int().min(1000).max(30_000).default(30_000),
    misfirePolicy: z.enum(["coalesce", "skip"]).default("coalesce"),
    misfireGraceSeconds: z.number().int().min(0).max(86_400).default(300),
  })
  .strict()
  .transform(({ cronDialect, ...schedule }, ctx) => {
    try {
      return {
        ...schedule,
        cronExpression: normalizeCronDialect(
          schedule.cronExpression,
          cronDialect,
        ),
      };
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        path: ["cronExpression"],
        message: error instanceof Error ? error.message : "Cron 方言错误",
      });
      return z.NEVER;
    }
  });

export const workerRegistrationV1Schema = z
  .object({
    protocolVersion: z.literal(1),
    registrationRevision: z.string().trim().min(1).max(128),
    worker: z.object({ label: z.string().trim().min(1).max(100) }).strict(),
    actions: z.array(registrationActionSchema).max(100),
    schedules: z.array(registrationScheduleSchema).max(1000),
  })
  .strict()
  .superRefine((value, context) => {
    const actionKeys = new Set<string>();
    for (const action of value.actions) {
      const key = `${action.name}:${action.version}`;
      if (actionKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["actions"],
          message: `duplicate action ${key}`,
        });
      }
      actionKeys.add(key);
    }
    const scheduleKeys = new Set<string>();
    for (const schedule of value.schedules) {
      if (scheduleKeys.has(schedule.key)) {
        context.addIssue({
          code: "custom",
          path: ["schedules"],
          message: `duplicate schedule key ${schedule.key}`,
        });
      }
      scheduleKeys.add(schedule.key);
      const actionKey = `${schedule.action}:${schedule.actionVersion}`;
      if (!actionKeys.has(actionKey)) {
        context.addIssue({
          code: "custom",
          path: ["schedules"],
          message: `schedule ${schedule.key} references undeclared action ${actionKey}`,
        });
        continue;
      }
      const action = value.actions.find(
        (candidate) =>
          candidate.name === schedule.action &&
          candidate.version === schedule.actionVersion,
      );
      if (
        action !== undefined &&
        !action.idempotent &&
        (schedule.retryPolicy.maxAttempts > 1 ||
          schedule.retryPolicy.retryOnUnknown)
      ) {
        context.addIssue({
          code: "custom",
          path: ["schedules"],
          message: `schedule ${schedule.key} cannot retry a non-idempotent action`,
        });
      }
    }
  });

export type WorkerRegistrationV1 = z.infer<typeof workerRegistrationV1Schema>;
export type WorkerRegistrationV1Input = z.input<
  typeof workerRegistrationV1Schema
>;

export interface TargetManifest {
  id: string;
  label: string;
  binding: string;
  service: string;
  entrypoint: "CronEntrypoint";
  protocolVersion: 1;
  manifestRevision: string;
  delivery?: { mode: "queue"; binding: string; queue: string } | undefined;
}

export const targetManifestSchema = z
  .object({
    id: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    label: z.string().min(1).max(100),
    binding: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    service: z.string().min(1),
    entrypoint: z.literal("CronEntrypoint"),
    protocolVersion: z.literal(1),
    manifestRevision: z.string().min(1),
    delivery: z
      .object({
        mode: z.literal("queue"),
        binding: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
        queue: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

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
