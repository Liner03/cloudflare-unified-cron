import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CronError, createCronHandler, defineAction } from "./index";

const baseRequest = {
  protocolVersion: 1 as const,
  executionId: "execution-1",
  attemptId: "attempt-1",
  scheduleId: "schedule-1",
  targetId: "DATA",
  action: "sync",
  actionVersion: 1,
  source: "manual" as const,
  dispatchReason: "initial" as const,
  attemptNumber: 1,
  scheduledFor: null,
  requestedAt: new Date().toISOString(),
  deadlineAt: new Date(Date.now() + 30_000).toISOString(),
  idempotencyKey: "ucp:v1:platform:execution-1",
  payload: { source: "crm" },
};

describe("worker sdk", () => {
  it("wraps successful actions with current attempt identity", async () => {
    const run = vi.fn(async () => ({ summary: "synchronized", output: { count: 2 } }));
    const handler = createCronHandler<{}>({
      sync: defineAction({
        version: 1,
        idempotent: true,
        payloadSchema: z.object({ source: z.string() }),
        run,
      }),
    });
    const result = await handler.cron(baseRequest, {
      env: {},
      ctx: {} as ExecutionContext,
    });

    expect(result).toMatchObject({ ok: true, executionId: "execution-1", attemptId: "attempt-1" });
    expect(run).toHaveBeenCalledOnce();
  });

  it("turns explicit CronError into a declared failure", async () => {
    const handler = createCronHandler<{}>({
      sync: defineAction({
        version: 1,
        idempotent: true,
        payloadSchema: z.object({ source: z.string() }),
        async run() {
          throw CronError.retryable("UPSTREAM_503", "temporary failure");
        },
      }),
    });
    await expect(handler.cron(baseRequest, { env: {}, ctx: {} as ExecutionContext })).resolves.toMatchObject({
      ok: false,
      error: { code: "UPSTREAM_503", retryable: true },
    });
  });

  it("rethrows unknown exceptions so the platform records unknown", async () => {
    const handler = createCronHandler<{}>({
      sync: defineAction({
        version: 1,
        idempotent: true,
        payloadSchema: z.object({ source: z.string() }),
        async run() {
          throw new Error("connection lost");
        },
      }),
    });
    await expect(handler.cron(baseRequest, { env: {}, ctx: {} as ExecutionContext })).rejects.toThrow(
      "connection lost",
    );
  });
});
