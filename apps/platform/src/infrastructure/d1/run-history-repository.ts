import { z } from "zod";
import { DomainError } from "../../domain/error";
import type { PageCursor } from "./execution-operations-repository";
import {
  historyBoundary,
  readHistoryCursors,
  type PageDirection,
} from "./history-pagination";

export const runRowSchema = z.object({
  id: z.string(),
  schedule_id: z.string(),
  target_id: z.string(),
  source: z.string(),
  mode: z.enum(["rpc", "queue"]),
  status: z.string(),
  delivery_status: z.string().nullable(),
  attempt_count: z.number().nullable(),
  scheduled_for: z.number().nullable(),
  created_at: z.number(),
  started_at: z.number().nullable(),
  finished_at: z.number().nullable(),
  available_at: z.number(),
  reason_code: z.string().nullable(),
  summary: z.string().nullable(),
  schedule_name: z.string().nullable(),
  target_label: z.string().nullable(),
});

export function serializeRun(value: unknown) {
  const row = runRowSchema.parse(value);
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    targetId: row.target_id,
    source: row.source,
    mode: row.mode,
    status: row.status,
    deliveryStatus: row.delivery_status,
    attemptCount: row.attempt_count,
    scheduledFor: iso(row.scheduled_for),
    createdAt: iso(row.created_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    availableAt: iso(row.available_at),
    reasonCode: row.reason_code,
    summary: row.summary,
    scheduleName: row.schedule_name ?? "已清理或未知任务",
    targetLabel: row.target_label ?? row.target_id,
  };
}

export interface RunFilters {
  status: string;
  source: string;
  mode: string;
  targetId: string;
  scheduleId: string;
  from: number | null;
  to: number | null;
}

/** A shared read model; Queue receipts never become mutable RPC Executions. */
export class RunHistoryRepository {
  constructor(private readonly db: D1Database) {}

  async list(
    input: RunFilters & {
      cursor: PageCursor | null;
      limit: number;
      now: number;
      direction?: PageDirection;
    },
  ) {
    const { where, values } = runWhere(input);
    const boundary = historyBoundary(input.cursor, input.direction ?? "next");
    const pageWhere = where + boundary.clause;
    const pageValues = [...values, ...boundary.values];
    const [page, summary] = await this.db.batch([
      this.db
        .prepare(
          `SELECT * FROM run_history WHERE ${pageWhere} ORDER BY created_at ${boundary.order}, id ${boundary.order} LIMIT ?`,
        )
        .bind(...pageValues, input.limit),
      this.db
        .prepare(
          `SELECT status, COUNT(*) count FROM run_history WHERE ${where} GROUP BY status`,
        )
        .bind(...values),
    ]);
    if (!page || !summary)
      throw new DomainError(
        "unavailable",
        "D1_BATCH_INCOMPLETE",
        "运行记录读取不完整",
      );
    const rows = page.results.map(serializeRun);
    if (boundary.reverse) rows.reverse();
    const cursors = await readHistoryCursors(this.db, {
      source: "runs",
      where,
      values,
      rows,
    });
    const counts = summary.results.map((value) =>
      z.object({ status: z.string(), count: z.number() }).parse(value),
    );
    return {
      data: rows,
      summary: counts,
      meta: {
        ...cursors,
        total: counts.reduce((sum, row) => sum + row.count, 0),
        serverTime: new Date(input.now).toISOString(),
      },
    };
  }

  async detail(id: string) {
    const row = await this.db
      .prepare("SELECT * FROM run_history WHERE id=?")
      .bind(id)
      .first();
    if (!row)
      throw new DomainError(
        "not_found",
        "RUN_NOT_FOUND",
        "运行记录不存在或已清理",
      );
    const run = serializeRun(row);
    const delivery =
      run.mode === "queue"
        ? await this.db
            .prepare(
              "SELECT attempts, queued_at, snapshot_json FROM trigger_deliveries WHERE id=?",
            )
            .bind(id)
            .first()
        : null;
    const details =
      delivery === null
        ? null
        : z
            .object({
              attempts: z.number(),
              queued_at: z.number().nullable(),
              snapshot_json: z.string(),
            })
            .parse(delivery);
    return {
      ...run,
      sendAttempts: details?.attempts ?? null,
      queuedAt: iso(details?.queued_at ?? null),
    };
  }
}

export function runWhere(input: RunFilters) {
  const clauses = ["1=1"];
  const values: Array<string | number> = [];
  for (const [column, value] of [
    ["status", input.status],
    ["source", input.source],
    ["mode", input.mode],
    ["target_id", input.targetId],
    ["schedule_id", input.scheduleId],
  ] as const) {
    if (value) {
      clauses.push(`${column}=?`);
      values.push(value);
    }
  }
  if (input.from !== null) {
    clauses.push("created_at>=?");
    values.push(input.from);
  }
  if (input.to !== null) {
    clauses.push("created_at<=?");
    values.push(input.to);
  }
  return { where: clauses.join(" AND "), values };
}

function iso(value: number | null) {
  return value === null ? null : new Date(value).toISOString();
}
