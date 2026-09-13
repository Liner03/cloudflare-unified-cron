import { CronEntrypointBase } from "@unified-cron/worker-sdk/entrypoint";
import { createRegistrationClient } from "@unified-cron/worker-sdk/registration";
import { consumeTriggers } from "./queue-trigger";
import { timingSafeEqual } from "node:crypto";
import {
  cronRequestV1Schema,
  type CronResultV1,
} from "@unified-cron/contracts";
import { executeQueueProbe } from "./queue-trigger";

export class CronEntrypoint extends CronEntrypointBase<Env> {
  describe() {
    return Promise.resolve({
      protocolVersion: 1,
      actions: [{ name: "queueProbe", version: 1, idempotent: true }],
    });
  }
  async cron(input: unknown): Promise<CronResultV1> {
    return executeQueueProbeCron(input, this.env);
  }
}

export async function executeQueueProbeCron(
  input: unknown,
  env: Env,
): Promise<CronResultV1> {
  const request = cronRequestV1Schema.parse(input);
  if (request.targetId !== env.TARGET_ID)
    throw new Error("TRIGGER_TARGET_MISMATCH");
  const result = await executeQueueProbe(
    {
      protocolVersion: 2,
      deliveryId: request.executionId,
      scheduleId: request.scheduleId,
      targetId: request.targetId,
      scheduledFor: request.scheduledFor ?? request.requestedAt,
      action: request.action,
      actionVersion: request.actionVersion,
      payload: request.payload,
      idempotencyKey: request.idempotencyKey,
      receiptToken: `ucrr_${"x".repeat(43)}`,
    },
    env,
  );
  return result.status === "succeeded"
    ? {
        protocolVersion: 1,
        executionId: request.executionId,
        attemptId: request.attemptId,
        ok: true,
        summary: result.summary,
        targetBuildId: env.BUILD_ID,
      }
    : {
        protocolVersion: 1,
        executionId: request.executionId,
        attemptId: request.attemptId,
        ok: false,
        error: {
          code: "QUEUE_PROBE_FAILED",
          message: result.summary,
          retryable: false,
        },
      };
}
export function publishQueueRegistration(env: Env) {
  return createRegistrationClient({
    endpoint: env.PLATFORM_REGISTRATION_URL,
    token: env.REGISTRATION_TOKEN,
  }).register({
    protocolVersion: 1,
    registrationRevision: `queue-${env.BUILD_ID}`,
    worker: { label: `Data Worker ${env.TARGET_ID}` },
    actions: [
      {
        name: "queueProbe",
        version: 1,
        label: "Queue probe",
        idempotent: true,
      },
    ],
    schedules: [
      {
        key: "queue-probe",
        name: "Queue probe",
        action: "queueProbe",
        actionVersion: 1,
        cronExpression: "* * * * *",
        retryPolicy: {
          maxAttempts: 1,
          delaysSeconds: [],
          retryOnUnknown: false,
        },
      },
    ],
  });
}
export default {
  queue: consumeTriggers,
  async fetch(request, env): Promise<Response> {
    if (
      new URL(request.url).pathname === "/__test/register" &&
      request.method === "POST"
    ) {
      if (!["test", "staging"].includes(env.APP_ENV))
        return new Response("Forbidden", { status: 403 });
      const provided = new TextEncoder().encode(
        request.headers.get("Authorization") ?? "",
      );
      const expected = new TextEncoder().encode(
        `Bearer ${env.TEST_CONTROL_SECRET}`,
      );
      if (
        !env.TEST_CONTROL_SECRET ||
        provided.byteLength !== expected.byteLength ||
        !timingSafeEqual(provided, expected)
      )
        return new Response("Unauthorized", { status: 401 });
      return Response.json({ data: await publishQueueRegistration(env) });
    }
    return Response.json({
      service: "queue-website",
      execution: "independent queue consumer",
    });
  },
} satisfies ExportedHandler<Env>;
