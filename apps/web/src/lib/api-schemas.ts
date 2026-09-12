import { z } from "zod";

export const executionSummarySchema = z.object({
  id: z.string(),
  scheduleId: z.string(),
  targetId: z.string(),
  source: z.string(),
  status: z.string(),
  reasonCode: z.string().nullable(),
  scheduledFor: z.string().nullable(),
  attemptCount: z.number(),
  createdAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  scheduleName: z.string().optional(),
  availableAt: z.string().nullable().optional(),
});

export type ExecutionSummary = z.infer<typeof executionSummarySchema>;

export const scheduleBlockingReasonSchema = z.enum([
  "declared_disabled",
  "operator_paused",
  "invalid_configuration",
  "target_disabled",
  "dispatch_paused",
]);

export const scheduleSummarySchema = z.object({
  deliveryMode: z.enum(["rpc", "queue"]).default("rpc"),
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  targetId: z.string(),
  isDemo: z.boolean().optional(),
  action: z.string(),
  actionVersion: z.number(),
  cronExpression: z.string(),
  timezone: z.string(),
  enabled: z.boolean(),
  effectiveEnabled: z.boolean(),
  blockingReasons: z.array(scheduleBlockingReasonSchema),
  declaredEnabled: z.boolean(),
  operatorPaused: z.boolean(),
  revision: z.number(),
  nextRunAt: z.string().nullable(),
  lastExecution: z
    .object({ status: z.string(), at: z.string().nullable() })
    .nullable(),
});

export type ScheduleSummary = z.infer<typeof scheduleSummarySchema>;

export const overviewSchema = z.object({
  data: z.object({
    schedules: z.object({
      active_schedules: z.number().nullable(),
      total_schedules: z.number().nullable(),
    }),
    executions24h: z.array(z.object({ status: z.string(), count: z.number() })),
    recentExecutions: z.array(executionSummarySchema),
    system: z
      .object({
        dispatch_paused: z.number(),
        last_successful_tick_at: z.number().nullable(),
        last_tick_outcome: z.string().nullable(),
        last_tick_scheduled_at: z.number().nullable(),
        build_version: z.string().nullable(),
      })
      .passthrough()
      .nullable(),
    successRates: z.array(
      z.object({
        window: z.enum(["24h", "7d", "30d"]),
        from: z.string(),
        to: z.string(),
        execution: z.object({
          numerator: z.number(),
          denominator: z.number(),
          rate: z.number().nullable(),
        }),
        firstAttempt: z.object({
          numerator: z.number(),
          denominator: z.number(),
          rate: z.number().nullable(),
        }),
      }),
    ),
  }),
  meta: z.object({ serverTime: z.string() }),
});

export const schedulesSchema = z.object({
  data: z.array(scheduleSummarySchema),
});

export const scheduleDetailSchema = z.object({
  data: scheduleSummarySchema.omit({ lastExecution: true }).extend({
    archivedAt: z.string().nullable(),
    retiredAt: z.string().nullable(),
    managedByRegistration: z.boolean(),
    payload: z.unknown(),
    retryPolicy: z.object({
      maxAttempts: z.number(),
      delaysSeconds: z.array(z.number()),
      retryOnUnknown: z.boolean(),
    }),
    timeoutMs: z.number(),
    misfirePolicy: z.string(),
    misfireGraceSeconds: z.number(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    recentExecutions: z.array(executionSummarySchema),
  }),
});

export const targetsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      binding: z.string(),
      service: z.string(),
      entrypoint: z.string(),
      protocolVersion: z.number(),
      manifestRevision: z.string(),
      isDemo: z.boolean().optional(),
      actions: z.array(
        z.object({
          name: z.string(),
          version: z.number(),
          label: z.string(),
          description: z.string().optional(),
          idempotent: z.boolean(),
          examplePayload: z.unknown().optional(),
        }),
      ),
      registration: z
        .object({
          revision: z.string(),
          workerLabel: z.string(),
          registeredAt: z.string(),
        })
        .nullable(),
      state: z
        .object({
          enabled: z.number(),
          last_check_at: z.number().nullable(),
          last_check_status: z.string().nullable(),
          last_check_message: z.string().nullable(),
        })
        .passthrough()
        .nullable(),
    }),
  ),
});

export type Target = z.infer<typeof targetsSchema>["data"][number];

export const authSessionSchema = z.object({
  data: z.object({
    authenticated: z.boolean(),
    username: z.string().nullable(),
    expiresAt: z.string().optional(),
  }),
});

const registrationTokenSchema = z.object({
  id: z.string(),
  targetId: z.string(),
  label: z.string(),
  scope: z.literal("registration:write"),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  rotatedFromId: z.string().nullable(),
  replacedById: z.string().nullable(),
  registration: z
    .object({
      revision: z.string(),
      workerLabel: z.string().nullable(),
      registeredAt: z.string().nullable(),
    })
    .nullable(),
});

export type RegistrationToken = z.infer<typeof registrationTokenSchema>;

export const registrationTokensSchema = z.object({
  data: z.array(registrationTokenSchema),
});

export const issuedRegistrationTokenSchema = z.object({
  data: z.object({
    id: z.string(),
    targetId: z.string(),
    label: z.string(),
    token: z.string(),
    expiresAt: z.string(),
    rotatedFromId: z.string().optional(),
  }),
});

export const executionsSchema = z.object({
  data: z.array(executionSummarySchema),
  meta: z.object({ nextCursor: z.string().nullable(), serverTime: z.string() }),
});

const attemptSchema = z.object({
  id: z.string(),
  number: z.number(),
  reason: z.string(),
  status: z.string(),
  startedAt: z.string().nullable(),
  deadlineAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  result: z.unknown().nullable(),
  error: z.unknown().nullable(),
  targetBuildId: z.string().nullable(),
});

export const executionDetailSchema = z.object({
  data: z.object({
    id: z.string(),
    scheduleId: z.string(),
    targetId: z.string(),
    source: z.string(),
    scheduledFor: z.string().nullable(),
    parentExecutionId: z.string().nullable(),
    scheduleRevision: z.number(),
    snapshot: z.object({ targetActionIdempotent: z.boolean() }).passthrough(),
    status: z.string(),
    reasonCode: z.string().nullable(),
    availableAt: z.string().nullable(),
    nextAttemptReason: z.string(),
    attemptCount: z.number(),
    attemptLimit: z.number(),
    maxAutoAttempts: z.number(),
    retryDeadlineAt: z.string().nullable(),
    leaseExpiresAt: z.string().nullable(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    result: z.unknown().nullable(),
    lastError: z.unknown().nullable(),
    operatorResolvedAt: z.string().nullable(),
    operatorResolutionNote: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    attempts: z.array(attemptSchema),
  }),
});

export const systemSchema = z.object({
  data: z
    .object({
      schedulerSettings: z.record(z.string(), z.number()).optional(),
      settingsRevision: z.number().optional(),
      dispatch_paused: z.number(),
      last_tick_id: z.string().nullable(),
      last_tick_scheduled_at: z.number().nullable(),
      last_tick_started_at: z.number().nullable(),
      last_tick_finished_at: z.number().nullable(),
      last_successful_tick_at: z.number().nullable(),
      last_tick_outcome: z.string().nullable(),
      last_tick_error: z.string().nullable(),
      build_version: z.string().nullable(),
      protocolVersion: z.number(),
      budgets: z.record(z.string(), z.number()),
    })
    .passthrough(),
  meta: z.object({ serverTime: z.string() }),
});

export const idMutationSchema = z.object({
  data: z.object({ id: z.string(), revision: z.number() }),
});

export const executionMutationSchema = z.object({
  data: z.object({ executionId: z.string(), status: z.string() }).passthrough(),
});

export const stateMutationSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

export const previewSchema = z.object({
  data: z.array(z.object({ utc: z.string(), local: z.string() })),
});

export const auditSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      actor: z.string(),
      action: z.string(),
      entity_type: z.string(),
      entity_id: z.string(),
      changes: z.unknown(),
      createdAt: z.string().nullable(),
    }),
  ),
  meta: z.object({ nextCursor: z.string().nullable() }),
});
