import { env } from "cloudflare:workers";
import {
  createMessageBatch,
  createExecutionContext,
  getQueueResult,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTriggerConsumer } from "@unified-cron/worker-sdk";
import type { TriggerMessage } from "@unified-cron/contracts";
import { executeQueueProbe } from "../src/queue-trigger";

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
  it("deduplicates concurrent deliveries and caches results when callback fails", async () => {
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
