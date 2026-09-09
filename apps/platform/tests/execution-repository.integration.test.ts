import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApplication } from "../src/application/create-application";
import { CronCalculator } from "../src/infrastructure/cron/cron-calculator";
import {
  ExecutionRepository,
  makeFailureDecision,
  parseSnapshot,
  type FinalizeDecision,
} from "../src/infrastructure/d1/execution-repository";

const now = Date.parse("2026-09-08T00:10:00Z");

describe("ExecutionRepository on D1", () => {
  let repository: ExecutionRepository;

  beforeEach(async () => {
    repository = new ExecutionRepository(env.DB, new CronCalculator());
    await env.DB.batch([
      env.DB.prepare("DELETE FROM api_idempotency"),
      env.DB.prepare("DELETE FROM audit_events"),
      env.DB.prepare("DELETE FROM attempts"),
      env.DB.prepare("DELETE FROM executions"),
      env.DB.prepare("DELETE FROM schedules"),
      env.DB.prepare("DELETE FROM targets"),
      env.DB.prepare(
        "UPDATE platform_state SET dispatch_paused = 0, last_tick_id = NULL, updated_at = 0 WHERE id = 1",
      ),
    ]);
    await env.DB.prepare(
      `INSERT INTO targets (id, label, enabled, manifest_revision, created_at, updated_at)
       VALUES ('DATA', 'Data Worker', 1, 'data-v1', ?, ?)`,
    )
      .bind(now, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO schedules (
         id, name, description, target_id, action, action_version,
         cron_expression, timezone, enabled, revision, payload_json,
         retry_policy_json, timeout_ms, misfire_policy, misfire_grace_seconds,
         next_run_at, created_at, updated_at
       ) VALUES (
         'schedule-1', 'Schedule', '', 'DATA', 'healthCheck', 1,
         '* * * * *', 'UTC', 1, 1, '{}',
         '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}',
         30000, 'coalesce', 300, ?, ?, ?
       )`,
    )
      .bind(now - 60_000, now, now)
      .run();
    await repository.beginTick({
      tickId: "tick",
      scheduledAt: now,
      startedAt: now,
      buildVersion: "test",
    });
  });

  it("atomically materializes one cron occurrence under concurrency", async () => {
    const due = (await repository.listDue(now, 2))[0];
    expect(due).toBeDefined();
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => repository.materializeDue(due!, now)),
    );

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM executions",
    ).first<{ count: number }>();
    expect(count?.count).toBe(1);
    const schedule = await env.DB.prepare(
      "SELECT next_run_at FROM schedules WHERE id = 'schedule-1'",
    ).first<{
      next_run_at: number;
    }>();
    expect(schedule?.next_run_at).toBeGreaterThan(now);
  });

  it("allows only one claim token and one Attempt", async () => {
    const due = (await repository.listDue(now, 2))[0]!;
    await repository.materializeDue(due, now);
    const ready = (await repository.listReady(now, 2))[0]!;
    const claims = await Promise.all(
      Array.from({ length: 20 }, () => repository.claim(ready, now)),
    );

    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    const attempts = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM attempts",
    ).first<{ count: number }>();
    expect(attempts?.count).toBe(1);
  });

  it("rolls back materialization when advancing next_run_at fails", async () => {
    const due = (await repository.listDue(now, 2))[0]!;
    await env.DB.prepare(
      `CREATE TRIGGER force_schedule_update_failure
       BEFORE UPDATE OF next_run_at ON schedules
       BEGIN SELECT RAISE(ABORT, 'forced schedule update failure'); END`,
    ).run();
    await expect(repository.materializeDue(due, now)).rejects.toThrow();
    await env.DB.prepare("DROP TRIGGER force_schedule_update_failure").run();

    const execution = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM executions",
    ).first<{ count: number }>();
    const schedule = await env.DB.prepare(
      "SELECT next_run_at FROM schedules WHERE id = 'schedule-1'",
    ).first<{
      next_run_at: number;
    }>();
    expect(execution?.count).toBe(0);
    expect(schedule?.next_run_at).toBe(now - 60_000);
  });

  it("rolls back a claim when Attempt creation fails", async () => {
    const due = (await repository.listDue(now, 2))[0]!;
    await repository.materializeDue(due, now);
    const ready = (await repository.listReady(now, 2))[0]!;
    await env.DB.prepare(
      `CREATE TRIGGER force_attempt_failure
       BEFORE INSERT ON attempts
       BEGIN SELECT RAISE(ABORT, 'forced attempt failure'); END`,
    ).run();
    await expect(repository.claim(ready, now)).rejects.toThrow();
    await env.DB.prepare("DROP TRIGGER force_attempt_failure").run();

    const execution = await env.DB.prepare(
      "SELECT status, attempt_count, lease_token FROM executions WHERE id = ?",
    )
      .bind(ready.id)
      .first<{
        status: string;
        attempt_count: number;
        lease_token: string | null;
      }>();
    expect(execution).toEqual({
      status: "pending",
      attempt_count: 0,
      lease_token: null,
    });
  });

  it("records a later cron occurrence as overlap while one execution is active", async () => {
    const first = (await repository.listDue(now, 2))[0]!;
    await repository.materializeDue(first, now);
    await env.DB.prepare(
      "UPDATE schedules SET next_run_at = ? WHERE id = 'schedule-1'",
    )
      .bind(now)
      .run();
    const second = (await repository.listDue(now, 2))[0]!;
    expect(await repository.materializeDue(second, now)).toBe(true);

    const rows = await env.DB.prepare(
      "SELECT status, reason_code, finished_at FROM executions ORDER BY created_at, id",
    ).all<{
      status: string;
      reason_code: string | null;
      finished_at: number | null;
    }>();
    expect(rows.results).toEqual(
      expect.arrayContaining([
        { status: "pending", reason_code: null, finished_at: null },
        { status: "skipped", reason_code: "OVERLAP", finished_at: now },
      ]),
    );
  });

  it("rejects a stale lease result", async () => {
    const due = (await repository.listDue(now, 2))[0]!;
    await repository.materializeDue(due, now);
    const ready = (await repository.listReady(now, 2))[0]!;
    const claim = await repository.claim(ready, now);
    expect(claim).not.toBeNull();
    const decision: FinalizeDecision = {
      executionStatus: "succeeded",
      attemptStatus: "succeeded",
      availableAt: now + 1_000,
      nextAttemptReason: "initial",
      resultJson: JSON.stringify({ summary: "done" }),
      errorJson: null,
      targetBuildId: "test",
    };
    expect(await repository.finalize(claim!, decision, now + 1_000)).toBe(true);
    expect(await repository.finalize(claim!, decision, now + 2_000)).toBe(
      false,
    );
  });

  it("recovers an expired lease as unknown when retry-on-unknown is disabled", async () => {
    const due = (await repository.listDue(now, 2))[0]!;
    await repository.materializeDue(due, now);
    const ready = (await repository.listReady(now, 2))[0]!;
    const claim = await repository.claim(ready, now);
    expect(claim).not.toBeNull();
    await env.DB.prepare(
      "UPDATE executions SET lease_expires_at = ? WHERE id = ?",
    )
      .bind(now - 1, claim!.id)
      .run();

    expect(await repository.recoverExpiredLeases(now, 2)).toBe(1);
    const execution = await env.DB.prepare(
      "SELECT status FROM executions WHERE id = ?",
    )
      .bind(claim!.id)
      .first<{ status: string }>();
    expect(execution?.status).toBe("unknown");
  });

  it("cleans terminal history in bounded batches but never removes unknown", async () => {
    const snapshot = JSON.stringify({
      scheduleId: "schedule-1",
      scheduleRevision: 1,
      targetId: "DATA",
      action: "healthCheck",
      actionVersion: 1,
      targetManifestRevision: "data-v1",
      targetActionIdempotent: true,
      payload: {},
      retryPolicy: { maxAttempts: 1, delaysSeconds: [], retryOnUnknown: false },
      timeoutMs: 30_000,
      cronExpression: "* * * * *",
      timezone: "UTC",
    });
    const old = now - 100 * 24 * 60 * 60 * 1000;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO executions (
             id, schedule_id, target_id, source, scheduled_for, dedupe_key,
             schedule_revision, snapshot_json, status, available_at, attempt_limit,
             max_auto_attempts, retry_deadline_at, finished_at, created_at, updated_at
           ) VALUES ('old-success', 'schedule-1', 'DATA', 'cron', ?, 'old-success',
                     1, ?, 'succeeded', ?, 1, 1, ?, ?, ?, ?)`,
      ).bind(old, snapshot, old, old, old, old, old),
      env.DB.prepare(
        `INSERT INTO executions (
             id, schedule_id, target_id, source, scheduled_for, dedupe_key,
             schedule_revision, snapshot_json, status, available_at, attempt_limit,
             max_auto_attempts, retry_deadline_at, created_at, updated_at
           ) VALUES ('old-unknown', 'schedule-1', 'DATA', 'cron', ?, 'old-unknown',
                     1, ?, 'unknown', ?, 1, 1, ?, ?, ?)`,
      ).bind(old + 1, snapshot, old, old, old, old),
      env.DB.prepare(
        `INSERT INTO executions (
             id, schedule_id, target_id, source, scheduled_for, dedupe_key,
             schedule_revision, snapshot_json, status, available_at, attempt_limit,
             max_auto_attempts, retry_deadline_at, created_at, updated_at
           ) VALUES ('legacy-skipped', 'schedule-1', 'DATA', 'cron', ?, 'legacy-skipped',
                     1, ?, 'skipped', ?, 1, 1, ?, ?, ?)`,
      ).bind(old + 2, snapshot, old, old, old, old),
      env.DB.prepare(
        `INSERT INTO audit_events (id, actor, action, entity_type, entity_id, changes_json, created_at)
         VALUES ('old-audit', 'system', 'old', 'system', '1', '{}', ?)`,
      ).bind(old),
      env.DB.prepare(
        `INSERT INTO api_idempotency (scope, key, request_hash, status_code, response_json, created_at, expires_at)
         VALUES ('scope', 'old-key', 'hash', 200, '{}', ?, ?)`,
      ).bind(old, old),
    ]);

    const removed = await repository.cleanupHistory(now);
    expect(removed).toEqual({ executions: 2, audit: 1, idempotency: 1 });
    const remaining = await env.DB.prepare(
      "SELECT id FROM executions ORDER BY id",
    ).all<{ id: string }>();
    expect(remaining.results).toEqual([{ id: "old-unknown" }]);
  });

  it("continues bounded retention cleanup while dispatch is paused", async () => {
    const old = now - 100 * 24 * 60 * 60 * 1000;
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE platform_state SET dispatch_paused = 1 WHERE id = 1",
      ),
      env.DB.prepare(
        `INSERT INTO audit_events (id, actor, action, entity_type, entity_id, changes_json, created_at)
         VALUES ('paused-old-audit', 'system', 'old', 'system', '1', '{}', ?)`,
      ).bind(old),
      env.DB.prepare(
        `INSERT INTO api_idempotency (scope, key, request_hash, status_code, response_json, created_at, expires_at)
         VALUES ('paused-scope', 'paused-old-key', 'hash', 200, '{}', ?, ?)`,
      ).bind(old, old),
    ]);

    const result = await createApplication(env, { nowMs: () => now }).tick.run(
      now,
    );
    expect(result.outcome).toBe("paused");
    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_events WHERE id = 'paused-old-audit'",
    ).first<{ count: number }>();
    const idempotency = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM api_idempotency WHERE key = 'paused-old-key'",
    ).first<{ count: number }>();
    expect(audit?.count).toBe(0);
    expect(idempotency?.count).toBe(0);
  });

  it("uses the due and recent-history indexes on hot queries", async () => {
    const duePlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT id, revision, next_run_at FROM schedules
       WHERE enabled = 1 AND archived_at IS NULL AND next_run_at <= ?
       ORDER BY next_run_at, id LIMIT 2`,
    )
      .bind(now)
      .all<{ detail: string }>();
    const recentPlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT id, status FROM executions ORDER BY created_at DESC, id DESC LIMIT 20`,
    ).all<{ detail: string }>();
    expect(duePlan.results.map((row) => row.detail).join(" ")).toContain(
      "idx_schedules_due",
    );
    expect(recentPlan.results.map((row) => row.detail).join(" ")).toContain(
      "idx_execution_recent",
    );
  });

  it("persists two delayed retries and stops after the third automatic attempt", async () => {
    await env.DB.prepare(
      `UPDATE schedules
       SET retry_policy_json = '{"maxAttempts":3,"delaysSeconds":[60,300],"retryOnUnknown":false}'
       WHERE id = 'schedule-1'`,
    ).run();
    const due = (await repository.listDue(now, 2))[0]!;
    await repository.materializeDue(due, now);
    let availableAt = now;
    let executionId: string | null = null;

    for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber += 1) {
      expect(await repository.listReady(availableAt - 1, 2)).toHaveLength(0);
      const ready = (await repository.listReady(availableAt, 2))[0]!;
      const claim = await repository.claim(ready, availableAt);
      expect(claim).not.toBeNull();
      executionId ??= claim!.id;
      expect(claim!.id).toBe(executionId);
      expect(claim!.attempt_count).toBe(attemptNumber);
      const snapshot = parseSnapshot(claim!.snapshot_json);
      const decision = makeFailureDecision({
        snapshot,
        attemptNumber,
        nowMs: availableAt + 1000,
        retryDeadlineAt: claim!.retry_deadline_at,
        currentIdempotent: true,
        retryable: true,
        unknown: false,
        errorJson: JSON.stringify({
          code: "UPSTREAM_503",
          message: "temporary",
        }),
      });
      expect(
        await repository.finalize(claim!, decision, availableAt + 1000),
      ).toBe(true);
      if (attemptNumber < 3) {
        expect(decision.executionStatus).toBe("retry_wait");
        availableAt = decision.availableAt;
      } else {
        expect(decision.executionStatus).toBe("failed");
      }
    }

    const execution = await env.DB.prepare(
      "SELECT status, attempt_count FROM executions WHERE id = ?",
    )
      .bind(executionId)
      .first<{ status: string; attempt_count: number }>();
    const attempts = await env.DB.prepare(
      "SELECT number FROM attempts WHERE execution_id = ? ORDER BY number",
    )
      .bind(executionId)
      .all<{ number: number }>();
    expect(execution).toEqual({ status: "failed", attempt_count: 3 });
    expect(attempts.results).toEqual([
      { number: 1 },
      { number: 2 },
      { number: 3 },
    ]);
    expect(await repository.listReady(availableAt + 1_000_000, 2)).toHaveLength(
      0,
    );
  });
});
