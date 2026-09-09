import { describe, expect, it } from "vitest";
import {
  LIMITS,
  assertCronResultIdentity,
  cronRequestV1Schema,
  jsonByteLength,
  retryPolicySchema,
} from "./index";

describe("contracts", () => {
  it("accepts a valid request and keeps retry identity stable", () => {
    const request = cronRequestV1Schema.parse({
      protocolVersion: 1,
      executionId: "execution",
      attemptId: "attempt-2",
      scheduleId: "schedule",
      targetId: "DATA",
      action: "syncUsers",
      actionVersion: 1,
      source: "cron",
      dispatchReason: "automatic_retry",
      attemptNumber: 2,
      scheduledFor: "2026-09-08T00:00:00.000Z",
      requestedAt: "2026-09-08T00:01:00.000Z",
      deadlineAt: "2026-09-08T00:01:30.000Z",
      idempotencyKey: "ucp:v1:platform:execution",
      payload: { source: "crm" },
    });

    expect(() =>
      assertCronResultIdentity(
        {
          protocolVersion: 1,
          executionId: "execution",
          attemptId: "attempt-2",
          ok: true,
          summary: "done",
        },
        request,
      ),
    ).not.toThrow();
  });

  it("requires one delay for every automatic retry", () => {
    expect(
      retryPolicySchema.safeParse({
        maxAttempts: 3,
        delaysSeconds: [60],
        retryOnUnknown: false,
      }).success,
    ).toBe(false);
  });

  it("counts UTF-8 bytes", () => {
    expect(jsonByteLength("中")).toBeGreaterThan(1);
    expect(LIMITS.payloadBytes).toBe(16_384);
  });
});
