import { cronResultV1Schema, type CronRequestV1 } from "@unified-cron/contracts";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

describe("named CronEntrypoint contract", () => {
  beforeEach(async () => {
    await env.BUSINESS_DB.prepare("DELETE FROM idempotent_results").run();
  });

  it("keeps the default fetch service while exposing named RPC", async () => {
    const response = await exports.default.fetch(new Request("https://worker-data.example/"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ service: "worker-data", websitePreserved: true });

    const description = await Promise.resolve(exports.CronEntrypoint.describe());
    expect(description).toMatchObject({ protocolVersion: 1 });
  });

  it("deduplicates business effects by Execution key and rewraps current Attempt identity", async () => {
    const first = cronResultV1Schema.parse(
      await Promise.resolve(exports.CronEntrypoint.cron(request("attempt-1", 1))),
    );
    const second = cronResultV1Schema.parse(
      await Promise.resolve(exports.CronEntrypoint.cron(request("attempt-2", 2))),
    );
    expect(first).toMatchObject({ ok: true, attemptId: "attempt-1" });
    expect(second).toMatchObject({ ok: true, attemptId: "attempt-2" });
    const count = await env.BUSINESS_DB.prepare("SELECT COUNT(*) AS count FROM idempotent_results").first<{
      count: number;
    }>();
    expect(count?.count).toBe(1);
  });
});

function request(attemptId: string, attemptNumber: number): CronRequestV1 {
  const now = Date.now();
  return {
    protocolVersion: 1,
    executionId: "execution-1",
    attemptId,
    scheduleId: "schedule-1",
    targetId: "DATA",
    action: "syncUsers",
    actionVersion: 1,
    source: "cron",
    dispatchReason: attemptNumber === 1 ? "initial" : "automatic_retry",
    attemptNumber,
    scheduledFor: new Date(now - 60_000).toISOString(),
    requestedAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + 30_000).toISOString(),
    idempotencyKey: "ucp:v1:test:execution-1",
    payload: { source: "fixture" },
  };
}
