import { z } from "zod";

export const schedulerSettingsSchema = z
  .object({
    max_schedules: z.number().int().min(1).max(1000),
    materialize_budget: z.number().int().min(1).max(1000),
    delivery_budget: z.number().int().min(1).max(1000),
    rpc_budget: z.number().int().min(1).max(20),
    concurrency: z.number().int().min(1).max(10),
    per_target_batch: z.number().int().min(1).max(100),
  })
  .strict();
export type SchedulerSettings = z.infer<typeof schedulerSettingsSchema>;
export async function readSchedulerSettings(
  db: D1Database,
): Promise<SchedulerSettings> {
  return schedulerSettingsSchema.parse(
    await db
      .prepare(
        "SELECT max_schedules,materialize_budget,delivery_budget,rpc_budget,concurrency,per_target_batch FROM scheduler_settings WHERE id = 1",
      )
      .first(),
  );
}
