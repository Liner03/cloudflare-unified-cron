import { z } from "zod";
import type { PageCursor } from "./execution-operations-repository";

export type PageDirection = "next" | "previous";

/** Boundaries come from the current filtered data, independent of browser memory. */
export async function readHistoryCursors(
  db: D1Database,
  input: {
    source: "runs" | "deliveries";
    where: string;
    values: Array<string | number>;
    rows: { id: string; createdAt: string | null }[];
  },
) {
  const first = input.rows[0],
    last = input.rows.at(-1);
  if (!first || !last) return { previousCursor: null, nextCursor: null };
  const source =
    input.source === "runs" ? "run_history" : "trigger_deliveries d";
  const prefix = input.source === "runs" ? "" : "d.";
  const firstTime = Date.parse(first.createdAt ?? ""),
    lastTime = Date.parse(last.createdAt ?? "");
  const row = await db
    .prepare(
      `SELECT
    EXISTS(SELECT 1 FROM ${source} WHERE ${input.where} AND (${prefix}created_at>? OR (${prefix}created_at=? AND ${prefix}id>?))) has_previous,
    EXISTS(SELECT 1 FROM ${source} WHERE ${input.where} AND (${prefix}created_at<? OR (${prefix}created_at=? AND ${prefix}id<?))) has_next`,
    )
    .bind(
      ...input.values,
      firstTime,
      firstTime,
      first.id,
      ...input.values,
      lastTime,
      lastTime,
      last.id,
    )
    .first();
  const result = z
    .object({ has_previous: z.number(), has_next: z.number() })
    .parse(row);
  return {
    previousCursor: result.has_previous
      ? btoa(JSON.stringify([firstTime, first.id]))
      : null,
    nextCursor: result.has_next
      ? btoa(JSON.stringify([lastTime, last.id]))
      : null,
  };
}

export function historyBoundary(
  cursor: PageCursor | null,
  direction: PageDirection,
  prefix = "",
) {
  const reverse = cursor !== null && direction === "previous";
  const comparison = reverse ? ">" : "<";
  return {
    reverse,
    clause:
      cursor === null
        ? ""
        : ` AND (${prefix}created_at ${comparison} ? OR (${prefix}created_at=? AND ${prefix}id ${comparison} ?))`,
    values:
      cursor === null ? [] : [cursor.createdAt, cursor.createdAt, cursor.id],
    order: reverse ? "ASC" : "DESC",
  };
}
