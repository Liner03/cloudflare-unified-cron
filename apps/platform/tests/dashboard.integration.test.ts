import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewRepository } from "../src/infrastructure/d1/overview-repository";
import { ManagedScheduleRepository } from "../src/infrastructure/d1/managed-schedule-repository";
import { RunHistoryRepository } from "../src/infrastructure/d1/run-history-repository";
import { TriggerDeliveryRepository } from "../src/infrastructure/d1/trigger-delivery-repository";
import { parseCursor } from "../src/api/http-support";
import { sha256Hex } from "../src/infrastructure/security/crypto";
import { consumeDispatchQueue } from "../src/application/consume-dispatch-queue";
import { ServiceBindingAdapter } from "../src/infrastructure/rpc/service-binding-adapter";
import { getTargetManifest } from "../src/targets.manifest";
import type {
  CronRequestV1,
  CronResultV1,
  TriggerMessage,
} from "@unified-cron/contracts";

const now = Date.parse("2026-10-15T05:40:00Z");
afterEach(() => vi.restoreAllMocks());

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM trigger_deliveries"),
    env.DB.prepare("DELETE FROM attempts"),
    env.DB.prepare("DELETE FROM executions"),
    env.DB.prepare("DELETE FROM schedules"),
    env.DB.prepare("DELETE FROM registered_actions"),
    env.DB.prepare("DELETE FROM targets"),
    env.DB.prepare(
      "UPDATE platform_state SET dispatch_paused=0,last_successful_tick_at=? WHERE id=1",
    ).bind(now),
    env.DB.prepare(
      "INSERT INTO targets(id,label,enabled,manifest_revision,created_at,updated_at) VALUES ('DASH','Dashboard site',1,'v1',0,0)",
    ),
    env.DB.prepare(
      `INSERT INTO schedules(id,name,target_id,action,action_version,cron_expression,timezone,enabled,revision,payload_json,retry_policy_json,timeout_ms,misfire_policy,misfire_grace_seconds,next_run_at,created_at,updated_at,registration_key,managed_by_registration,declared_enabled)
      VALUES ('dash-schedule','Dashboard task','DASH','probe',1,'* * * * *','UTC',1,1,'{}','{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}',30000,'coalesce',300,?,0,0,'dash',1,1)`,
    ).bind(now + 60000),
  ]);
});

async function delivery(
  id: string,
  status: "succeeded" | "failed" | null,
  age: number,
  attempts: number | null = null,
) {
  await env.DB.prepare(
    `INSERT INTO trigger_deliveries(id,schedule_id,target_id,scheduled_for,snapshot_json,status,attempts,available_at,receipt_hash,queued_at,result_json,result_at,created_at,updated_at)
    VALUES (?,'dash-schedule','DASH',?,'{"action":"probe","actionVersion":1,"payload":{}}','queued',1,?,'test-hash',?,?,?,?,?)`,
  )
    .bind(
      id,
      now - age,
      now - age,
      now - age,
      status === null ? null : JSON.stringify({ status, summary: id }),
      status === null ? null : now - age,
      now - age,
      now - age,
    )
    .run();
  if (attempts !== null)
    await env.DB.prepare(
      "UPDATE trigger_deliveries SET consumer_attempts=? WHERE id=?",
    )
      .bind(attempts, id)
      .run();
}

describe("dashboard Queue and RPC read model", () => {
  async function queueMessage() {
    const target = getTargetManifest("DATA_A");
    if (!target) throw new Error("missing Queue fixture target");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO targets(id,label,enabled,manifest_revision,created_at,updated_at) VALUES ('DATA_A','Queue fixture',1,'v1',0,0)",
      ),
      env.DB.prepare(
        "INSERT INTO registered_actions(target_id,name,version,label,description,idempotent,created_at,updated_at) VALUES ('DATA_A','probe',1,'probe','',1,0,0)",
      ),
      env.DB.prepare(
        "INSERT INTO schedules(id,name,description,target_id,action,action_version,cron_expression,timezone,enabled,archived_at,revision,payload_json,retry_policy_json,timeout_ms,misfire_policy,misfire_grace_seconds,next_run_at,last_materialized_for,created_at,updated_at,registration_key,managed_by_registration,declared_enabled,operator_paused,retired_at) SELECT 'queue-schedule',name,description,'DATA_A',action,action_version,cron_expression,timezone,enabled,archived_at,revision,payload_json,retry_policy_json,timeout_ms,misfire_policy,misfire_grace_seconds,?,last_materialized_for,created_at,updated_at,registration_key,managed_by_registration,declared_enabled,operator_paused,retired_at FROM schedules WHERE id='dash-schedule'",
      ).bind(now),
    ]);
    const repository = new TriggerDeliveryRepository(env.DB);
    await repository.materialize([target], "regression-signing-key", now, 1);
    const [row] = await repository.claim("DATA_A", now, 1);
    if (!row) throw new Error("missing Queue occurrence");
    const body = await repository.message(
      row,
      "regression-signing-key",
      "test",
    );
    await repository.finish([row], now, true);
    return body;
  }

  function batch(
    body: TriggerMessage,
    attempts: number,
  ): MessageBatch<unknown> {
    return {
      queue: env.DISPATCH_QUEUE_NAME,
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      messages: [
        {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          body,
          attempts,
          ack: vi.fn(),
          retry: vi.fn(),
        },
      ],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    };
  }

  it("counts two business invocations across distinct Queue messages whose attempt indexes both start at one", async () => {
    const body = await queueMessage();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const execute = vi
      .fn<(request: CronRequestV1) => Promise<CronResultV1>>()
      .mockRejectedValueOnce(new Error("first RPC interrupted"))
      .mockImplementation((request) =>
        Promise.resolve({
          protocolVersion: 1,
          executionId: request.executionId,
          attemptId: request.attemptId,
          ok: true,
          summary: "done",
        }),
      );
    vi.spyOn(
      ServiceBindingAdapter.prototype,
      "prepareExecution",
    ).mockReturnValue(execute);
    await consumeDispatchQueue(batch(body, 1), env);
    await consumeDispatchQueue(batch(body, 1), env);
    expect(execute).toHaveBeenCalledTimes(2);
    const [row] = await new TriggerDeliveryRepository(env.DB).list(
      "queue-schedule",
    );
    expect(row?.businessAttempts).toBe(2);
    expect(
      execute.mock.calls.map(([request]) => request.attemptNumber),
    ).toEqual([1, 2]);
    const { data } = await new OverviewRepository(env.DB).read(now);
    expect(data.successRates[0]?.firstAttempt).toMatchObject({
      numerator: 0,
      denominator: 1,
      rate: 0,
    });
  });

  it("does not count a Queue retry that failed before starting the business RPC", async () => {
    const body = await queueMessage();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(
      TriggerDeliveryRepository.prototype,
      "consumerStarted",
    ).mockRejectedValueOnce(new Error("D1 unavailable before RPC"));
    const execute = vi
      .fn<(request: CronRequestV1) => Promise<CronResultV1>>()
      .mockImplementation((request) =>
        Promise.resolve({
          protocolVersion: 1,
          executionId: request.executionId,
          attemptId: request.attemptId,
          ok: true,
          summary: "done",
        }),
      );
    vi.spyOn(
      ServiceBindingAdapter.prototype,
      "prepareExecution",
    ).mockReturnValue(execute);
    await consumeDispatchQueue(batch(body, 1), env);
    await consumeDispatchQueue(batch(body, 2), env);
    expect(execute).toHaveBeenCalledTimes(1);
    const [row] = await new TriggerDeliveryRepository(env.DB).list(
      "queue-schedule",
    );
    expect(row?.businessAttempts).toBe(1);
    expect(execute.mock.calls[0]?.[0].attemptNumber).toBe(1);
    const { data } = await new OverviewRepository(env.DB).read(now);
    expect(data.successRates[0]?.firstAttempt).toMatchObject({
      numerator: 1,
      denominator: 1,
      rate: 1,
    });
  });

  it("removes an unused business reservation when D1 commits but its acknowledgement is lost", async () => {
    const body = await queueMessage();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const repository = new TriggerDeliveryRepository(env.DB);
    const original = repository.consumerStarted.bind(repository);
    vi.spyOn(
      TriggerDeliveryRepository.prototype,
      "consumerStarted",
    ).mockImplementationOnce(async (...args: Parameters<typeof original>) => {
      await original(...args);
      throw new Error("D1 acknowledgement lost");
    });
    const execute = vi
      .fn<(request: CronRequestV1) => Promise<CronResultV1>>()
      .mockImplementation((request) =>
        Promise.resolve({
          protocolVersion: 1,
          executionId: request.executionId,
          attemptId: request.attemptId,
          ok: true,
          summary: "done",
        }),
      );
    vi.spyOn(
      ServiceBindingAdapter.prototype,
      "prepareExecution",
    ).mockReturnValue(execute);
    await consumeDispatchQueue(batch(body, 1), env);
    await consumeDispatchQueue(batch(body, 2), env);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      (await new TriggerDeliveryRepository(env.DB).list("queue-schedule"))[0]
        ?.businessAttempts,
    ).toBe(1);
    expect(
      (
        await env.DB.prepare(
          "SELECT id FROM trigger_consumer_attempts WHERE delivery_id=?",
        )
          .bind(body.deliveryId)
          .all()
      ).results,
    ).toHaveLength(1);
  });

  it("preserves unknown historical counts and does not invoke a task again after its terminal receipt", async () => {
    const body = await queueMessage();
    await env.DB.prepare(
      "UPDATE trigger_deliveries SET consumer_attempts=NULL WHERE id=?",
    )
      .bind(body.deliveryId)
      .run();
    const execute = vi
      .fn<(request: CronRequestV1) => Promise<CronResultV1>>()
      .mockImplementation((request) =>
        Promise.resolve({
          protocolVersion: 1,
          executionId: request.executionId,
          attemptId: request.attemptId,
          ok: true,
          summary: "done",
        }),
      );
    vi.spyOn(
      ServiceBindingAdapter.prototype,
      "prepareExecution",
    ).mockReturnValue(execute);
    await consumeDispatchQueue(batch(body, 1), env);
    await consumeDispatchQueue(batch(body, 1), env);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      (await new TriggerDeliveryRepository(env.DB).list("queue-schedule"))[0]
        ?.businessAttempts,
    ).toBeNull();
    expect(
      (await new OverviewRepository(env.DB).read(Date.now())).data
        .successRates[0]?.firstAttempt.denominator,
    ).toBe(0);
  });

  it("keeps the attempt count unknown when a committed reservation cannot be cancelled during a D1 outage", async () => {
    const body = await queueMessage();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const repository = new TriggerDeliveryRepository(env.DB);
    const original = repository.consumerStarted.bind(repository);
    vi.spyOn(
      TriggerDeliveryRepository.prototype,
      "consumerStarted",
    ).mockImplementationOnce(async (...args: Parameters<typeof original>) => {
      await original(...args);
      throw new Error("D1 acknowledgement lost");
    });
    vi.spyOn(
      TriggerDeliveryRepository.prototype,
      "consumerNotStarted",
    ).mockRejectedValueOnce(new Error("D1 unavailable during compensation"));
    const execute = vi
      .fn<(request: CronRequestV1) => Promise<CronResultV1>>()
      .mockImplementation((request) =>
        Promise.resolve({
          protocolVersion: 1,
          executionId: request.executionId,
          attemptId: request.attemptId,
          ok: true,
          summary: "done",
        }),
      );
    vi.spyOn(
      ServiceBindingAdapter.prototype,
      "prepareExecution",
    ).mockReturnValue(execute);
    await consumeDispatchQueue(batch(body, 1), env);
    await consumeDispatchQueue(batch(body, 2), env);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      (await repository.list("queue-schedule"))[0]?.businessAttempts,
    ).toBeNull();
    expect(
      (await new OverviewRepository(env.DB).read(Date.now())).data
        .successRates[0]?.firstAttempt.denominator,
    ).toBe(0);
  });

  it("restores the adjacent page from API boundaries for both histories with tied timestamps", async () => {
    for (let index = 0; index < 55; index++)
      await delivery(
        `bidirectional-${String(index).padStart(2, "0")}`,
        "succeeded",
        1000 + index,
      );
    await env.DB.prepare("UPDATE trigger_deliveries SET created_at=?")
      .bind(now - 1000)
      .run();
    const input = {
      status: "",
      source: "",
      mode: "queue",
      targetId: "DASH",
      scheduleId: "dash-schedule",
      from: null,
      to: null,
      cursor: null,
      limit: 20,
      now,
      result: "",
    };
    for (const repository of [
      new RunHistoryRepository(env.DB),
      new TriggerDeliveryRepository(env.DB),
    ]) {
      const read = (cursor: string | null, direction: "next" | "previous") =>
        repository instanceof RunHistoryRepository
          ? repository.list({
              ...input,
              cursor: parseCursor(cursor ?? undefined),
              direction,
            })
          : repository.page({
              ...input,
              cursor: parseCursor(cursor ?? undefined),
              direction,
            });
      const first = await read(null, "next");
      const second = await read(first.meta.nextCursor, "next"),
        third = await read(second.meta.nextCursor, "next");
      expect(first.meta.previousCursor).toBeNull();
      expect(third.data).toHaveLength(15);
      expect(third.meta.nextCursor).toBeNull();
      const restoredSecond = await read(third.meta.previousCursor, "previous");
      expect(restoredSecond.data.map((row) => row.id)).toEqual(
        second.data.map((row) => row.id),
      );
      const restoredFirst = await read(
        restoredSecond.meta.previousCursor,
        "previous",
      );
      expect(restoredFirst.data.map((row) => row.id)).toEqual(
        first.data.map((row) => row.id),
      );
      expect(restoredFirst.meta.previousCursor).toBeNull();
    }
  });

  it("includes reported Queue success in history, last result and rates without inventing a first attempt", async () => {
    await delivery("success", "succeeded", 1000);
    const overview = await new OverviewRepository(env.DB).read(now);
    expect(overview.data.executions24h).toContainEqual({
      status: "succeeded",
      count: 1,
    });
    expect(overview.data.successRates[0]).toMatchObject({
      execution: { numerator: 1, denominator: 1, rate: 1 },
      firstAttempt: { numerator: 0, denominator: 0, rate: null },
    });
    const schedules = await new ManagedScheduleRepository(env.DB).list({
      search: "",
      target: "",
      enabled: "",
    });
    expect(schedules[0]?.lastExecution?.status).toBe("succeeded");
  });

  it("retains failures beyond the latest fifty runs and accounts for the complete signal window", async () => {
    await delivery("failure", "failed", 120000);
    for (let index = 0; index < 60; index++)
      await delivery(`success-${index}`, "succeeded", index * 1000);
    const { data } = await new OverviewRepository(env.DB).read(now);
    expect(data).toMatchObject({
      attention: { total: 1, items: [{ id: "failure", status: "failed" }] },
    });
    const signals = data.signalBuckets;
    expect(signals.reduce((sum, signal) => sum + signal.count, 0)).toBe(61);
  });

  it("keeps unreported outcomes out of business rates and never fabricates business attempts", async () => {
    await delivery("unreported", null, 1000);
    const { data } = await new OverviewRepository(env.DB).read(now);
    expect(data).toMatchObject({
      coverage: { total: 1, succeeded: 0, unreported: 1 },
    });
    expect(data.successRates[0]?.execution).toMatchObject({
      denominator: 0,
      rate: null,
    });
  });

  it("counts actual consumer attempts separately from send attempts and excludes historical unknown counts", async () => {
    await delivery("historical", "succeeded", 4000);
    await delivery("first", "succeeded", 3000, 1);
    await delivery("retry", "succeeded", 2000, 2);
    await delivery("failed", "failed", 1000, 1);
    const { data } = await new OverviewRepository(env.DB).read(now);
    expect(data.successRates[0]).toMatchObject({
      execution: { numerator: 3, denominator: 4 },
      firstAttempt: { numerator: 1, denominator: 3 },
    });
  });

  it("paginates tied timestamps without duplicates and scopes totals to the same filters", async () => {
    for (let index = 0; index < 55; index++)
      await delivery(
        `tied-${String(index).padStart(2, "0")}`,
        index % 2 === 0 ? "succeeded" : "failed",
        1000 + index,
      );
    await env.DB.prepare("UPDATE trigger_deliveries SET created_at=?")
      .bind(now - 1000)
      .run();
    const input = {
      status: "",
      source: "",
      mode: "queue",
      targetId: "DASH",
      scheduleId: "dash-schedule",
      from: now - 2000,
      to: now,
      cursor: null,
      limit: 50,
      now,
    };
    const history = new RunHistoryRepository(env.DB);
    const first = await history.list(input);
    expect(first.meta.total).toBe(55);
    expect(first.data).toHaveLength(50);
    const last = first.data.at(-1);
    if (!last) throw new Error("missing page boundary");
    const second = await history.list({
      ...input,
      cursor: { id: last.id, createdAt: Date.parse(last.createdAt ?? "") },
    });
    expect(second.data).toHaveLength(5);
    expect(second.meta.total).toBe(55);
    expect(second.meta.nextCursor).toBeNull();
    expect(
      new Set([...first.data, ...second.data].map((row) => row.id)).size,
    ).toBe(55);
    const filtered = await history.list({ ...input, status: "failed" });
    expect(filtered.meta.total).toBe(27);
    expect(filtered.summary).toEqual([{ status: "failed", count: 27 }]);
    const deliveries = await new TriggerDeliveryRepository(env.DB).page({
      ...input,
      result: "failed",
      status: "",
      targetId: "OTHER",
    });
    expect(deliveries.meta.total).toBe(0);
    expect(deliveries.summary).toEqual([]);
    const selected = await new TriggerDeliveryRepository(env.DB).page({
      ...input,
      result: "failed",
      status: "",
    });
    expect(selected.meta.total).toBe(27);
    expect(selected.outcomes).toEqual([{ status: "failed", count: 27 }]);
  });

  it("exposes consumer progress and retries without changing a recorded terminal outcome", async () => {
    await delivery("progress", null, 1000, 0);
    const deliveries = new TriggerDeliveryRepository(env.DB);
    const history = new RunHistoryRepository(env.DB);
    await deliveries.consumerStarted("progress", "progress-1", now);
    expect(await history.detail("progress")).toMatchObject({
      status: "running",
      attemptCount: 1,
    });
    await deliveries.consumerFailed("progress", "connection interrupted", now);
    expect(await history.detail("progress")).toMatchObject({
      status: "retry_wait",
      reasonCode: "connection interrupted",
    });
    await deliveries.consumerStarted("progress", "progress-2", now);
    expect(await history.detail("progress")).toMatchObject({
      status: "running",
      attemptCount: 2,
      reasonCode: null,
    });
    await deliveries.consumerFailed(
      "progress",
      "response was interrupted",
      now,
    );
    const token = "local-diagnostic-receipt";
    await env.DB.prepare(
      "UPDATE trigger_deliveries SET receipt_hash=? WHERE id='progress'",
    )
      .bind(await sha256Hex(token))
      .run();
    await deliveries.report(
      "progress",
      token,
      { status: "succeeded", summary: "done" },
      now,
    );
    await deliveries.consumerFailed("progress", "late failure", now);
    expect(await history.detail("progress")).toMatchObject({
      status: "succeeded",
      reasonCode: null,
    });
  });

  it("makes retained deliveries older than the first thousand reachable by cursor", async () => {
    await env.DB.prepare(
      `INSERT INTO trigger_deliveries(id,schedule_id,target_id,scheduled_for,snapshot_json,status,attempts,available_at,receipt_hash,queued_at,result_json,result_at,created_at,updated_at)
      SELECT printf('old-%04d',value),'dash-schedule','DASH',?-value,'{}','queued',1,?,'test-hash',?,'{"status":"succeeded","summary":"retained"}',?,?,?
      FROM json_each(?)`,
    )
      .bind(
        now,
        now,
        now,
        now,
        now,
        now,
        JSON.stringify(Array.from({ length: 1005 }, (_, index) => index)),
      )
      .run();
    const repository = new TriggerDeliveryRepository(env.DB);
    const input = {
      scheduleId: "dash-schedule",
      targetId: "DASH",
      status: "",
      result: "",
      from: null,
      to: null,
      cursor: null,
      limit: 1000,
      now,
    };
    const first = await repository.page(input);
    expect(first.data).toHaveLength(1000);
    expect(first.meta.total).toBe(1005);
    const second = await repository.page({
      ...input,
      cursor: parseCursor(first.meta.nextCursor ?? undefined),
    });
    expect(second.data).toHaveLength(5);
    expect(second.meta.total).toBe(1005);
    expect(
      new Set([...first.data, ...second.data].map((row) => row.id)).size,
    ).toBe(1005);
  });
});
