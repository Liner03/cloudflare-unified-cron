import { z } from "zod";
import { ApiError } from "./errors";

export function parseOrThrow<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(422, "VALIDATION_FAILED", "请求字段不合法", {
      field: parsed.error.issues[0]?.path.join(".") ?? "body",
    });
  }
  return parsed.data;
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function parseOptionalTime(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(422, "INVALID_TIME_FILTER", "时间筛选必须是 ISO 8601");
  }
  return parsed;
}

export function createCursor(createdAt: number, id: string): string {
  return btoa(JSON.stringify([createdAt, id]));
}

export function parseCursor(
  value: string | undefined,
): { createdAt: number; id: string } | null {
  if (value === undefined || value === "") return null;
  try {
    const parsed = z
      .tuple([z.number(), z.string().min(1)])
      .parse(JSON.parse(atob(value)));
    return { createdAt: parsed[0], id: parsed[1] };
  } catch {
    throw new ApiError(422, "INVALID_CURSOR", "分页游标无效");
  }
}

export async function requireTargetState(
  db: D1Database,
  targetId: string,
  requireEnabled: boolean,
): Promise<void> {
  const state = await db
    .prepare("SELECT enabled FROM targets WHERE id = ?")
    .bind(targetId)
    .first<{ enabled: number }>();
  if (!state) {
    throw new ApiError(
      422,
      "TARGET_NOT_SYNCED",
      "Target manifest 尚未同步到 D1",
    );
  }
  if (requireEnabled && state.enabled !== 1) {
    throw new ApiError(409, "TARGET_DISABLED", "Target 当前已禁用");
  }
}

export function toIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
