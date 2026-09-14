import { env } from "cloudflare:workers";
import {
  createMessageBatch,
  createExecutionContext,
  getQueueResult,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createTriggerConsumer } from "@unified-cron/worker-sdk";
import type { TriggerMessage } from "@unified-cron/contracts";
import { executeQueueProbe } from "../src/queue-trigger";
import { executeQueueProbeCron } from "../src/queue-worker";

const job: TriggerMessage = {
  protocolVersion: 2,
  deliveryId: "00000000-0000-4000-8000-000000000001",
  scheduleId: "test",
  targetId: "DATA",
  scheduledFor: "2026-09-12T00:00:00Z",
  action: "queueProbe",
  actionVersion: 1,
  payload: {},
  idempotencyKey: "queue-test-key",
  receiptToken: `ucrr_${"t".repeat(43)}`,
};
describe("L2-027 website Queue execution", () => {
  it("executes the shared dispatcher RPC with current Attempt identity", async () => {
    const result = await executeQueueProbeCron(
      {
        protocolVersion: 1,
        executionId: "shared-execution",
        attemptId: "shared-attempt",
        scheduleId: "shared-schedule",
        targetId: "DATA",
        action: "queueProbe",
        actionVersion: 1,
        source: "cron",
        dispatchReason: "initial",
        attemptNumber: 1,
        scheduledFor: "2026-09-13T00:00:00.000Z",
        requestedAt: new Date().toISOString(),
        deadlineAt: new Date(Date.now() + 30_000).toISOString(),
        idempotencyKey: "shared-rpc-idempotency",
        payload: {},
      },
      env,
    );
    expect(result).toMatchObject({
      ok: true,
      executionId: "shared-execution",
      attemptId: "shared-attempt",
    });
  });

  it("replays a committed result after one injected response loss without another effect", async () => {
    await env.BUSINESS_DB.batch([
      env.BUSINESS_DB.prepare("DELETE FROM queue_trigger_effects"),
      env.BUSINESS_DB.prepare("DELETE FROM queue_trigger_results"),
    ]);
    const request = {
      protocolVersion: 1,
      executionId: "response-loss-once",
      attemptId: "attempt-1",
      scheduleId: "shared-schedule",
      targetId: "DATA",
      action: "queueProbe",
      actionVersion: 1,
      source: "cron",
      dispatchReason: "initial",
      attemptNumber: 1,
      scheduledFor: "2026-09-14T00:00:00.000Z",
      requestedAt: new Date().toISOString(),
      deadlineAt: new Date(Date.now() + 30_000).toISOString(),
      idempotencyKey: "response-loss-once-key",
      payload: { testFailureMode: "response_loss_once" },
    };
    await expect(executeQueueProbeCron(request, env)).rejects.toThrow(
      "TEST_RESPONSE_LOSS_AFTER_EFFECT",
    );
    const replay = await executeQueueProbeCron(
      {
        ...request,
        attemptId: "attempt-2",
        dispatchReason: "automatic_retry",
        attemptNumber: 2,
      },
      env,
    );
    expect(replay).toMatchObject({ ok: true, attemptId: "attempt-2" });
    const counts = await env.BUSINESS_DB.prepare(
      `SELECT
        (SELECT count(*) FROM queue_trigger_results) results,
        (SELECT count(*) FROM queue_trigger_effects) effects`,
    ).first<{ results: number; effects: number }>();
    expect(counts).toEqual({ results: 1, effects: 1 });
  });

  it("keeps one effect when every response is lost and forbids injection in production", async () => {
    await env.BUSINESS_DB.batch([
      env.BUSINESS_DB.prepare("DELETE FROM queue_trigger_effects"),
      env.BUSINESS_DB.prepare("DELETE FROM queue_trigger_results"),
    ]);
    const request = {
      protocolVersion: 1,
      executionId: "response-loss-always",
      attemptId: "attempt-1",
      scheduleId: "shared-schedule",
      targetId: "DATA",
      action: "queueProbe",
      actionVersion: 1,
      source: "cron",
      dispatchReason: "initial",
      attemptNumber: 1,
      scheduledFor: "2026-09-14T00:00:00.000Z",
      requestedAt: new Date().toISOString(),
      deadlineAt: new Date(Date.now() + 30_000).toISOString(),
      idempotencyKey: "response-loss-always-key",
      payload: { testFailureMode: "response_loss_always" },
    };
    for (const attemptNumber of [1, 2, 3, 4]) {
      await expect(
        executeQueueProbeCron(
          {
            ...request,
            attemptId: `attempt-${attemptNumber}`,
            dispatchReason: attemptNumber === 1 ? "initial" : "automatic_retry",
            attemptNumber,
          },
          env,
        ),
      ).rejects.toThrow("TEST_RESPONSE_LOSS_AFTER_EFFECT");
    }
    expect(
      await env.BUSINESS_DB.prepare(
        "SELECT count(*) effects FROM queue_trigger_effects",
      ).first<{ effects: number }>(),
    ).toEqual({ effects: 1 });
    const production = await executeQueueProbeCron(request, {
      APP_ENV: "production",
      TARGET_ID: env.TARGET_ID,
      BUILD_ID: env.BUILD_ID,
      BUSINESS_DB: env.BUSINESS_DB,
    } as Env);
    expect(production).toMatchObject({
      ok: false,
      error: { code: "TEST_MODE_FORBIDDEN", retryable: false },
    });
  });

  it("rejects a delivery when the runtime Queue name differs from configuration", async () => {
    let executed = 0;
    const consumer = createTriggerConsumer({
      targetId: "DATA",
      queueName: "configured-queue",
      execute: () => {
        executed++;
        return Promise.resolve({ status: "succeeded", summary: "ok" });
      },
    });
    const batch = createMessageBatch("actual-queue", [
      { id: "wrong-queue", timestamp: new Date(), body: job, attempts: 1 },
    ]);

    await expect(consumer(batch, {})).rejects.toThrow(
      "UNEXPECTED_TRIGGER_QUEUE",
    );
    expect(executed).toBe(0);
  });

  it("deduplicates concurrent deliveries and caches results when callback fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await env.BUSINESS_DB.batch([
      env.BUSINESS_DB.prepare("DELETE FROM queue_trigger_effects"),
      env.BUSINESS_DB.prepare("DELETE FROM queue_trigger_results"),
    ]);
    await Promise.all(
      Array.from({ length: 10 }, () => executeQueueProbe(job, env)),
    );
    expect(
      (
        await env.BUSINESS_DB.prepare(
          "SELECT count(*) n FROM queue_trigger_effects",
        ).first<{ n: number }>()
      )?.n,
    ).toBe(1);
    let reportCount = 0;
    const consumer = createTriggerConsumer<Env>({
      targetId: "DATA",
      queueName: "website",
      execute: executeQueueProbe,
      report: () => {
        reportCount++;
        return reportCount === 1
          ? Promise.reject(new Error("callback unavailable"))
          : Promise.resolve();
      },
    });
    const first = createMessageBatch("website", [
      { id: "m1", timestamp: new Date(), body: job, attempts: 1 },
    ]);
    await consumer(first, env);
    const firstResult = z
      .object({ retryMessages: z.array(z.unknown()) })
      .parse(await getQueueResult(first, createExecutionContext()));
    expect(firstResult.retryMessages).toHaveLength(1);
    const replay = createMessageBatch("website", [
      { id: "m2", timestamp: new Date(), body: job, attempts: 2 },
    ]);
    await consumer(replay, env);
    const replayResult = z
      .object({ explicitAcks: z.array(z.string()) })
      .parse(await getQueueResult(replay, createExecutionContext()));
    expect(replayResult.explicitAcks).toEqual(["m2"]);
    expect(
      (
        await env.BUSINESS_DB.prepare(
          "SELECT count(*) n FROM queue_trigger_effects",
        ).first<{ n: number }>()
      )?.n,
    ).toBe(1);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('"event":"trigger_consumer_failed"'),
    );
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain(
      job.receiptToken,
    );
    errorLog.mockRestore();
  });
  it("rejects a cross-site message without executing business", async () => {
    let executed = 0;
    const consumer = createTriggerConsumer({
      targetId: "DATA",
      queueName: "website",
      execute: () => {
        executed++;
        return Promise.resolve({ status: "succeeded", summary: "ok" });
      },
    });
    const batch = createMessageBatch("website", [
      {
        id: "bad",
        timestamp: new Date(),
        body: { ...job, targetId: "OTHER" },
        attempts: 1,
      },
    ]);
    await consumer(batch, {});
    expect(executed).toBe(0);
    expect(
      z
        .object({ retryMessages: z.array(z.unknown()) })
        .parse(await getQueueResult(batch, createExecutionContext()))
        .retryMessages,
    ).toHaveLength(1);
  });
});
