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
      env.DB.prepare("UPDATE platform_state SET dispatch_paused = 0, updated_at = 0 WHERE id = 1"),
    ]);
  });

  it("creates once and replays the stored response for a duplicate key", async () => {
    const first = await mutate("/api/v1/schedules", "schedule-create-0001", validSchedule);
    const replay = await mutate("/api/v1/schedules", "schedule-create-0001", validSchedule);
    expect(first.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());

    const scheduleCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM schedules").first<{ count: number }>();
    const auditCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_events").first<{ count: number }>();
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
    await expect(conflict.json()).resolves.toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("uses If-Match to reject a stale editor", async () => {
    const created = await mutate("/api/v1/schedules", "schedule-create-0003", validSchedule);
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
    await expect(stale.json()).resolves.toMatchObject({ error: { code: "SCHEDULE_REVISION_CONFLICT" } });
  });

  it("persists Run now intent and does not create an Attempt in the HTTP request", async () => {
    const created = await mutate("/api/v1/schedules", "schedule-create-0004", validSchedule);
    const id = readDataId(await created.json());
    const run = await mutate(`/api/v1/schedules/${id}/run`, "schedule-run-00001", {});
    expect(run.status).toBe(202);
    const execution = await env.DB.prepare("SELECT status FROM executions").first<{ status: string }>();
    const attempts = await env.DB.prepare("SELECT COUNT(*) AS count FROM attempts").first<{ count: number }>();
    expect(execution?.status).toBe("pending");
    expect(attempts?.count).toBe(0);
  });

  it("rejects an untrusted Origin and returns JSON 404 for unknown API routes", async () => {
    const forbidden = await mutate("/api/v1/schedules", "schedule-create-0005", validSchedule, "POST", {
      Origin: "https://evil.example",
    });
    expect(forbidden.status).toBe(403);

    const missing = await exports.default.fetch(new Request("http://localhost/api/v1/does-not-exist"));
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Content-Type")).toContain("application/json");
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
