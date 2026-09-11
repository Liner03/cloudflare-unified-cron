import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAdminSession } from "../src/infrastructure/auth/access";

const baseRegistration = {
  protocolVersion: 1 as const,
  registrationRevision: "build-1",
  worker: { label: "Data Worker" },
  actions: [
    {
      name: "healthCheck",
      version: 1,
      label: "Health check",
      description: "Read-only health probe",
      idempotent: true,
      examplePayload: {},
    },
  ],
  schedules: [
    {
      key: "health-check",
      name: "Health check",
      description: "Registered by the Data Worker",
      action: "healthCheck",
      actionVersion: 1,
      cronExpression: "*/5 * * * *",
      timezone: "UTC",
      enabled: true,
      payload: {},
      retryPolicy: {
        maxAttempts: 1,
        delaysSeconds: [],
        retryOnUnknown: false,
      },
      timeoutMs: 30_000,
      misfirePolicy: "coalesce" as const,
      misfireGraceSeconds: 300,
    },
  ],
};

let adminCookie = "";

describe("registered control plane API", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM api_idempotency"),
      env.DB.prepare("DELETE FROM audit_events"),
      env.DB.prepare("DELETE FROM attempts"),
      env.DB.prepare("DELETE FROM executions"),
      env.DB.prepare("DELETE FROM schedules"),
      env.DB.prepare("DELETE FROM registered_actions"),
      env.DB.prepare("DELETE FROM registration_revisions"),
      env.DB.prepare("DELETE FROM registrations"),
      env.DB.prepare("DELETE FROM registration_tokens"),
      env.DB.prepare("DELETE FROM admin_sessions"),
      env.DB.prepare("DELETE FROM admin_login_limits"),
      env.DB.prepare("DELETE FROM targets"),
      env.DB.prepare(
        `INSERT INTO targets (
           id, label, enabled, manifest_revision, created_at, updated_at
         ) VALUES ('DATA', 'Data Worker', 1, 'data-v1', 1, 1)`,
      ),
      env.DB.prepare(
        "UPDATE platform_state SET dispatch_paused = 0, updated_at = 0 WHERE id = 1",
      ),
    ]);
    const session = await createAdminSession(env, "admin");
    adminCookie = session.cookie.split(";", 1)[0] ?? "";
  });

  it("issues a one-target token and stores only its SHA-256 hash", async () => {
    const response = await issueToken();
    expect(response.status).toBe(200);
    const value = await response.json();
    const token = readString(value, "token");
    expect(token).toMatch(/^ucrt_[A-Za-z0-9_-]{43}$/);

    const stored = await env.DB.prepare(
      "SELECT target_id, token_hash FROM registration_tokens",
    ).first<{ target_id: string; token_hash: string }>();
    expect(stored?.target_id).toBe("DATA");
    expect(stored?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.token_hash).not.toContain(token);

    const listed = await adminGet("/api/v1/registration-tokens");
    expect(JSON.stringify(await listed.json())).not.toContain(token);
  });

  it("atomically publishes actions and schedules, with revision idempotency", async () => {
    const token = await issuedToken();
    const first = await register(token, baseRegistration);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      data: {
        targetId: "DATA",
        registrationRevision: "build-1",
        unchanged: false,
        actions: 1,
        schedules: 1,
      },
    });

    const replay = await register(token, baseRegistration);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      data: { unchanged: true },
    });
    const scheduleCount = await count("schedules");
    const actionCount = await count("registered_actions");
    expect({ scheduleCount, actionCount }).toEqual({
      scheduleCount: 1,
      actionCount: 1,
    });

    const conflict = await register(token, {
      ...baseRegistration,
      worker: { label: "Different body" },
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "REGISTRATION_REVISION_CONFLICT" },
    });
  });

  it("replays Registration requests and rejects key reuse with another body", async () => {
    const token = await issuedToken();
    const key = `registration:${crypto.randomUUID()}`;
    const first = await register(token, baseRegistration, key);
    const firstBody = await first.json();
    expect(first.status).toBe(200);

    const replay = await register(token, baseRegistration, key);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);

    const conflict = await register(
      token,
      { ...baseRegistration, worker: { label: "Different body" } },
      key,
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    expect(await count("registrations")).toBe(1);
    expect(await count("schedules")).toBe(1);
  });

  it("treats nested JSON key order as the same Registration document", async () => {
    const token = await issuedToken();
    const first = await register(token, {
      ...baseRegistration,
      registrationRevision: "canonical-document",
      schedules: [
        {
          ...baseRegistration.schedules[0],
          payload: { alpha: 1, nested: { first: true, second: false } },
        },
      ],
    });
    expect(first.status).toBe(200);

    const replay = await register(token, {
      ...baseRegistration,
      registrationRevision: "canonical-document",
      schedules: [
        {
          ...baseRegistration.schedules[0],
          payload: { nested: { second: false, first: true }, alpha: 1 },
        },
      ],
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      data: { unchanged: true },
    });
  });

  it("preserves Schedule timing and revision for canonically equal config", async () => {
    const token = await issuedToken();
    await register(token, {
      ...baseRegistration,
      registrationRevision: "canonical-config-1",
      schedules: [
        {
          ...baseRegistration.schedules[0],
          payload: { alpha: 1, nested: { first: true, second: false } },
        },
      ],
    });
    const before = await env.DB.prepare(
      `SELECT revision, next_run_at FROM schedules
       WHERE target_id = 'DATA' AND registration_key = 'health-check'`,
    ).first();

    const updated = await register(token, {
      ...baseRegistration,
      registrationRevision: "canonical-config-2",
      schedules: [
        {
          ...baseRegistration.schedules[0],
          payload: { nested: { second: false, first: true }, alpha: 1 },
        },
      ],
    });
    expect(updated.status).toBe(200);
    const after = await env.DB.prepare(
      `SELECT revision, next_run_at FROM schedules
       WHERE target_id = 'DATA' AND registration_key = 'health-check'`,
    ).first();
    expect(after).toEqual(before);
  });

  it("never accepts different content for a previously seen revision", async () => {
    const token = await issuedToken();
    await register(token, baseRegistration);
    await register(token, {
      ...baseRegistration,
      registrationRevision: "build-2",
      worker: { label: "Second build" },
    });
    const conflict = await register(token, {
      ...baseRegistration,
      worker: { label: "Reused revision with different content" },
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "REGISTRATION_REVISION_CONFLICT" },
    });
  });

  it("allows an exact historical declaration to be restored", async () => {
    const token = await issuedToken();
    await register(token, baseRegistration);
    await register(token, {
      ...baseRegistration,
      registrationRevision: "build-2",
      worker: { label: "Second build" },
    });
    const restored = await register(token, baseRegistration);
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      data: { registrationRevision: "build-1", unchanged: false },
    });
  });

  it("bulk-reconciles the documented maximum without one query per item", async () => {
    const token = await issuedToken();
    const actions = Array.from({ length: 100 }, (_value, index) => ({
      name: `action-${index}`,
      version: 1,
      label: `Action ${index}`,
      idempotent: true,
    }));
    const schedules = Array.from({ length: 50 }, (_value, index) => ({
      key: `schedule-${index}`,
      name: `Schedule ${index}`,
      action: "action-0",
      actionVersion: 1,
      cronExpression: "0 * * * *",
      timezone: "UTC",
      enabled: index % 2 === 0,
      payload: {},
      retryPolicy: {
        maxAttempts: 1,
        delaysSeconds: [],
        retryOnUnknown: false,
      },
    }));
    const response = await register(token, {
      protocolVersion: 1,
      registrationRevision: "maximum-declaration",
      worker: { label: "Large Worker" },
      actions,
      schedules,
    });
    expect(response.status).toBe(200);
    expect(await count("registered_actions")).toBe(100);
    expect(await count("schedules")).toBe(50);

    const updated = await register(token, {
      protocolVersion: 1,
      registrationRevision: "maximum-declaration-updated",
      worker: { label: "Large Worker" },
      actions,
      schedules: schedules.map((schedule, index) =>
        index === 0 ? { ...schedule, name: "Updated at capacity" } : schedule,
      ),
    });
    expect(updated.status).toBe(200);
    const updatedSchedule = await env.DB.prepare(
      `SELECT name, revision FROM schedules
       WHERE target_id = 'DATA' AND registration_key = 'schedule-0'`,
    ).first();
    expect(updatedSchedule).toMatchObject({
      name: "Updated at capacity",
      revision: 2,
    });
    expect(await count("schedules")).toBe(50);
  });

  it("enforces the 50 Schedule limit across all targets", async () => {
    await env.DB.prepare(
      `INSERT INTO targets (
         id, label, enabled, manifest_revision, created_at, updated_at
       ) VALUES ('OTHER', 'Other Worker', 1, 'other-v1', 1, 1)`,
    ).run();
    await env.DB.prepare(
      `WITH RECURSIVE numbers(value) AS (
         SELECT 1 UNION ALL SELECT value + 1 FROM numbers WHERE value < 49
       )
       INSERT INTO schedules (
         id, name, description, target_id, action, action_version,
         cron_expression, timezone, enabled, revision, payload_json,
         retry_policy_json, timeout_ms, misfire_policy, misfire_grace_seconds,
         next_run_at, created_at, updated_at, registration_key,
         managed_by_registration, declared_enabled, operator_paused
       )
       SELECT 'other-' || value, 'Other ' || value, '', 'OTHER', 'noop', 1,
              '0 * * * *', 'UTC', 0, 1, '{}',
              '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}',
              30000, 'coalesce', 300, NULL, 1, 1, 'other-' || value, 1, 0, 0
       FROM numbers`,
    ).run();
    const token = await issuedToken();
    expect((await register(token, baseRegistration)).status).toBe(200);
    expect(await activeScheduleCount()).toBe(50);

    await expect(
      env.DB.prepare(
        `INSERT INTO schedules (
           id, name, description, target_id, action, action_version,
           cron_expression, timezone, enabled, revision, payload_json,
           retry_policy_json, timeout_ms, misfire_policy, misfire_grace_seconds,
           next_run_at, created_at, updated_at, registration_key,
           managed_by_registration, declared_enabled, operator_paused
         ) VALUES (
           'over-limit', 'Over limit', '', 'OTHER', 'noop', 1,
           '0 * * * *', 'UTC', 0, 1, '{}',
           '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}',
           30000, 'coalesce', 300, NULL, 1, 1, 'over-limit', 1, 0, 0
         )`,
      ).run(),
    ).rejects.toThrow(/MANAGED_SCHEDULE_LIMIT_REACHED/);
    const response = await register(token, {
      ...baseRegistration,
      registrationRevision: "build-over-capacity",
      schedules: [
        ...baseRegistration.schedules,
        {
          ...baseRegistration.schedules[0],
          key: "second-schedule",
          name: "Second schedule",
        },
      ],
    });
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SCHEDULE_LIMIT_REACHED" },
    });
    expect(await activeScheduleCount()).toBe(50);
  });

  it("reports every effective Schedule blocker in list, detail, and overview", async () => {
    const token = await issuedToken();
    await register(token, {
      ...baseRegistration,
      schedules: [{ ...baseRegistration.schedules[0], enabled: false }],
    });
    await env.DB.batch([
      env.DB.prepare("UPDATE targets SET enabled = 0 WHERE id = 'DATA'"),
      env.DB.prepare(
        "UPDATE schedules SET operator_paused = 1 WHERE target_id = 'DATA'",
      ),
      env.DB.prepare(
        "UPDATE platform_state SET dispatch_paused = 1 WHERE id = 1",
      ),
    ]);

    const list = await adminGet("/api/v1/schedules");
    expect(list.status).toBe(200);
    const listBody: {
      data: Array<{
        id: string;
        effectiveEnabled: boolean;
        blockingReasons: string[];
      }>;
    } = await list.json();
    expect(listBody.data[0]).toMatchObject({
      effectiveEnabled: false,
      blockingReasons: [
        "declared_disabled",
        "operator_paused",
        "target_disabled",
        "dispatch_paused",
      ],
    });

    const detail = await adminGet(`/api/v1/schedules/${listBody.data[0]!.id}`);
    await expect(detail.json()).resolves.toMatchObject({
      data: {
        effectiveEnabled: false,
        blockingReasons: [
          "declared_disabled",
          "operator_paused",
          "target_disabled",
          "dispatch_paused",
        ],
      },
    });
    const overview = await adminGet("/api/v1/overview");
    await expect(overview.json()).resolves.toMatchObject({
      data: { schedules: { active_schedules: 0, total_schedules: 1 } },
    });
  });

  it("reports a system-disabled invalid Schedule as blocked everywhere", async () => {
    const token = await issuedToken();
    await register(token, baseRegistration);
    await env.DB.prepare(
      `UPDATE schedules SET enabled = 0, next_run_at = NULL
       WHERE target_id = 'DATA' AND registration_key = 'health-check'`,
    ).run();

    const list = await adminGet("/api/v1/schedules");
    const listBody: {
      data: Array<{
        id: string;
        effectiveEnabled: boolean;
        blockingReasons: string[];
      }>;
    } = await list.json();
    expect(listBody.data[0]).toMatchObject({
      effectiveEnabled: false,
      blockingReasons: ["invalid_configuration"],
    });

    const detail = await adminGet(`/api/v1/schedules/${listBody.data[0]!.id}`);
    await expect(detail.json()).resolves.toMatchObject({
      data: {
        effectiveEnabled: false,
        blockingReasons: ["invalid_configuration"],
      },
    });
    const overview = await adminGet("/api/v1/overview");
    await expect(overview.json()).resolves.toMatchObject({
      data: { schedules: { active_schedules: 0, total_schedules: 1 } },
    });
  });

  it("retires omitted schedules and never clears an Operator Override", async () => {
    const token = await issuedToken();
    await register(token, baseRegistration);
    const row = await env.DB.prepare(
      "SELECT id, revision FROM schedules WHERE registration_key = 'health-check'",
    ).first<{ id: string; revision: number }>();
    if (!row) throw new Error("registered schedule was not created");

    const pause = await adminMutate(
      `/api/v1/schedules/${row.id}/pause`,
      {},
      { "If-Match": `"${row.revision}"` },
    );
    expect(pause.status).toBe(200);

    await register(token, {
      ...baseRegistration,
      registrationRevision: "build-2",
      schedules: [],
    });
    const retired = await env.DB.prepare(
      `SELECT operator_paused, retired_at, archived_at, enabled
       FROM schedules WHERE id = ?`,
    )
      .bind(row.id)
      .first<{
        operator_paused: number;
        retired_at: number | null;
        archived_at: number | null;
        enabled: number;
      }>();
    expect(retired).toMatchObject({ operator_paused: 1, enabled: 0 });
    expect(retired?.retired_at).not.toBeNull();
    expect(retired?.archived_at).not.toBeNull();

    await register(token, {
      ...baseRegistration,
      registrationRevision: "build-3",
      schedules: [{ ...baseRegistration.schedules[0]!, name: "Restored" }],
    });
    const restored = await env.DB.prepare(
      `SELECT id, name, operator_paused, retired_at, archived_at, enabled
       FROM schedules WHERE registration_key = 'health-check'`,
    ).first();
    expect(restored).toMatchObject({
      id: row.id,
      name: "Restored",
      operator_paused: 1,
      retired_at: null,
      archived_at: null,
      enabled: 0,
    });
  });

  it("removes manual Schedule CRUD and Schedule Run now", async () => {
    const manualCreate = await adminMutate("/api/v1/schedules", {
      name: "manual",
    });
    expect(manualCreate.status).toBe(404);

    const token = await issuedToken();
    await register(token, baseRegistration);
    const schedule = await env.DB.prepare(
      "SELECT id FROM schedules WHERE registration_key = 'health-check'",
    ).first<{ id: string }>();
    if (!schedule) throw new Error("registered schedule was not created");
    const run = await adminMutate(`/api/v1/schedules/${schedule.id}/run`, {});
    expect(run.status).toBe(404);
    expect(await count("attempts")).toBe(0);
  });

  it("rotates a Token atomically and accepts only the replacement", async () => {
    const issued = await issueToken();
    const original = await issued.json();
    const originalId = readString(original, "id");
    const originalToken = readString(original, "token");
    const rotated = await adminMutate(
      `/api/v1/registration-tokens/${originalId}/rotate`,
      { expiresInDays: 30 },
    );
    expect(rotated.status).toBe(200);
    const value = await rotated.json();
    const replacementId = readString(value, "id");
    const replacementToken = readString(value, "token");
    expect(replacementToken).not.toBe(originalToken);
    const listed = await adminGet("/api/v1/registration-tokens");
    expect(JSON.stringify(await listed.json())).not.toContain(replacementToken);

    expect((await register(originalToken, baseRegistration)).status).toBe(401);
    expect((await register(replacementToken, baseRegistration)).status).toBe(
      200,
    );
    const links = await env.DB.prepare(
      `SELECT id, rotated_from_id, replaced_by_id
       FROM registration_tokens WHERE id IN (?, ?) ORDER BY id`,
    )
      .bind(originalId, replacementId)
      .all<{
        id: string;
        rotated_from_id: string | null;
        replaced_by_id: string | null;
      }>();
    expect(
      links.results.find((row) => row.id === originalId)?.replaced_by_id,
    ).toBe(replacementId);
    expect(
      links.results.find((row) => row.id === replacementId)?.rotated_from_id,
    ).toBe(originalId);
  });

  it("allows only one replacement under concurrent Token rotation", async () => {
    const issued = await issueToken();
    const originalId = readString(await issued.json(), "id");
    const responses = await Promise.all([
      adminMutate(`/api/v1/registration-tokens/${originalId}/rotate`, {
        expiresInDays: 30,
      }),
      adminMutate(`/api/v1/registration-tokens/${originalId}/rotate`, {
        expiresInDays: 30,
      }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const replacements = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM registration_tokens
       WHERE rotated_from_id = ? AND revoked_at IS NULL`,
    )
      .bind(originalId)
      .first<{ count: number }>();
    expect(replacements?.count).toBe(1);
  });

  it("rejects revoked machine credentials without affecting Admin Sessions", async () => {
    const issued = await issueToken();
    const value = await issued.json();
    const token = readString(value, "token");
    const id = readString(value, "id");
    const revoked = await adminMutate(
      `/api/v1/registration-tokens/${id}/revoke`,
      {},
    );
    expect(revoked.status).toBe(200);
    const response = await register(token, baseRegistration);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REGISTRATION_TOKEN_INVALID" },
    });
    expect((await adminGet("/api/v1/system")).status).toBe(200);
  });

  it("requires same-origin Admin writes but accepts Worker registration without Origin", async () => {
    const forbidden = await adminMutate(
      "/api/v1/registration-tokens",
      { targetId: "DATA", label: "evil", expiresInDays: 1 },
      { Origin: "https://evil.example" },
    );
    expect(forbidden.status).toBe(403);
    const token = await issuedToken();
    expect((await register(token, baseRegistration)).status).toBe(200);
  });

  it("replays audited mutations and rejects key reuse with another body", async () => {
    const key = `test:${crypto.randomUUID()}`;
    const first = await adminMutateWithKey(
      "/api/v1/targets/DATA/disable",
      {},
      key,
    );
    const replay = await adminMutateWithKey(
      "/api/v1/targets/DATA/disable",
      {},
      key,
    );
    expect(first.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    const conflict = await adminMutateWithKey(
      "/api/v1/targets/DATA/disable",
      { changed: true },
      key,
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
  });

  it("rejects unknown fields on empty-body mutations without changing state", async () => {
    const response = await adminMutate("/api/v1/targets/DATA/disable", {
      unexpected: true,
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
    const target = await adminGet("/api/v1/targets/DATA");
    await expect(target.json()).resolves.toMatchObject({
      data: { state: { enabled: 1 } },
    });
  });

  it("reports execution and first-attempt success rates with an explicit sample", async () => {
    const token = await issuedToken();
    await register(token, baseRegistration);
    const schedule = await env.DB.prepare(
      "SELECT id FROM schedules WHERE registration_key = 'health-check'",
    ).first<{ id: string }>();
    if (!schedule) throw new Error("registered schedule was not created");
    const now = Date.now();
    for (const [index, status, attempts] of [
      [1, "succeeded", 1],
      [2, "succeeded", 2],
      [3, "failed", 1],
      [4, "skipped", 0],
    ] as const) {
      await env.DB.prepare(
        `INSERT INTO executions (
           id, schedule_id, target_id, source, scheduled_for, dedupe_key,
           schedule_revision, snapshot_json, status, available_at,
           next_attempt_reason, attempt_count, attempt_limit, max_auto_attempts,
           retry_deadline_at, finished_at, created_at, updated_at
         ) VALUES (?, ?, 'DATA', 'manual', NULL, ?, 1, '{}', ?, ?, 'initial',
                   ?, 3, 3, ?, ?, ?, ?)`,
      )
        .bind(
          `rate-${index}`,
          schedule.id,
          `rate-${index}`,
          status,
          now,
          attempts,
          now + 1000,
          now,
          now,
          now,
        )
        .run();
    }
    const response = await adminGet("/api/v1/success-rates?window=24h");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        window: "24h",
        execution: { numerator: 2, denominator: 3 },
        firstAttempt: { numerator: 1, denominator: 3 },
      },
    });
  });
});

function adminGet(path: string): Promise<Response> {
  return exports.default.fetch(
    new Request(`http://localhost${path}`, {
      headers: { Cookie: adminCookie },
    }),
  );
}

function adminMutate(
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return adminMutateWithKey(
    path,
    body,
    `test:${crypto.randomUUID()}`,
    extraHeaders,
  );
}

function adminMutateWithKey(
  path: string,
  body: unknown,
  idempotencyKey: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return exports.default.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        Origin: "http://localhost:8787",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    }),
  );
}

function issueToken(): Promise<Response> {
  return adminMutate("/api/v1/registration-tokens", {
    targetId: "DATA",
    label: "integration test",
    expiresInDays: 30,
  });
}

async function issuedToken(): Promise<string> {
  const response = await issueToken();
  if (!response.ok)
    throw new Error(`token issuance failed: ${response.status}`);
  return readString(await response.json(), "token");
}

function register(
  token: string,
  declaration: unknown,
  key = `register:${crypto.randomUUID()}`,
): Promise<Response> {
  return exports.default.fetch(
    new Request("http://localhost/api/v1/registration", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(declaration),
    }),
  );
}

function readString(value: unknown, key: string): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    typeof value.data === "object" &&
    value.data !== null &&
    key in value.data &&
    typeof value.data[key as keyof typeof value.data] === "string"
  ) {
    return value.data[key as keyof typeof value.data];
  }
  throw new Error(`response did not contain data.${key}`);
}

async function count(
  table: "schedules" | "registered_actions" | "attempts" | "registrations",
) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM ${table}`,
  ).first<{
    count: number;
  }>();
  return row?.count ?? 0;
}

async function activeScheduleCount() {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM schedules
     WHERE managed_by_registration = 1 AND retired_at IS NULL`,
  ).first<{ count: number }>();
  return row?.count ?? 0;
}
