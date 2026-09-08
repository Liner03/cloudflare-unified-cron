import { jsonValueSchema, retryPolicySchema } from "@unified-cron/contracts";
import { z } from "zod";

export const scheduleInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(""),
  targetId: z.string().min(1).max(128),
  action: z.string().min(1).max(128),
  actionVersion: z.number().int().min(1),
  cronExpression: z.string().min(1).max(128),
  timezone: z.string().min(1).max(128).default("UTC"),
  enabled: z.boolean().default(false),
  payload: jsonValueSchema,
  retryPolicy: retryPolicySchema,
  timeoutMs: z.number().int().min(1000).max(30_000).default(30_000),
  misfirePolicy: z.enum(["coalesce", "skip"]).default("coalesce"),
  misfireGraceSeconds: z.number().int().min(0).max(86_400).default(300),
});

export const schedulePatchSchema = scheduleInputSchema
  .omit({ enabled: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "至少提供一个修改字段");

export const cronPreviewSchema = z.object({
  cronExpression: z.string().min(1).max(128),
  timezone: z.string().min(1).max(128),
  count: z.number().int().min(1).max(10).default(5),
  after: z.iso.datetime().optional(),
});

export const riskConfirmationSchema = z.object({
  confirmRisk: z.boolean().default(false),
});

export const resolveExecutionSchema = z.object({
  resolution: z.enum(["confirmed_succeeded", "confirmed_failed", "abandon"]),
  note: z.string().trim().min(3).max(2000),
  confirmRisk: z.literal(true),
});

export type ScheduleInput = z.infer<typeof scheduleInputSchema>;
