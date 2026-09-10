import {
  cronResultV1Schema,
  cronTargetDescriptionV1Schema,
  type CronRequestV1,
} from "@unified-cron/contracts";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { isTestEnvironment } from "../src/index";

const CONTROL_SECRET = "local-test-control-secret";

describe("named CronEntrypoint contract", () => {
  beforeEach(async () => {
    await env.BUSINESS_DB.prepare("DELETE FROM idempotent_results").run();
  });

  it("keeps the default fetch service while exposing named RPC", async () => {
    const response = await exports.default.fetch(
      new Request("https://worker-data.example/"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "worker-data",
      websitePreserved: true,
    });

    const description = await Promise.resolve(
      exports.CronEntrypoint.describe(),
    );
    expect(description).toMatchObject({ protocolVersion: 1 });
  });

  it("deduplicates business effects by Execution key and rewraps current Attempt identity", async () => {
    const first = cronResultV1Schema.parse(
      await Promise.resolve(
        exports.CronEntrypoint.cron(request("attempt-1", 1)),
      ),
    );
    const second = cronResultV1Schema.parse(
      await Promise.resolve(
        exports.CronEntrypoint.cron(request("attempt-2", 2)),
      ),
    );
    expect(first).toMatchObject({ ok: true, attemptId: "attempt-1" });
    expect(second).toMatchObject({ ok: true, attemptId: "attempt-2" });
    const count = await env.BUSINESS_DB.prepare(
      "SELECT COUNT(*) AS count FROM idempotent_results",
    ).first<{
      count: number;
    }>();
    expect(count?.count).toBe(1);
  });
});

describe("deterministic Test Target", () => {
  beforeEach(async () => {
    await env.BUSINESS_DB.batch([
      env.BUSINESS_DB.prepare("DELETE FROM scenario_queue"),
      env.BUSINESS_DB.prepare("DELETE FROM rpc_receipts"),
      env.BUSINESS_DB.prepare("DELETE FROM test_side_effects"),
    ]);
  });

  it("protects control APIs and rejects non-test environments", async () => {
    const unauthorized = await exports.default.fetch(
      new Request("https://worker-data.example/__test/receipts"),
    );
    expect(unauthorized.status).toBe(401);

    expect(isTestEnvironment("production")).toBe(false);
    expect(isTestEnvironment("test")).toBe(true);
    expect(isTestEnvironment("staging")).toBe(true);

    const reset = await exports.default.fetch(
      controlRequest("/__test/reset", {}),
    );
    expect(reset.status).toBe(200);
  });

  it("consumes retryable_then_success once and records both Attempts", async () => {
    expect((await configure("retryable_then_success")).status).toBe(200);
    const first = cronResultV1Schema.parse(
      await Promise.resolve(
        exports.CronEntrypoint.cron(
          request("attempt-retry-1", 1, { action: "testScenario" }),
        ),
      ),
    );
    const second = cronResultV1Schema.parse(
      await Promise.resolve(
        exports.CronEntrypoint.cron(
          request("attempt-retry-2", 2, { action: "testScenario" }),
        ),
      ),
    );
    expect(first).toMatchObject({
      ok: false,
      error: { code: "TEST_RETRYABLE_FAILURE", retryable: true },
    });
    expect(second).toMatchObject({ ok: true, attemptId: "attempt-retry-2" });
    const counts = await env.BUSINESS_DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM scenario_queue) AS queued,
         (SELECT COUNT(*) FROM rpc_receipts) AS receipts,
         (SELECT COUNT(*) FROM test_side_effects) AS effects`,
    ).first<{ queued: number; receipts: number; effects: number }>();
    expect(counts).toEqual({ queued: 0, receipts: 2, effects: 1 });

    const receipts = await exports.default.fetch(
      controlRequest("/__test/receipts"),
    );
    expect(receipts.status).toBe(200);
    await expect(receipts.json()).resolves.toMatchObject({
      data: [
        {
          execution_id: "execution-1",
          attempt_id: "attempt-retry-1",
          action: "testScenario",
          mode: "retryable_then_success",
          side_effect_count: 0,
        },
        {
          execution_id: "execution-1",
          attempt_id: "attempt-retry-2",
          action: "testScenario",
          mode: "success",
          side_effect_count: 1,
        },
      ],
    });
  });

  it("returns permanent failures and throws before effects", async () => {
    expect((await configure("permanent_failure")).status).toBe(200);
    const permanent = cronResultV1Schema.parse(
      await Promise.resolve(
        exports.CronEntrypoint.cron(
          request("attempt-permanent", 1, { action: "testScenario" }),
        ),
      ),
    );
    expect(permanent).toMatchObject({
      ok: false,
      error: { code: "TEST_PERMANENT_FAILURE", retryable: false },
    });

    expect((await configure("throw_before_effect")).status).toBe(200);
    await expect(
      Promise.resolve(
        exports.CronEntrypoint.cron(
          request("attempt-throw", 1, {
            action: "testScenario",
            executionId: "execution-throw",
            idempotencyKey: "ucp:v1:test:execution-throw",
          }),
        ),
      ),
    ).rejects.toThrow("Deterministic throw before business effect");
    const effects = await env.BUSINESS_DB.prepare(
      "SELECT COUNT(*) AS count FROM test_side_effects",
    ).first<{ count: number }>();
    expect(effects?.count).toBe(0);
  });

  it("persists one effect before deadline timeout", async () => {
    expect((await configure("timeout_after_effect")).status).toBe(200);
    await expect(
      Promise.resolve(
        exports.CronEntrypoint.cron(
          request("attempt-timeout", 1, {
            action: "testScenario",
            executionId: "execution-timeout",
            idempotencyKey: "ucp:v1:test:execution-timeout",
            deadlineMs: 100,
          }),
        ),
      ),
    ).rejects.toBeDefined();
    const evidence = await env.BUSINESS_DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM test_side_effects) AS effects,
         (SELECT side_effect_count FROM rpc_receipts LIMIT 1) AS receipt_count`,
    ).first<{ effects: number; receipt_count: number }>();
    expect(evidence).toEqual({ effects: 1, receipt_count: 1 });
  });

  it("emits malformed and mismatched result modes", async () => {
    expect((await configure("malformed_result")).status).toBe(200);
    await expect(
      Promise.resolve(
        exports.CronEntrypoint.cron(
          request("attempt-malformed", 1, { action: "testScenario" }),
        ),
      ),
    ).resolves.toEqual({ malformed: true });

    expect((await configure("identity_mismatch")).status).toBe(200);
    const mismatched: unknown = await Promise.resolve(
      exports.CronEntrypoint.cron(
        request("attempt-mismatch", 1, {
          action: "testScenario",
          executionId: "execution-mismatch",
          idempotencyKey: "ucp:v1:test:execution-mismatch",
        }),
      ),
    );
    expect(mismatched).toMatchObject({
      executionId: "execution-mismatch-mismatch",
      attemptId: "attempt-mismatch",
    });
  });

  it("deduplicates repeated keys and declares the non-idempotent Action", async () => {
    expect((await configure("duplicate_idempotency")).status).toBe(200);
    const first = cronResultV1Schema.parse(
      await Promise.resolve(
        exports.CronEntrypoint.cron(
          request("attempt-duplicate-1", 1, {
            action: "testScenario",
            executionId: "execution-duplicate",
            idempotencyKey: "ucp:v1:test:execution-duplicate",
          }),
        ),
      ),
    );
    const second = cronResultV1Schema.parse(
      await Promise.resolve(
        exports.CronEntrypoint.cron(
          request("attempt-duplicate-2", 2, {
            action: "testScenario",
            executionId: "execution-duplicate",
            idempotencyKey: "ucp:v1:test:execution-duplicate",
          }),
        ),
      ),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const effects = await env.BUSINESS_DB.prepare(
      "SELECT COUNT(*) AS count FROM test_side_effects",
    ).first<{ count: number }>();
    expect(effects?.count).toBe(1);

    const description = cronTargetDescriptionV1Schema.parse(
      await Promise.resolve(exports.CronEntrypoint.describe()),
    );
    expect(
      description.actions.some(
        (action) =>
          action.name === "nonIdempotentScenario" &&
          action.version === 1 &&
          !action.idempotent,
      ),
    ).toBe(true);
    const nonIdempotent = cronResultV1Schema.parse(
      await Promise.resolve(
        exports.CronEntrypoint.cron(
          request("attempt-non-idempotent", 1, {
            action: "nonIdempotentScenario",
            executionId: "execution-non-idempotent",
            idempotencyKey: "ucp:v1:test:execution-non-idempotent",
          }),
        ),
      ),
    );
    expect(nonIdempotent).toMatchObject({
      ok: false,
      error: { retryable: false },
    });
  });

  it("delays slow_success without crossing the Deadline", async () => {
    expect((await configure("slow_success", 25)).status).toBe(200);
    const startedAt = Date.now();
    const result = cronResultV1Schema.parse(
      await Promise.resolve(
        exports.CronEntrypoint.cron(
          request("attempt-slow", 1, {
            action: "testScenario",
            executionId: "execution-slow",
            idempotencyKey: "ucp:v1:test:execution-slow",
            deadlineMs: 1_000,
          }),
        ),
      ),
    );
    expect(result.ok).toBe(true);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
  });
});

function controlRequest(path: string, body?: unknown): Request {
  return new Request(`https://worker-data.example${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${CONTROL_SECRET}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function configure(
  mode:
    | "success"
    | "permanent_failure"
    | "retryable_then_success"
    | "throw_before_effect"
    | "timeout_after_effect"
    | "slow_success"
    | "malformed_result"
    | "identity_mismatch"
    | "duplicate_idempotency"
    | "non_idempotent_failure",
  delayMs = 0,
): Promise<Response> {
  return exports.default.fetch(
    controlRequest("/__test/scenario", { mode, delayMs }),
  );
}

function request(
  attemptId: string,
  attemptNumber: number,
  options: {
    action?: "syncUsers" | "testScenario" | "nonIdempotentScenario";
    executionId?: string;
    idempotencyKey?: string;
    deadlineMs?: number;
  } = {},
): CronRequestV1 {
  const now = Date.now();
  const action = options.action ?? "syncUsers";
  return {
    protocolVersion: 1,
    executionId: options.executionId ?? "execution-1",
    attemptId,
    scheduleId: "schedule-1",
    targetId: "DATA",
    action,
    actionVersion: 1,
    source: "cron",
    dispatchReason: attemptNumber === 1 ? "initial" : "automatic_retry",
    attemptNumber,
    scheduledFor: new Date(now - 60_000).toISOString(),
    requestedAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + (options.deadlineMs ?? 30_000)).toISOString(),
    idempotencyKey: options.idempotencyKey ?? "ucp:v1:test:execution-1",
    payload: action === "syncUsers" ? { source: "fixture" } : {},
  };
}
