import { z } from "zod";
import { jsonValueSchema } from "./json";

export const triggerMessageSchema = z
  .object({
    protocolVersion: z.literal(2),
    deliveryId: z.string().uuid(),
    scheduleId: z.string().min(1),
    targetId: z.string().min(1),
    scheduledFor: z.iso.datetime(),
    action: z.string().min(1).max(128),
    actionVersion: z.number().int().positive(),
    payload: jsonValueSchema,
    idempotencyKey: z.string().min(1).max(256),
    receiptToken: z.string().regex(/^ucrr_[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export type TriggerMessage = z.infer<typeof triggerMessageSchema>;
export const triggerResultSchema = z
  .object({
    status: z.enum(["succeeded", "failed"]),
    summary: z.string().max(1024),
  })
  .strict();
export type TriggerResult = z.infer<typeof triggerResultSchema>;
