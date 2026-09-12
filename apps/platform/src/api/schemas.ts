import { z } from "zod";

export const cronPreviewSchema = z
  .object({
    cronExpression: z.string().min(1).max(128),
    cronDialect: z.enum(["unix", "cloudflare"]).default("unix"),
    timezone: z.string().min(1).max(128),
    count: z.number().int().min(1).max(10).default(5),
    after: z.iso.datetime().optional(),
  })
  .strict();

export const riskConfirmationSchema = z
  .object({
    confirmRisk: z.boolean().default(false),
  })
  .strict();

export const resolveExecutionSchema = z
  .object({
    resolution: z.enum(["confirmed_succeeded", "confirmed_failed", "abandon"]),
    note: z.string().trim().min(3).max(2000),
    confirmRisk: z.literal(true),
  })
  .strict();
