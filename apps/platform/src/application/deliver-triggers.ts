import type { TargetManifest, TriggerMessage } from "@unified-cron/contracts";
import { TriggerDeliveryRepository } from "../infrastructure/d1/trigger-delivery-repository";
import type { SchedulerSettings } from "../infrastructure/d1/scheduler-settings";

export interface TriggerQueue {
  sendBatch(messages: { body: TriggerMessage }[]): Promise<unknown>;
}
export function sharedQueueBinding(
  env: object,
  targets: readonly TargetManifest[],
): TriggerQueue {
  const routes = new Set(
    targets.map((target) => {
      if (!target.delivery) throw new Error("TARGET_QUEUE_NOT_CONFIGURED");
      return `${target.delivery.binding}:${target.delivery.queue}`;
    }),
  );
  if (routes.size !== 1) throw new Error("MULTIPLE_DISPATCH_QUEUES");
  const target = targets[0];
  if (!target?.delivery) throw new Error("TARGET_QUEUE_NOT_CONFIGURED");
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
    const targets = this.targets.filter((target) => target.delivery);
    if (!targets.length) return { materialized, queued, errors };
    const queue = sharedQueueBinding(this.env, targets);
    const targetIds = targets.map((target) => target.id);
    let progressed = true,
      halted = false;
    while (
      !halted &&
      progressed &&
      claimed < settings.delivery_budget &&
      now() - started < 40000
    ) {
      progressed = false;
      const rows = await this.repository.claimMany(
        targetIds,
        now(),
        Math.min(settings.per_target_batch, settings.delivery_budget - claimed),
      );
      if (rows.length) {
        progressed = true;
        claimed += rows.length;
        let chunks: Awaited<ReturnType<typeof messageChunks>>;
        try {
          chunks = await messageChunks(
            rows,
            this.repository,
            this.secret,
            this.instance,
          );
        } catch {
          errors++;
          await this.repository.finish(rows, now(), false);
          break;
        }
        for (let index = 0; index < chunks.length; index++) {
          const chunk = chunks[index];
          if (!chunk) continue;
          if (now() - started >= 40000) {
            await this.repository.finish(
              chunks.slice(index).flatMap((remaining) => remaining.rows),
              now(),
              false,
            );
            errors++;
            halted = true;
            break;
          }
          try {
            await sendWithDeadline(queue, chunk.messages);
            await this.repository.finish(chunk.rows, now(), true);
            queued += chunk.rows.length;
          } catch {
            errors++;
            await this.repository.finish(
              chunks.slice(index).flatMap((remaining) => remaining.rows),
              now(),
              false,
            );
            halted = true;
            break;
          }
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

async function messageChunks(
  rows: Awaited<ReturnType<TriggerDeliveryRepository["claimMany"]>>,
  repository: TriggerDeliveryRepository,
  secret: string,
  instance: string,
) {
  const chunks: {
    rows: typeof rows;
    messages: { body: TriggerMessage }[];
  }[] = [];
  let chunkRows: typeof rows = [];
  let messages: { body: TriggerMessage }[] = [];
  let bytes = 0;
  for (const row of rows) {
    const message = await repository.message(row, secret, instance);
    const size = new TextEncoder().encode(JSON.stringify(message)).byteLength;
    if (messages.length && (messages.length === 100 || bytes + size > 240000)) {
      chunks.push({ rows: chunkRows, messages });
      chunkRows = [];
      messages = [];
      bytes = 0;
    }
    chunkRows.push(row);
    messages.push({ body: message });
    bytes += size;
  }
  if (messages.length) chunks.push({ rows: chunkRows, messages });
  return chunks;
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
