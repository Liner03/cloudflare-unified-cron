import { describe, expect, it } from "vitest";
import {
  LIMITS,
  assertCronResultIdentity,
  cronRequestV1Schema,
  jsonByteLength,
  retryPolicySchema,
  workerRegistrationV1Schema,
  BoundedJsonError,
  readBoundedJson,
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

  it("validates a complete Worker registration", () => {
    expect(
      workerRegistrationV1Schema.safeParse({
        protocolVersion: 1,
        registrationRevision: "build-123",
        worker: { label: "Data Worker" },
        actions: [
          {
            name: "sync",
            version: 1,
            label: "Sync",
            idempotent: true,
          },
        ],
        schedules: [
          {
            key: "hourly-sync",
            name: "Hourly sync",
            action: "sync",
            actionVersion: 1,
            cronExpression: "0 * * * *",
            timezone: "UTC",
            retryPolicy: {
              maxAttempts: 2,
              delaysSeconds: [60],
              retryOnUnknown: false,
            },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate keys and unsafe retries", () => {
    const action = {
      name: "send",
      version: 1,
      label: "Send",
      idempotent: false,
    };
    const schedule = {
      key: "daily-send",
      name: "Daily send",
      action: "send",
      actionVersion: 1,
      cronExpression: "0 0 * * *",
      timezone: "UTC",
      retryPolicy: {
        maxAttempts: 2,
        delaysSeconds: [60],
        retryOnUnknown: false,
      },
    };
    expect(
      workerRegistrationV1Schema.safeParse({
        protocolVersion: 1,
        registrationRevision: "build-unsafe",
        worker: { label: "Mailer" },
        actions: [action, action],
        schedules: [schedule, schedule],
      }).success,
    ).toBe(false);
  });

  it("reads bounded JSON while retaining the original bytes", async () => {
    const body = JSON.stringify({ value: "中" });
    const result = await readBoundedJson({
      body: new Response(body).body,
      contentLength: null,
      maxBytes: 64,
    });
    expect(result.value).toEqual({ value: "中" });
    expect(new TextDecoder().decode(result.raw)).toBe(body);
  });

  it("rejects declared, streamed, and malformed invalid bodies", async () => {
    await expect(
      readBoundedJson({ body: null, contentLength: "65", maxBytes: 64 }),
    ).rejects.toMatchObject({
      reason: "too_large",
    } satisfies Partial<BoundedJsonError>);
    await expect(
      readBoundedJson({
        body: new Response("x".repeat(65)).body,
        contentLength: null,
        maxBytes: 64,
      }),
    ).rejects.toMatchObject({
      reason: "too_large",
    } satisfies Partial<BoundedJsonError>);
    await expect(
      readBoundedJson({
        body: new Response("{").body,
        contentLength: null,
        maxBytes: 64,
      }),
    ).rejects.toMatchObject({
      reason: "invalid_json",
    } satisfies Partial<BoundedJsonError>);
  });
});
