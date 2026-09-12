import { z } from "zod";
import {
  triggerResultSchema,
  type TargetManifest,
  type TriggerMessage,
  type TriggerResult,
  jsonValueSchema,
} from "@unified-cron/contracts";
import { CronCalculator } from "../cron/cron-calculator";
import { sha256Hex } from "../security/crypto";
import { receiptToken } from "../security/receipt-token";
import { DomainError } from "../../domain/error";

const dueSchema = z.object({
  id: z.string(),
  target_id: z.string(),
  revision: z.number(),
  next_run_at: z.number(),
  cron_expression: z.string(),
  timezone: z.string(),
  action: z.string(),
  action_version: z.number(),
  payload_json: z.string(),
  misfire_policy: z.string(),
  misfire_grace_seconds: z.number(),
  idempotent: z.number(),
});
const rowSchema = z.object({
  id: z.string(),
  schedule_id: z.string(),
  target_id: z.string(),
  scheduled_for: z.number(),
  snapshot_json: z.string(),
  status: z.string(),
  attempts: z.number(),
  lease_token: z.string().nullable(),
  receipt_hash: z.string(),
  last_error: z.string().nullable(),
  queued_at: z.number().nullable(),
  result_json: z.string().nullable(),
  created_at: z.number(),
});
export type DeliveryRow = z.infer<typeof rowSchema>;

export class TriggerDeliveryRepository {
  constructor(private readonly db: D1Database) {}

  async summary() {
    const rows = await this.db
      .prepare(
        "SELECT status,COUNT(*) count,MIN(created_at) oldest FROM trigger_deliveries GROUP BY status",
      )
      .all();
    return rows.results.map((value) =>
      z
        .object({ status: z.string(), count: z.number(), oldest: z.number() })
        .parse(value),
    );
  }

  async cleanup(now: number): Promise<void> {
    // Unreported business outcomes remain inspectable for 30 days; unresolved delivery stays retained.
    await this.db
      .prepare(
        `DELETE FROM trigger_deliveries WHERE id IN (SELECT id FROM trigger_deliveries WHERE status IN ('queued','skipped','cancelled') AND updated_at < ? ORDER BY updated_at LIMIT 100)`,
      )
      .bind(now - 30 * 24 * 60 * 60 * 1000)
      .run();
  }

  async materialize(
    targets: readonly TargetManifest[],
    secret: string,
    now: number,
    limit: number,
  ): Promise<number> {
    const ids = targets
      .filter((t) => t.delivery?.mode === "queue")
      .map((t) => t.id);
    if (!ids.length) return 0;
    const result = await this.db
      .prepare(
        `SELECT s.*, a.idempotent FROM schedules s
      JOIN managed_schedule_effective_state v ON v.schedule_id=s.id AND v.effective_enabled=1
      JOIN registered_actions a ON a.target_id=s.target_id AND a.name=s.action AND a.version=s.action_version
      WHERE s.target_id IN (SELECT value FROM json_each(?)) AND s.next_run_at<=?
      ORDER BY s.next_run_at,s.id LIMIT ?`,
      )
      .bind(JSON.stringify(ids), now, limit)
      .all();
    const cron = new CronCalculator();
    const rows = await Promise.all(
      result.results.map(async (value) => {
        const s = dueSchema.parse(value);
        const id = crypto.randomUUID();
        const token = await receiptToken(secret, s.target_id, id);
        const snapshot = {
          action: s.action,
          actionVersion: s.action_version,
          payload: jsonValueSchema.parse(JSON.parse(s.payload_json)),
        };
        return {
          id,
          schedule: s.id,
          target: s.target_id,
          revision: s.revision,
          scheduled: s.next_run_at,
          next: cron.nextAfter(s.cron_expression, s.timezone, now),
          snapshot: JSON.stringify(snapshot),
          hash: await sha256Hex(token),
          skip:
            s.idempotent !== 1 ||
            (s.misfire_policy === "skip" &&
              now - s.next_run_at > s.misfire_grace_seconds * 1000),
        };
      }),
    );
    if (!rows.length) return 0;
    const groups: (typeof rows)[] = [];
    let group: typeof rows = [],
      bytes = 0;
    for (const row of rows) {
      const size = new TextEncoder().encode(JSON.stringify(row)).byteLength;
      if (group.length && bytes + size > 200000) {
        groups.push(group);
        group = [];
        bytes = 0;
      }
      group.push(row);
      bytes += size;
    }
    if (group.length) groups.push(group);
    let total = 0;
    for (const group of groups) {
      const json = JSON.stringify(group);
      const batch = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO trigger_deliveries(id,schedule_id,target_id,scheduled_for,snapshot_json,status,available_at,receipt_hash,last_error,created_at,updated_at)
      SELECT json_extract(j.value,'$.id'),s.id,s.target_id,s.next_run_at,json_extract(j.value,'$.snapshot'),
      CASE WHEN json_extract(j.value,'$.skip') THEN 'skipped' ELSE 'pending' END,?,json_extract(j.value,'$.hash'),
      CASE WHEN json_extract(j.value,'$.skip') THEN 'MISFIRE_OR_UNSAFE_ACTION' ELSE NULL END,?,?
      FROM json_each(?) j JOIN schedules s ON s.id=json_extract(j.value,'$.schedule') AND s.revision=json_extract(j.value,'$.revision') AND s.next_run_at=json_extract(j.value,'$.scheduled')
      JOIN managed_schedule_effective_state v ON v.schedule_id=s.id AND v.effective_enabled=1
      WHERE true ON CONFLICT(schedule_id,scheduled_for) DO NOTHING`,
          )
          .bind(now, now, now, json),
        this.db
          .prepare(
            `UPDATE schedules SET next_run_at=(SELECT json_extract(value,'$.next') FROM json_each(?) WHERE json_extract(value,'$.schedule')=schedules.id), last_materialized_for=next_run_at, updated_at=?
      WHERE EXISTS(SELECT 1 FROM json_each(?) j JOIN trigger_deliveries d ON d.id=json_extract(j.value,'$.id') WHERE schedules.id=d.schedule_id AND schedules.next_run_at=d.scheduled_for AND schedules.revision=json_extract(j.value,'$.revision'))`,
          )
          .bind(json, now, json),
      ]);
      total += batch[0]?.meta.changes ?? 0;
    }
    return total;
  }

  async claim(
    targetId: string,
    now: number,
    limit: number,
  ): Promise<DeliveryRow[]> {
    const lease = crypto.randomUUID();
    const result = await this.db
      .prepare(
        `UPDATE trigger_deliveries SET status='sending',attempts=attempts+1,lease_token=?,lease_expires_at=?,updated_at=?
    WHERE id IN (SELECT d.id FROM trigger_deliveries d JOIN managed_schedule_effective_state v ON v.schedule_id=d.schedule_id AND v.effective_enabled=1
    JOIN registered_actions a ON a.target_id=d.target_id AND a.name=json_extract(d.snapshot_json,'$.action') AND a.version=json_extract(d.snapshot_json,'$.actionVersion') AND a.idempotent=1
    WHERE d.target_id=? AND ((d.status IN ('pending','unknown') AND d.available_at<=?) OR (d.status='sending' AND d.lease_expires_at<=?))
    ORDER BY d.available_at,d.created_at,d.id LIMIT ?) RETURNING *`,
      )
      .bind(lease, now + 90000, now, targetId, now, now, limit)
      .all();
    return result.results.map((value) => rowSchema.parse(value));
  }

  async finish(
    rows: DeliveryRow[],
    now: number,
    accepted: boolean,
  ): Promise<void> {
    if (!rows.length) return;
    await this.db
      .prepare(
        `UPDATE trigger_deliveries SET status=?,queued_at=CASE WHEN ? THEN ? ELSE queued_at END,
      last_error=?,available_at=?,lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE status='sending' AND EXISTS(SELECT 1 FROM json_each(?) j WHERE trigger_deliveries.id=json_extract(j.value,'$.id') AND trigger_deliveries.lease_token=json_extract(j.value,'$.lease_token'))`,
      )
      .bind(
        accepted ? "queued" : "unknown",
        accepted ? 1 : 0,
        now,
        accepted ? null : "DELIVERY_OUTCOME_UNKNOWN",
        now + 60000,
        now,
        JSON.stringify(
          rows.map((r) => ({ id: r.id, lease_token: r.lease_token })),
        ),
      )
      .run();
  }

  async message(
    row: DeliveryRow,
    secret: string,
    instance: string,
  ): Promise<TriggerMessage> {
    const snapshot = z
      .object({
        action: z.string(),
        actionVersion: z.number(),
        payload: jsonValueSchema,
      })
      .parse(JSON.parse(row.snapshot_json));
    const token = await receiptToken(secret, row.target_id, row.id);
    if ((await sha256Hex(token)) !== row.receipt_hash)
      throw new Error("RECEIPT_KEY_CHANGED");
    return {
      protocolVersion: 2,
      deliveryId: row.id,
      scheduleId: row.schedule_id,
      targetId: row.target_id,
      scheduledFor: new Date(row.scheduled_for).toISOString(),
      ...snapshot,
      idempotencyKey: `ucp:v2:${instance}:${row.id}`,
      receiptToken: token,
    };
  }

  async report(id: string, token: string, value: TriggerResult, now: number) {
    const hash = await sha256Hex(token);
    const row = await this.db
      .prepare("SELECT * FROM trigger_deliveries WHERE id=? AND receipt_hash=?")
      .bind(id, hash)
      .first();
    if (!row)
      throw new DomainError(
        "unauthenticated",
        "RECEIPT_TOKEN_INVALID",
        "投递结果凭据无效",
      );
    const parsed = rowSchema.parse(row);
    if (!["sending", "unknown", "queued"].includes(parsed.status))
      throw new DomainError("conflict", "DELIVERY_NOT_SENT", "任务尚未发送");
    const json = JSON.stringify(triggerResultSchema.parse(value));
    const result = await this.db
      .prepare(
        `UPDATE trigger_deliveries SET result_json=?,result_at=?,status='queued',queued_at=COALESCE(queued_at,?),lease_token=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=? WHERE id=? AND receipt_hash=? AND (result_json IS NULL OR result_json=?)`,
      )
      .bind(json, now, now, now, id, hash, json)
      .run();
    if (!result.meta.changes)
      throw new DomainError("conflict", "RECEIPT_CONFLICT", "终态结果已经记录");
    return { id, status: value.status };
  }

  async list(scheduleId: string, limit = 50) {
    const rows = await this.db
      .prepare(
        `SELECT * FROM trigger_deliveries WHERE (?='' OR schedule_id=?) ORDER BY created_at DESC,id DESC LIMIT ?`,
      )
      .bind(scheduleId, scheduleId, limit)
      .all();
    return rows.results.map((value) => {
      const row = rowSchema.parse(value);
      return {
        id: row.id,
        scheduleId: row.schedule_id,
        targetId: row.target_id,
        scheduledFor: new Date(row.scheduled_for).toISOString(),
        status: row.status,
        attempts: row.attempts,
        queuedAt:
          row.queued_at === null ? null : new Date(row.queued_at).toISOString(),
        lastError: row.last_error,
        businessResult:
          row.result_json === null
            ? null
            : triggerResultSchema.parse(JSON.parse(row.result_json)),
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }
}
