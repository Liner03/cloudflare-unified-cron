import { createCronHandler, defineAction } from "@unified-cron/worker-sdk";
import { createRegistrationClient } from "@unified-cron/worker-sdk/registration";
import { CronEntrypointBase } from "@unified-cron/worker-sdk/entrypoint";
import { jsonValueSchema } from "@unified-cron/contracts";
import { z } from "zod";

const cronHandler = createCronHandler<Env>({
  healthCheck: defineAction({
    version: 1,
    idempotent: true,
    payloadSchema: z.object({}),
    run(_payload, context) {
      return Promise.resolve({
        summary: "Worker data is healthy",
        targetBuildId: context.env.BUILD_ID,
      });
    },
  }),
  syncUsers: defineAction({
    version: 1,
    idempotent: true,
    payloadSchema: z.object({ source: z.string().min(1).max(64) }),
    async run(payload, context) {
      if (context.signal.aborted) throw context.signal.reason;
      const stored = JSON.stringify({ processed: 1, source: payload.source });
      await context.env.BUSINESS_DB.prepare(
        `INSERT INTO idempotent_results (idempotency_key, action, result_json, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      )
        .bind(
          context.request.idempotencyKey,
          context.request.action,
          stored,
          Date.now(),
        )
        .run();
      const row = await context.env.BUSINESS_DB.prepare(
        `SELECT result_json FROM idempotent_results WHERE idempotency_key = ? AND action = ?`,
      )
        .bind(context.request.idempotencyKey, context.request.action)
        .first<{ result_json: string }>();
      if (!row) throw new Error("Idempotent result was not persisted");
      return {
        summary: "Users synchronized",
        output: jsonValueSchema.parse(JSON.parse(row.result_json)),
        targetBuildId: context.env.BUILD_ID,
      };
    },
  }),
});

export function publishRegistration(env: Env) {
  return createRegistrationClient({
    endpoint: env.PLATFORM_REGISTRATION_URL,
    token: env.REGISTRATION_TOKEN,
  }).register({
    protocolVersion: 1,
    registrationRevision: env.BUILD_ID,
    worker: { label: "Data Worker" },
    actions: [
      {
        name: "healthCheck",
        version: 1,
        label: "健康检查",
        description: "无副作用检查示例 Worker",
        idempotent: true,
        examplePayload: {},
      },
      {
        name: "syncUsers",
        version: 1,
        label: "同步用户",
        description: "展示业务侧持久化幂等的示例 Action",
        idempotent: true,
        examplePayload: { source: "crm" },
      },
    ],
    schedules: [
      {
        key: "health-check",
        name: "Worker 健康检查",
        description: "由 Data Worker 完整声明",
        action: "healthCheck",
        actionVersion: 1,
        cronExpression: "*/5 * * * *",
        timezone: "UTC",
        enabled: true,
        payload: {},
        retryPolicy: {
          maxAttempts: 1,
          delaysSeconds: [],
          retryOnUnknown: false,
        },
      },
      {
        key: "sync-users",
        name: "同步用户",
        description: "每小时从 CRM 收敛同步用户",
        action: "syncUsers",
        actionVersion: 1,
        cronExpression: "0 * * * *",
        timezone: "UTC",
        enabled: true,
        payload: { source: "crm" },
        retryPolicy: {
          maxAttempts: 3,
          delaysSeconds: [60, 300],
          retryOnUnknown: true,
        },
      },
    ],
  });
}

export class CronEntrypoint extends CronEntrypointBase<Env> {
  cron(input: unknown): Promise<unknown> {
    return cronHandler.cron(input, { env: this.env, ctx: this.ctx });
  }

  describe(): Promise<unknown> {
    return Promise.resolve(cronHandler.describe());
  }
}

export default {
  fetch(): Response {
    return Response.json({ service: "worker-data", websitePreserved: true });
  },
} satisfies ExportedHandler<Env>;
