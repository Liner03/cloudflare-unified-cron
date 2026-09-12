import {
  createTriggerConsumer,
  reportTriggerResult,
} from "@unified-cron/worker-sdk";
import {
  triggerResultSchema,
  type TriggerMessage,
  type TriggerResult,
} from "@unified-cron/contracts";

/** Example business transaction: the result and one effect commit together. */
export async function executeQueueProbe(
  job: TriggerMessage,
  env: Env,
): Promise<TriggerResult> {
  if (job.action !== "queueProbe" || job.actionVersion !== 1)
    return { status: "failed", summary: "Unsupported queue Action" };
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify([job.action, job.actionVersion, job.payload]),
        ),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const result: TriggerResult = {
    status: "succeeded",
    summary: "Website Worker committed one idempotent business effect",
  };
  await env.BUSINESS_DB.batch([
    env.BUSINESS_DB.prepare(
      "INSERT INTO queue_trigger_results(idempotency_key,payload_hash,result_json,created_at) VALUES (?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING",
    ).bind(job.idempotencyKey, hash, JSON.stringify(result), Date.now()),
    env.BUSINESS_DB.prepare(
      "INSERT INTO queue_trigger_effects(idempotency_key,created_at) SELECT ?,? WHERE changes()=1",
    ).bind(job.idempotencyKey, Date.now()),
  ]);
  const stored = await env.BUSINESS_DB.prepare(
    "SELECT payload_hash,result_json FROM queue_trigger_results WHERE idempotency_key=?",
  )
    .bind(job.idempotencyKey)
    .first<{ payload_hash: string; result_json: string }>();
  if (!stored || stored.payload_hash !== hash)
    throw new Error("BUSINESS_IDEMPOTENCY_CONFLICT");
  return triggerResultSchema.parse(JSON.parse(stored.result_json));
}

export function consumeTriggers(batch: MessageBatch<unknown>, env: Env) {
  return createTriggerConsumer<Env>({
    targetId: env.TARGET_ID,
    queueName: env.TRIGGER_QUEUE_NAME,
    execute: executeQueueProbe,
    report: (job, result, runtime) =>
      reportTriggerResult(
        new URL(runtime.PLATFORM_REGISTRATION_URL).origin,
        job,
        result,
      ),
  })(batch, env);
}
