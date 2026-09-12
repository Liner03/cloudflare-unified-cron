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
            try {
              const job = triggerMessageSchema.parse(message.body);
              if (job.targetId !== options.targetId)
                throw new Error("TRIGGER_TARGET_MISMATCH");
              const result = triggerResultSchema.parse(
                await options.execute(job, env),
              );
              if (options.report) await options.report(job, result, env);
              message.ack();
            } catch {
              // Never log the body: it includes a per-delivery receipt capability.
              message.retry({ delaySeconds: 60 });
            }
          }
        },
      ),
    );
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
      redirect: "error",
    },
  );
  await response.body?.cancel();
  if (!response.ok) throw new Error(`RESULT_REPORT_FAILED:${response.status}`);
}
