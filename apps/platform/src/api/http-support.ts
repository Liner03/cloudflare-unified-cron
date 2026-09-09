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

export function parseOptionalTime(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(422, "INVALID_TIME_FILTER", "时间筛选必须是 ISO 8601");
  }
  return parsed;
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
