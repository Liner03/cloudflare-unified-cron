import { WorkerEntrypoint } from "cloudflare:workers";
import { createCronHandler, defineAction } from "@unified-cron/worker-sdk";
import { z } from "zod";

const cronHandler = createCronHandler<Env>({
  healthCheck: defineAction({
    version: 1,
    idempotent: true,
    payloadSchema: z.object({}),
    async run(_payload, context) {
      return { summary: "Worker data is healthy", targetBuildId: context.env.BUILD_ID };
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
        .bind(context.request.idempotencyKey, context.request.action, stored, Date.now())
        .run();
      const row = await context.env.BUSINESS_DB.prepare(
        `SELECT result_json FROM idempotent_results WHERE idempotency_key = ? AND action = ?`,
      )
        .bind(context.request.idempotencyKey, context.request.action)
        .first<{ result_json: string }>();
      if (!row) throw new Error("Idempotent result was not persisted");
      return {
        summary: "Users synchronized",
        output: JSON.parse(row.result_json),
        targetBuildId: context.env.BUILD_ID,
      };
    },
  }),
});

export class CronEntrypoint extends WorkerEntrypoint<Env> {
  cron(input: unknown) {
    return cronHandler.cron(input, { env: this.env, ctx: this.ctx });
  }

  describe() {
    return cronHandler.describe();
  }
}

export default {
  fetch(): Response {
    return Response.json({ service: "worker-data", websitePreserved: true });
  },
} satisfies ExportedHandler<Env>;
