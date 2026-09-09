import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

const validSchedule = {
  name: "Health check",
  description: "",
  targetId: "DATA",
  action: "healthCheck",
  actionVersion: 1,
  cronExpression: "*/5 * * * *",
  timezone: "UTC",
  enabled: false,
  payload: {},
  retryPolicy: { maxAttempts: 1, delaysSeconds: [], retryOnUnknown: false },
  timeoutMs: 30_000,
  misfirePolicy: "coalesce",
  misfireGraceSeconds: 300,
};

describe("admin API", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM api_idempotency"),
      env.DB.prepare("DELETE FROM audit_events"),
      env.DB.prepare("DELETE FROM attempts"),
      env.DB.prepare("DELETE FROM executions"),
      env.DB.prepare("DELETE FROM schedules"),
      env.DB.prepare("DELETE FROM targets"),
      env.DB.prepare(
        `INSERT INTO targets (id, label, enabled, manifest_revision, created_at, updated_at)
         VALUES ('DATA', 'Data Worker', 1, 'data-v1', 1, 1)`,
      ),
      env.DB.prepare(
        "UPDATE platform_state SET dispatch_paused = 0, updated_at = 0 WHERE id = 1",
      ),
    ]);
  });

  it("creates once and replays the stored response for a duplicate key", async () => {
    const first = await mutate(
      "/api/v1/schedules",
      "schedule-create-0001",
      validSchedule,
    );
    const replay = await mutate(
      "/api/v1/schedules",
      "schedule-create-0001",
      validSchedule,
    );
    expect(first.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());

    const scheduleCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM schedules",
    ).first<{ count: number }>();
    const auditCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_events",
    ).first<{ count: number }>();
    expect(scheduleCount?.count).toBe(1);
    expect(auditCount?.count).toBe(1);
  });

  it("rejects the same idempotency key with a different body", async () => {
    await mutate("/api/v1/schedules", "schedule-create-0002", validSchedule);
    const conflict = await mutate("/api/v1/schedules", "schedule-create-0002", {
      ...validSchedule,
      name: "Different",
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
  });

  it("uses If-Match to reject a stale editor", async () => {
    const created = await mutate(
      "/api/v1/schedules",
      "schedule-create-0003",
      validSchedule,
    );
    const id = readDataId(await created.json());
    const updated = await mutate(
      `/api/v1/schedules/${id}`,
      "schedule-patch-0001",
      { name: "Updated" },
      "PATCH",
      { "If-Match": '"1"' },
    );
    expect(updated.status).toBe(200);
    const stale = await mutate(
      `/api/v1/schedules/${id}`,
      "schedule-patch-0002",
      { name: "Lost update" },
      "PATCH",
      { "If-Match": '"1"' },
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "SCHEDULE_REVISION_CONFLICT" },
    });
  });

  it("persists Run now intent and does not create an Attempt in the HTTP request", async () => {
    const created = await mutate(
      "/api/v1/schedules",
      "schedule-create-0004",
      validSchedule,
    );
    const id = readDataId(await created.json());
    const run = await mutate(
      `/api/v1/schedules/${id}/run`,
      "schedule-run-00001",
      {},
    );
    expect(run.status).toBe(202);
    const execution = await env.DB.prepare(
      "SELECT status FROM executions",
    ).first<{ status: string }>();
    const attempts = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM attempts",
    ).first<{ count: number }>();
    expect(execution?.status).toBe("pending");
    expect(attempts?.count).toBe(0);
  });

  it("rejects Run now when the Schedule revision changes after snapshot read", async () => {
    const created = await mutate(
      "/api/v1/schedules",
      "schedule-create-run-race",
      validSchedule,
    );
    const id = readDataId(await created.json());
    await env.DB.prepare(
      `CREATE TRIGGER revise_schedule_during_run
       AFTER INSERT ON api_idempotency
       WHEN NEW.key = 'schedule-run-revision-race'
       BEGIN
         UPDATE schedules
         SET revision = revision + 1,
             payload_json = '{"source":"concurrent-edit"}',
             updated_at = updated_at + 1
         WHERE id = '${id}';
       END`,
    ).run();

    const run = await mutate(
      `/api/v1/schedules/${id}/run`,
      "schedule-run-revision-race",
      {},
    );
    expect(run.status).toBe(409);
    await expect(run.json()).resolves.toMatchObject({
      error: { code: "SCHEDULE_RUN_CONFLICT" },
    });
    const executions = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM executions WHERE schedule_id = ?",
    )
      .bind(id)
      .first<{ count: number }>();
    expect(executions?.count).toBe(0);
  });

  it("rejects an untrusted Origin and returns JSON 404 for unknown API routes", async () => {
    const forbidden = await mutate(
      "/api/v1/schedules",
      "schedule-create-0005",
      validSchedule,
      "POST",
      {
        Origin: "https://evil.example",
      },
    );
    expect(forbidden.status).toBe(403);

    const missing = await exports.default.fetch(
      new Request("http://localhost/api/v1/does-not-exist"),
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Content-Type")).toContain("application/json");
  });

  it("atomically enforces the 50 Schedule limit under concurrent creates", async () => {
    await env.DB.prepare(
      `WITH RECURSIVE numbers(value) AS (
         SELECT 1 UNION ALL SELECT value + 1 FROM numbers WHERE value < 49
       )
       INSERT INTO schedules (
         id, name, description, target_id, action, action_version,
         cron_expression, timezone, enabled, revision, payload_json,
         retry_policy_json, timeout_ms, misfire_policy, misfire_grace_seconds,
         next_run_at, created_at, updated_at
       )
       SELECT 'seed-' || value, 'Seed ' || value, '', 'DATA', 'healthCheck', 1,
              '* * * * *', 'UTC', 0, 1, '{}',
              '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}',
              30000, 'coalesce', 300, NULL, 1, 1
       FROM numbers`,
    ).run();

    const responses = await Promise.all([
      mutate("/api/v1/schedules", "schedule-limit-0001", {
        ...validSchedule,
        name: "Concurrent A",
      }),
      mutate("/api/v1/schedules", "schedule-limit-0002", {
        ...validSchedule,
        name: "Concurrent B",
      }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 429,
    ]);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM schedules WHERE archived_at IS NULL",
    ).first<{ count: number }>();
    expect(count?.count).toBe(50);
  });

  it("rechecks Schedule capacity inside the mutation transaction", async () => {
    await env.DB.prepare(
      `WITH RECURSIVE numbers(value) AS (
         SELECT 1 UNION ALL SELECT value + 1 FROM numbers WHERE value < 49
       )
       INSERT INTO schedules (
         id, name, description, target_id, action, action_version,
         cron_expression, timezone, enabled, revision, payload_json,
         retry_policy_json, timeout_ms, misfire_policy, misfire_grace_seconds,
         next_run_at, created_at, updated_at
       )
       SELECT 'seed-' || value, 'Seed ' || value, '', 'DATA', 'healthCheck', 1,
              '* * * * *', 'UTC', 0, 1, '{}',
              '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}',
              30000, 'coalesce', 300, NULL, 1, 1
       FROM numbers`,
    ).run();
    await env.DB.prepare(
      `CREATE TRIGGER fill_schedule_capacity
       AFTER INSERT ON api_idempotency
       WHEN NEW.key = 'schedule-limit-trigger'
       BEGIN
         INSERT INTO schedules (
           id, name, description, target_id, action, action_version,
           cron_expression, timezone, enabled, revision, payload_json,
           retry_policy_json, timeout_ms, misfire_policy, misfire_grace_seconds,
           next_run_at, created_at, updated_at
         ) VALUES (
           'concurrent-racer', 'Concurrent racer', '', 'DATA', 'healthCheck', 1,
           '* * * * *', 'UTC', 0, 1, '{}',
           '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}',
           30000, 'coalesce', 300, NULL, 1, 1
         );
       END`,
    ).run();

    const response = await mutate(
      "/api/v1/schedules",
      "schedule-limit-trigger",
      { ...validSchedule, name: "Stale precheck" },
    );
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SCHEDULE_LIMIT_REACHED" },
    });
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM schedules WHERE archived_at IS NULL",
    ).first<{ count: number }>();
    expect(count?.count).toBeLessThanOrEqual(50);
  });

  it("rejects Retry when the immutable snapshot was not idempotent", async () => {
    const created = await mutate(
      "/api/v1/schedules",
      "schedule-create-non-idempotent",
      validSchedule,
    );
    const scheduleId = readDataId(await created.json());
    const run = await mutate(
      `/api/v1/schedules/${scheduleId}/run`,
      "schedule-run-non-idempotent",
      {},
    );
    const executionId = readExecutionId(await run.json());
    const snapshot = {
      scheduleId,
      scheduleRevision: 1,
      targetId: "DATA",
      action: "healthCheck",
      actionVersion: 1,
      targetManifestRevision: "data-v1",
      targetActionIdempotent: false,
      payload: {},
      retryPolicy: {
        maxAttempts: 1,
        delaysSeconds: [],
        retryOnUnknown: false,
      },
      timeoutMs: 30000,
      cronExpression: "*/5 * * * *",
      timezone: "UTC",
    };
    await env.DB.prepare(
      `UPDATE executions
       SET status = 'failed', snapshot_json = ?, finished_at = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(JSON.stringify(snapshot), Date.now(), Date.now(), executionId)
      .run();

    const response = await mutate(
      `/api/v1/executions/${executionId}/retry`,
      "execution-retry-non-idempotent",
      { confirmRisk: true },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EXECUTION_RETRY_REQUIRES_IDEMPOTENCY" },
    });
  });
});

async function mutate(
  path: string,
  key: string,
  body: unknown,
  method = "POST",
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return exports.default.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        Origin: "http://localhost:8787",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    }),
  );
}

function readDataId(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    typeof value.data === "object" &&
    value.data !== null &&
    "id" in value.data &&
    typeof value.data.id === "string"
  ) {
    return value.data.id;
  }
  throw new Error("response did not contain data.id");
}

function readExecutionId(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    typeof value.data === "object" &&
    value.data !== null &&
    "executionId" in value.data &&
    typeof value.data.executionId === "string"
  ) {
    return value.data.executionId;
  }
  throw new Error("response did not contain data.executionId");
}
