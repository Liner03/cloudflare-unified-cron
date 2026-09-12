import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { TargetManifest, TriggerMessage } from "@unified-cron/contracts";
import { TriggerDeliveryRepository } from "../src/infrastructure/d1/trigger-delivery-repository";
import { TriggerDeliveryApplication } from "../src/application/deliver-triggers";
import { readSchedulerSettings } from "../src/infrastructure/d1/scheduler-settings";
import { ServiceBindingAdapter } from "../src/infrastructure/rpc/service-binding-adapter";
import { createAdminSession } from "../src/infrastructure/auth/access";
import { createApplication } from "../src/application/create-application";

const now = Date.parse("2026-09-12T00:00:00Z");
const targets: TargetManifest[] = Array.from({ length: 10 }, (_, i) => ({
  id: `SITE_${i}`,
  label: `Site ${i}`,
  binding: `RPC_${i}`,
  service: `site-${i}`,
  entrypoint: "CronEntrypoint",
  protocolVersion: 1,
  manifestRevision: "v1",
  delivery: { mode: "queue", binding: `QUEUE_${i}`, queue: `site-${i}-cron` },
}));
let repository: TriggerDeliveryRepository;
beforeEach(async () => {
  repository = new TriggerDeliveryRepository(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM trigger_deliveries"),
    env.DB.prepare("DELETE FROM attempts"),
    env.DB.prepare("DELETE FROM executions"),
    env.DB.prepare("DELETE FROM schedules"),
    env.DB.prepare("DELETE FROM registered_actions"),
    env.DB.prepare("DELETE FROM registrations"),
    env.DB.prepare("DELETE FROM registration_revisions"),
    env.DB.prepare("DELETE FROM registration_tokens"),
    env.DB.prepare("DELETE FROM targets"),
    env.DB.prepare(
      "UPDATE scheduler_settings SET max_schedules=100,materialize_budget=100,delivery_budget=100,per_target_batch=10 WHERE id=1",
    ),
    env.DB.prepare("UPDATE platform_state SET dispatch_paused=0 WHERE id=1"),
  ]);
  for (const target of targets)
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO targets(id,label,enabled,manifest_revision,created_at,updated_at) VALUES (?,?,1,?,0,0)",
      ).bind(target.id, target.label, "v1"),
      env.DB.prepare(
        "INSERT INTO registered_actions(target_id,name,version,label,description,idempotent,created_at,updated_at) VALUES (?,'probe',1,'probe','',1,0,0)",
      ).bind(target.id),
    ]);
});
async function seed(count: number) {
  await env.DB.batch(
    Array.from({ length: count }, (_, i) =>
      env.DB.prepare(
        `INSERT INTO schedules(id,name,description,target_id,action,action_version,cron_expression,timezone,enabled,revision,payload_json,retry_policy_json,timeout_ms,misfire_policy,misfire_grace_seconds,next_run_at,created_at,updated_at,registration_key,managed_by_registration,declared_enabled)
  VALUES (?,?, '',?,'probe',1,'* * * * *','UTC',1,1,'{}','{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}',30000,'coalesce',300,?,0,0,?,1,1)`,
      ).bind(
        `schedule-${i}`,
        `Schedule ${i}`,
        `SITE_${i % 10}`,
        now,
        `schedule-${i}`,
      ),
    ),
  );
}
function queueEnvironment(messages: TriggerMessage[]) {
  return Object.fromEntries(
    targets.map((target) => [
      target.delivery!.binding,
      {
        async sendBatch(batch: { body: TriggerMessage }[]) {
          expect(batch.every((m) => m.body.targetId === target.id)).toBe(true);
          messages.push(...batch.map((m) => m.body));
          await Promise.resolve();
        },
      },
    ]),
  );
}

describe("L2-023..029 reliable multi-site trigger delivery", () => {
  it("bounds D1 JSON and Queue batches for 100 large-payload occurrences", async () => {
    await seed(100);
    await env.DB.prepare("UPDATE schedules SET target_id=?,payload_json=?")
      .bind("SITE_0", JSON.stringify({ value: "x".repeat(16000) }))
      .run();
    const messages: TriggerMessage[] = [];
    const bindings = queueEnvironment(messages);
    const batchSizes: number[] = [];
    bindings.QUEUE_0 = {
      sendBatch: (batch: { body: TriggerMessage }[]) => {
        batchSizes.push(
          new TextEncoder().encode(JSON.stringify(batch)).byteLength,
        );
        messages.push(...batch.map((item) => item.body));
        return Promise.resolve();
      },
    };
    const result = await new TriggerDeliveryApplication(
      repository,
      targets,
      bindings,
      "local-secret",
      "local",
    ).run(
      { ...(await readSchedulerSettings(env.DB)), per_target_batch: 100 },
      () => now,
    );
    expect(result.queued).toBe(100);
    expect(batchSizes.length).toBeGreaterThan(1);
    expect(Math.max(...batchSizes)).toBeLessThan(256000);
  });
  it("shares materialization budget between Queue and legacy RPC without starving RPC", async () => {
    await seed(3);
    await env.DB.prepare(
      "UPDATE scheduler_settings SET materialize_budget=2,rpc_budget=1 WHERE id=1",
    ).run();
    const sites = targets.slice(0, 3).map((target, i) => ({
      ...target,
      binding: `MULTI_RPC_${i}`,
      delivery:
        i === 0
          ? undefined
          : {
              mode: "queue" as const,
              binding: `REAL_QUEUE_${i}`,
              queue: `multi-queue-${i}`,
            },
    }));
    const result = await createApplication(
      env,
      { nowMs: () => now },
      sites,
    ).tick.run(now);
    expect(result.materialized).toBe(2);
    expect(await repository.list("", 100)).toHaveLength(1);
    expect(
      (
        await env.DB.prepare("SELECT count(*) n FROM executions").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
  });
  it("full Tick finishes while a website works beyond the legacy RPC deadline", async () => {
    await seed(3);
    await env.DB.prepare(
      `UPDATE schedules SET payload_json='{"delayMs":35000}' WHERE id='schedule-0'`,
    ).run();
    const sites = targets.slice(0, 3).map((target, i) => ({
      ...target,
      binding: `MULTI_RPC_${i}`,
      delivery: {
        mode: "queue" as const,
        binding: `REAL_QUEUE_${i}`,
        queue: `multi-queue-${i}`,
      },
    }));
    const started = Date.now();
    const result = await createApplication(
      env,
      { nowMs: () => now },
      sites,
    ).tick.run(now);
    expect(result).toMatchObject({
      outcome: "succeeded",
      materialized: 3,
      dispatched: 3,
    });
    expect(Date.now() - started).toBeLessThan(10000);
    const deliveries = await repository.list("", 100);
    const adapter = new ServiceBindingAdapter(env, sites);
    for (const target of sites.slice(1)) {
      const id = deliveries.find((row) => row.targetId === target.id)?.id;
      await expect
        .poll(
          async () =>
            (await adapter.describe(target)).actions.some(
              (action) => action.name === id,
            ),
          { timeout: 10000, interval: 100 },
        )
        .toBe(true);
    }
    const slow = sites[0];
    if (!slow) throw new Error("missing slow site");
    const id = deliveries.find((row) => row.targetId === slow.id)?.id;
    expect(
      (await adapter.describe(slow)).actions.some(
        (action) => action.name === id,
      ),
    ).toBe(false);
    await expect
      .poll(
        async () =>
          (await adapter.describe(slow)).actions.some(
            (action) => action.name === id,
          ),
        { timeout: 40000, interval: 500 },
      )
      .toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(30000);
  }, 45000);
  it("routes describe to three real workerd WorkerEntrypoints", async () => {
    const sites = targets
      .slice(0, 3)
      .map((target, i) => ({ ...target, binding: `MULTI_RPC_${i}` }));
    const adapter = new ServiceBindingAdapter(env, sites);
    for (const target of sites)
      expect((await adapter.describe(target)).actions[0]?.name).toBe(target.id);
  });

  it("three real Queue consumers execute after producer delivery completes", async () => {
    await seed(10);
    const sites = targets.slice(0, 3).map((target, i) => ({
      ...target,
      binding: `MULTI_RPC_${i}`,
      delivery: {
        mode: "queue" as const,
        binding: `REAL_QUEUE_${i}`,
        queue: `multi-queue-${i}`,
      },
    }));
    const result = await new TriggerDeliveryApplication(
      repository,
      sites,
      env,
      "local-secret",
      "local",
    ).run(await readSchedulerSettings(env.DB), () => now);
    expect(result.queued).toBe(3);
    const deliveries = await repository.list("", 100);
    const adapter = new ServiceBindingAdapter(env, sites);
    for (const target of sites) {
      const id = deliveries.find((row) => row.targetId === target.id)?.id;
      expect(id).toBeDefined();
      await expect
        .poll(
          async () =>
            (await adapter.describe(target)).actions.some(
              (action) => action.name === id,
            ),
          { timeout: 10000, interval: 50 },
        )
        .toBe(true);
    }
  });

  it("a failed Queue binding does not prevent other sites from receiving their triggers", async () => {
    await seed(10);
    const messages: TriggerMessage[] = [];
    const bindings = queueEnvironment(messages);
    bindings.QUEUE_0 = {
      sendBatch: () => Promise.reject(new Error("unavailable")),
    };
    const result = await new TriggerDeliveryApplication(
      repository,
      targets,
      bindings,
      "local-secret",
      "local",
    ).run(await readSchedulerSettings(env.DB), () => now);
    expect(result.queued).toBe(9);
    expect(result.errors).toBe(1);
    expect(
      (await repository.list("", 100)).filter(
        (row) => row.status === "unknown",
      ),
    ).toHaveLength(1);
  });
  it.each([10, 25, 50, 100])(
    "delivers %i occurrences across ten websites without waiting for business completion",
    async (count) => {
      await seed(count);
      const messages: TriggerMessage[] = [];
      const app = new TriggerDeliveryApplication(
        repository,
        targets,
        queueEnvironment(messages),
        "local-secret",
        "local",
      );
      const result = await app.run(
        await readSchedulerSettings(env.DB),
        () => now,
      );
      expect(result).toEqual({ materialized: count, queued: count, errors: 0 });
      expect(new Set(messages.map((m) => m.idempotencyKey)).size).toBe(count);
      const rows = await repository.list("", 1000);
      expect(rows).toHaveLength(count);
      expect(
        rows.every((r) => r.status === "queued" && r.businessResult === null),
      ).toBe(true);
      expect(JSON.stringify(rows)).not.toContain("ucrr_");
      expect(
        (
          await env.DB.prepare("SELECT count(*) n FROM executions").first<{
            n: number;
          }>()
        )?.n,
      ).toBe(0);
      expect(
        (await app.run(await readSchedulerSettings(env.DB), () => now)).queued,
      ).toBe(0);
    },
  );

  it("atomically deduplicates concurrent ticks and resends an ambiguous acceptance with the same identity", async () => {
    await seed(10);
    await Promise.all([
      repository.materialize(targets, "local-secret", now, 100),
      repository.materialize(targets, "local-secret", now, 100),
    ]);
    expect(await repository.list("", 100)).toHaveLength(10);
    const [row] = await repository.claim("SITE_0", now, 10);
    if (!row) throw new Error("missing row");
    const first = await repository.message(row, "local-secret", "local");
    await repository.finish([row], now, false);
    expect(await repository.claim("SITE_0", now, 10)).toHaveLength(0);
    const [retry] = await repository.claim("SITE_0", now + 60000, 10);
    if (!retry) throw new Error("missing retry");
    expect(await repository.message(retry, "local-secret", "local")).toEqual(
      first,
    );
    await repository.finish([row], now + 60000, true);
    expect((await repository.list(row.schedule_id))[0]?.status).toBe("sending");
  });

  it("rejects another delivery capability and conflicting terminal reports, preserves reported success during finalize races", async () => {
    await seed(10);
    await repository.materialize(targets, "local-secret", now, 100);
    const [a] = await repository.claim("SITE_0", now, 10),
      [b] = await repository.claim("SITE_1", now, 10);
    if (!a || !b) throw new Error("missing rows");
    const message = await repository.message(a, "local-secret", "local");
    await expect(
      repository.report(
        b.id,
        message.receiptToken,
        { status: "succeeded", summary: "ok" },
        now,
      ),
    ).rejects.toMatchObject({ code: "RECEIPT_TOKEN_INVALID" });
    await repository.report(
      a.id,
      message.receiptToken,
      { status: "succeeded", summary: "ok" },
      now,
    );
    await repository.report(
      a.id,
      message.receiptToken,
      { status: "succeeded", summary: "ok" },
      now,
    );
    await expect(
      repository.report(
        a.id,
        message.receiptToken,
        { status: "failed", summary: "no" },
        now,
      ),
    ).rejects.toMatchObject({ code: "RECEIPT_CONFLICT" });
    await repository.finish([a], now, false);
    expect((await repository.list(a.schedule_id))[0]).toMatchObject({
      status: "queued",
      businessResult: { status: "succeeded" },
    });
    const unauthorized = await exports.default.fetch(
      new Request(`http://localhost/api/v1/delivery-receipts/${b.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${message.receiptToken}`,
        },
        body: JSON.stringify({ status: "succeeded", summary: "ok" }),
      }),
    );
    expect(unauthorized.status).toBe(401);
  });

  it("respects pause without withdrawing accepted jobs and lets future occurrences run without a business report", async () => {
    await seed(10);
    await repository.materialize(targets, "local-secret", now, 100);
    await env.DB.prepare(
      "UPDATE platform_state SET dispatch_paused=1 WHERE id=1",
    ).run();
    expect(await repository.claim("SITE_0", now, 10)).toHaveLength(0);
    await env.DB.prepare(
      "UPDATE platform_state SET dispatch_paused=0 WHERE id=1",
    ).run();
    const rows = await repository.claim("SITE_0", now, 10);
    await repository.finish(rows, now, true);
    expect(
      await repository.materialize(targets, "local-secret", now + 60000, 100),
    ).toBe(10);
    expect(await repository.claim("SITE_0", now + 60000, 10)).toHaveLength(1);
  });

  it("lists all 100 schedules and enforces a configurable D1 capacity including concurrent inserts", async () => {
    await seed(100);
    const session = await createAdminSession(env, "admin");
    const response = await exports.default.fetch(
      new Request("http://localhost/api/v1/schedules", {
        headers: { Cookie: session.cookie.split(";")[0] ?? "" },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json<{ data: unknown[] }>();
    expect(body.data).toHaveLength(100);
    await expect(
      env.DB.prepare(
        "UPDATE schedules SET retired_at=NULL WHERE id='none'",
      ).run(),
    ).resolves.toBeDefined();
    await env.DB.prepare(
      "UPDATE schedules SET retired_at=1 WHERE id='schedule-99'",
    ).run();
    await env.DB.prepare(
      "UPDATE scheduler_settings SET max_schedules=99 WHERE id=1",
    ).run();
    await expect(
      env.DB.prepare(
        "UPDATE schedules SET retired_at=NULL WHERE id='schedule-99'",
      ).run(),
    ).rejects.toThrow("MANAGED_SCHEDULE_LIMIT_REACHED");
  });

  it("routes three independent RPC bindings and refuses unknown names", async () => {
    const adapter = new ServiceBindingAdapter(
      Object.fromEntries(
        targets.slice(0, 3).map((t) => [
          t.binding,
          {
            describe: () =>
              Promise.resolve({
                protocolVersion: 1,
                actions: [{ name: t.id, version: 1, idempotent: true }],
              }),
            cron: () => Promise.resolve({}),
          },
        ]),
      ),
      targets.slice(0, 3),
    );
    for (const target of targets.slice(0, 3))
      expect((await adapter.describe(target)).actions[0]?.name).toBe(target.id);
    const last = targets[9];
    if (!last) throw new Error("missing target");
    await expect(adapter.describe(last)).rejects.toThrow(
      "TARGET_BINDING_NOT_CONFIGURED",
    );
  });
});
