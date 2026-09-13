import { describe, expect, it } from "vitest";
import {
  consumeDispatchQueue,
  toCronRequest,
  toTriggerResult,
} from "../src/application/consume-dispatch-queue";

const job = {
  protocolVersion: 2 as const,
  deliveryId: "00000000-0000-4000-8000-000000000001",
  scheduleId: "schedule-1",
  targetId: "DATA_A",
  scheduledFor: "2026-09-13T00:00:00.000Z",
  action: "queueProbe",
  actionVersion: 1,
  payload: { count: 1 },
  idempotencyKey: "shared-dispatch-test",
  receiptToken: `ucrr_${"r".repeat(43)}`,
};

describe("shared dispatch Queue", () => {
  it("rejects an unexpected physical Queue", async () => {
    await expect(
      consumeDispatchQueue(
        { queue: "wrong", messages: [] } as unknown as MessageBatch<unknown>,
        { DISPATCH_QUEUE_NAME: "expected" } as Env,
      ),
    ).rejects.toThrow("UNEXPECTED_DISPATCH_QUEUE");
  });

  it("maps one delivery to one retry-safe RPC request", () => {
    expect(toCronRequest(job, "attempt-2", 2)).toMatchObject({
      executionId: job.deliveryId,
      attemptId: "attempt-2",
      targetId: "DATA_A",
      dispatchReason: "automatic_retry",
      attemptNumber: 2,
      idempotencyKey: "shared-dispatch-test",
    });
  });

  it("maps RPC terminal results without inventing success", () => {
    expect(
      toTriggerResult({
        protocolVersion: 1,
        executionId: job.deliveryId,
        attemptId: "attempt-1",
        ok: true,
        summary: "done",
      }),
    ).toEqual({ status: "succeeded", summary: "done" });
    expect(
      toTriggerResult({
        protocolVersion: 1,
        executionId: job.deliveryId,
        attemptId: "attempt-1",
        ok: false,
        error: { code: "FAILED", message: "no", retryable: false },
      }),
    ).toEqual({ status: "failed", summary: "FAILED: no" });
  });
});
