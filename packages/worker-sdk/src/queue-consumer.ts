import {
  triggerMessageSchema,
  triggerResultSchema,
  type TriggerMessage,
  type TriggerResult,
} from "@unified-cron/contracts";

/** Runs in the website Worker, independently from the scheduler invocation.
 * execute must atomically deduplicate business effects AND retain the result by idempotencyKey.
 * A callback failure retries delivery of the saved result, not business effects.
 */
export function createTriggerConsumer<Env>(options: {
  targetId: string;
  queueName: string;
  execute: (message: TriggerMessage, env: Env) => Promise<TriggerResult>;
  report?: (
    message: TriggerMessage,
    result: TriggerResult,
    env: Env,
  ) => Promise<void>;
  concurrency?: number;
}) {
  const concurrency = options.concurrency ?? 5;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20)
    throw new Error("consumer concurrency must be 1..20");
  return async (batch: MessageBatch<unknown>, env: Env): Promise<void> => {
    if (batch.queue !== options.queueName)
      throw new Error("UNEXPECTED_TRIGGER_QUEUE");
    let index = 0;
    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, batch.messages.length) },
        async () => {
          while (index < batch.messages.length) {
            const message = batch.messages[index++];
            if (!message) return;
            let deliveryId: string | null = null;
            try {
              const job = triggerMessageSchema.parse(message.body);
              deliveryId = job.deliveryId;
              if (job.targetId !== options.targetId)
                throw new Error("TRIGGER_TARGET_MISMATCH");
              const result = triggerResultSchema.parse(
                await options.execute(job, env),
              );
              if (options.report) await options.report(job, result, env);
              message.ack();
            } catch (error) {
              // Never log the body: it includes a per-delivery receipt capability.
              console.error(
                JSON.stringify({
                  event: "trigger_consumer_failed",
                  targetId: options.targetId,
                  queueName: batch.queue,
                  deliveryId,
                  ...safeConsumerError(error),
                }),
              );
              message.retry({ delaySeconds: 60 });
            }
          }
        },
      ),
    );
  };
}

function safeConsumerError(error: unknown): {
  errorName: string;
  errorMessage: string;
} {
  if (!(error instanceof Error))
    return { errorName: "UnknownError", errorMessage: "Unknown error" };
  if (error.name === "ZodError")
    return {
      errorName: "ZodError",
      errorMessage: "Trigger message or result validation failed",
    };
  return {
    errorName: error.name.slice(0, 80),
    errorMessage: error.message
      .replace(/\b(?:ucrt|ucrr|ucas)_[A-Za-z0-9_-]+\b/g, "[REDACTED]")
      .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
      .slice(0, 256),
  };
}

export async function reportTriggerResult(
  origin: string,
  job: TriggerMessage,
  result: TriggerResult,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const url = new URL(origin);
  if (
    (url.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("INVALID_RESULT_ORIGIN");
  const response = await fetcher(
    new URL(
      `/api/v1/delivery-receipts/${encodeURIComponent(job.deliveryId)}`,
      url,
    ),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${job.receiptToken}`,
      },
      body: JSON.stringify(triggerResultSchema.parse(result)),
      signal: AbortSignal.timeout(10000),
      // Workers does not implement redirect="error". Manual preserves the
      // no-follow security boundary; the non-2xx check below rejects 3xx.
      redirect: "manual",
    },
  );
  await response.body?.cancel();
  if (!response.ok) throw new Error(`RESULT_REPORT_FAILED:${response.status}`);
}
