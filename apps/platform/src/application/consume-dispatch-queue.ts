import {
  triggerMessageSchema,
  type CronRequestV1,
  type CronResultV1,
  type TriggerResult,
} from "@unified-cron/contracts";
import { TriggerDeliveryRepository } from "../infrastructure/d1/trigger-delivery-repository";
import { ServiceBindingAdapter } from "../infrastructure/rpc/service-binding-adapter";
import { getTargetManifest } from "../targets.manifest";

export const QUEUE_TARGET_DEADLINE_MS = 14 * 60_000;

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
    let attemptId: string | null = null;
    let businessStarted = false;
    try {
      const job = triggerMessageSchema.parse(message.body);
      deliveryId = job.deliveryId;
      const target = getTargetManifest(job.targetId);
      if (!target?.delivery) throw new Error("DISPATCH_TARGET_NOT_CONFIGURED");
      const execute = adapter.prepareExecution(target);
      attemptId = crypto.randomUUID();
      const attempt = await deliveries.consumerStarted(
        job.deliveryId,
        attemptId,
        Date.now(),
      );
      if (attempt === null) {
        message.ack();
        continue;
      }
      businessStarted = true;
      const result = await execute(
        toCronRequest(
          job,
          attemptId,
          attempt.attemptCount === null
            ? message.attempts
            : attempt.attemptNumber,
        ),
      );
      await deliveries.report(
        job.deliveryId,
        job.receiptToken,
        toTriggerResult(result),
        Date.now(),
        attemptId,
      );
      message.ack();
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
              .replace(/\b(?:ucrt|ucrr|ucas)_[A-Za-z0-9_-]+\b/g, "[REDACTED]")
              .slice(0, 256)
          : "Unknown error";
      if (deliveryId !== null) {
        try {
          if (!businessStarted && attemptId !== null)
            await deliveries.consumerNotStarted(
              deliveryId,
              attemptId,
              Date.now(),
            );
          await deliveries.consumerFailed(
            deliveryId,
            errorMessage,
            Date.now(),
            attemptId,
          );
        } catch {
          console.error(
            JSON.stringify({
              event: "dispatch_observation_failed",
              deliveryId,
            }),
          );
        }
      }
      console.error(
        JSON.stringify({
          event: "dispatch_consumer_failed",
          deliveryId,
          errorName:
            error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
          errorMessage,
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
    deadlineAt: new Date(now + QUEUE_TARGET_DEADLINE_MS).toISOString(),
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
