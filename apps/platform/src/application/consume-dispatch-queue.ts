import {
  triggerMessageSchema,
  type CronRequestV1,
  type CronResultV1,
  type TriggerResult,
} from "@unified-cron/contracts";
import { TriggerDeliveryRepository } from "../infrastructure/d1/trigger-delivery-repository";
import { ServiceBindingAdapter } from "../infrastructure/rpc/service-binding-adapter";
import { getTargetManifest } from "../targets.manifest";

export async function consumeDispatchQueue(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  if (batch.queue !== env.DISPATCH_QUEUE_NAME)
    throw new Error("UNEXPECTED_DISPATCH_QUEUE");
  const deliveries = new TriggerDeliveryRepository(env.DB);
  const adapter = new ServiceBindingAdapter(env);
  for (const message of batch.messages) {
    let deliveryId: string | null = null;
    try {
      const job = triggerMessageSchema.parse(message.body);
      deliveryId = job.deliveryId;
      const target = getTargetManifest(job.targetId);
      if (!target?.delivery) throw new Error("DISPATCH_TARGET_NOT_CONFIGURED");
      const attemptId = crypto.randomUUID();
      const result = await adapter.execute(
        target,
        toCronRequest(job, attemptId, message.attempts),
      );
      await deliveries.report(
        job.deliveryId,
        job.receiptToken,
        toTriggerResult(result),
        Date.now(),
      );
      message.ack();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "dispatch_consumer_failed",
          deliveryId,
          errorName:
            error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
          errorMessage:
            error instanceof Error
              ? error.message
                  .replace(
                    /\b(?:ucrt|ucrr|ucas)_[A-Za-z0-9_-]+\b/g,
                    "[REDACTED]",
                  )
                  .slice(0, 256)
              : "Unknown error",
        }),
      );
      message.retry({ delaySeconds: 60 });
    }
  }
}

export function toCronRequest(
  job: ReturnType<typeof triggerMessageSchema.parse>,
  attemptId: string,
  attemptNumber: number,
): CronRequestV1 {
  const now = Date.now();
  return {
    protocolVersion: 1,
    executionId: job.deliveryId,
    attemptId,
    scheduleId: job.scheduleId,
    targetId: job.targetId,
    action: job.action,
    actionVersion: job.actionVersion,
    source: "cron",
    dispatchReason: attemptNumber > 1 ? "automatic_retry" : "initial",
    attemptNumber,
    scheduledFor: job.scheduledFor,
    requestedAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + 30_000).toISOString(),
    idempotencyKey: job.idempotencyKey,
    payload: job.payload,
  };
}

export function toTriggerResult(result: CronResultV1): TriggerResult {
  return result.ok
    ? { status: "succeeded", summary: result.summary }
    : {
        status: "failed",
        summary: `${result.error.code}: ${result.error.message}`.slice(0, 1024),
      };
}
