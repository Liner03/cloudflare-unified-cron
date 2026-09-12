import type { TargetManifest, TriggerMessage } from "@unified-cron/contracts";
import { TriggerDeliveryRepository } from "../infrastructure/d1/trigger-delivery-repository";
import type { SchedulerSettings } from "../infrastructure/d1/scheduler-settings";

export interface TriggerQueue {
  sendBatch(messages: { body: TriggerMessage }[]): Promise<unknown>;
}
export function queueBinding(
  env: object,
  target: TargetManifest,
): TriggerQueue {
  if (!target.delivery) throw new Error("TARGET_QUEUE_NOT_CONFIGURED");
  const value: unknown = Reflect.get(env, target.delivery.binding);
  if (
    !value ||
    typeof value !== "object" ||
    typeof Reflect.get(value, "sendBatch") !== "function"
  )
    throw new Error("TARGET_QUEUE_NOT_CONFIGURED");
  return value as TriggerQueue;
}
export class TriggerDeliveryApplication {
  constructor(
    private readonly repository: TriggerDeliveryRepository,
    private readonly targets: readonly TargetManifest[],
    private readonly env: object,
    private readonly secret: string,
    private readonly instance: string,
  ) {}
  async run(settings: SchedulerSettings, now: () => number) {
    const started = now();
    const materialized = await this.repository.materialize(
      this.targets,
      this.secret,
      started,
      settings.materialize_budget,
    );
    let claimed = 0,
      queued = 0,
      errors = 0;
    const targets = this.targets.filter((t) => t.delivery?.mode === "queue");
    // Rotate the starting site every minute; small round-robin batches prevent starvation.
    if (targets.length)
      targets.push(
        ...targets.splice(0, Math.floor(started / 60000) % targets.length),
      );
    let progressed = true;
    while (
      progressed &&
      claimed < settings.delivery_budget &&
      now() - started < 40000
    ) {
      progressed = false;
      for (const target of targets) {
        if (claimed >= settings.delivery_budget || now() - started >= 40000)
          break;
        const rows = await this.repository.claim(
          target.id,
          now(),
          Math.min(
            settings.per_target_batch,
            settings.delivery_budget - claimed,
          ),
        );
        if (!rows.length) continue;
        progressed = true;
        claimed += rows.length;
        try {
          const messages = await Promise.all(
            rows.map((row) =>
              this.repository.message(row, this.secret, this.instance),
            ),
          );
          // Bound both message count and encoded batch bytes under Queue API limits.
          let batch: { body: TriggerMessage }[] = [],
            bytes = 0;
          for (const message of messages) {
            const size = new TextEncoder().encode(
              JSON.stringify(message),
            ).byteLength;
            if (
              batch.length &&
              (batch.length === 100 || bytes + size > 240000)
            ) {
              await sendWithDeadline(queueBinding(this.env, target), batch);
              batch = [];
              bytes = 0;
            }
            batch.push({ body: message });
            bytes += size;
          }
          if (batch.length)
            await sendWithDeadline(queueBinding(this.env, target), batch);
          await this.repository.finish(rows, now(), true);
          queued += rows.length;
        } catch {
          errors++;
          // Ambiguous acceptance is retried with the same occurrence key. Consumers must be idempotent.
          await this.repository.finish(rows, now(), false);
        }
      }
    }
    if (now() - started < 40000) await this.repository.cleanup(now());
    console.log(
      JSON.stringify({
        event: "trigger_delivery_tick",
        materialized,
        queued,
        errors,
        durationMs: now() - started,
      }),
    );
    return { materialized, queued, errors };
  }
}

async function sendWithDeadline(
  queue: TriggerQueue,
  messages: { body: TriggerMessage }[],
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      queue.sendBatch(messages),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("QUEUE_SEND_TIMEOUT")), 3000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
