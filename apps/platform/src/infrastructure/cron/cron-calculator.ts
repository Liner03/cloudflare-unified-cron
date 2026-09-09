import { CronExpressionParser } from "cron-parser";

const MAX_EXPRESSION_LENGTH = 128;
const MAX_SEARCH_YEARS = 8;
const ATOM = "(?:\\*|\\d+(?:-\\d+)?)(?:/\\d+)?";
const FIELD = `${ATOM}(?:,${ATOM})*`;
const FIVE_FIELDS = new RegExp(
  `^${FIELD}\\s+${FIELD}\\s+${FIELD}\\s+${FIELD}\\s+${FIELD}$`,
);

export class CronValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CronValidationError";
  }
}

export class CronCalculator {
  nextAfter(expression: string, timezone: string, afterMs: number): number {
    return this.preview(expression, timezone, afterMs, 1)[0] as number;
  }

  preview(
    expression: string,
    timezone: string,
    afterMs: number,
    count: number,
  ): number[] {
    const normalized = validateCronExpression(expression);
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      throw new CronValidationError(
        "INVALID_PREVIEW_COUNT",
        "预览数量必须为 1..10",
      );
    }
    assertTimezone(timezone);
    const endDate = new Date(afterMs);
    endDate.setUTCFullYear(endDate.getUTCFullYear() + MAX_SEARCH_YEARS);
    try {
      const interval = CronExpressionParser.parse(`0 ${normalized}`, {
        currentDate: new Date(afterMs),
        endDate,
        tz: timezone,
        strict: true,
      });
      const result: number[] = [];
      for (let index = 0; index < count; index += 1) {
        const next = interval.next().getTime();
        if (next <= afterMs) {
          throw new CronValidationError(
            "CRON_NOT_STRICTLY_FUTURE",
            "Cron 计算结果不是未来时间",
          );
        }
        result.push(next);
      }
      return result;
    } catch (error) {
      if (error instanceof CronValidationError) throw error;
      throw new CronValidationError(
        "INVALID_CRON",
        error instanceof Error ? error.message : "无法计算 Cron 表达式",
      );
    }
  }
}

export function validateCronExpression(expression: string): string {
  const normalized = expression.trim().replace(/\s+/g, " ");
  if (normalized.length === 0 || normalized.length > MAX_EXPRESSION_LENGTH) {
    throw new CronValidationError(
      "INVALID_CRON_LENGTH",
      "Cron 表达式长度必须为 1..128",
    );
  }
  if (!FIVE_FIELDS.test(normalized)) {
    throw new CronValidationError(
      "UNSUPPORTED_CRON_DIALECT",
      "仅支持 Unix 五字段数字子集（*、列表、范围、步长）",
    );
  }
  const fields = normalized.split(" ");
  const dayOfMonth = fields[2];
  const dayOfWeek = fields[4];
  if (dayOfMonth !== "*" && dayOfWeek !== "*") {
    throw new CronValidationError(
      "AMBIGUOUS_DAY_FIELDS",
      "day-of-month 与 day-of-week 至少一项必须为 *",
    );
  }
  return normalized;
}

function assertTimezone(timezone: string): void {
  if (timezone.length === 0 || timezone.length > 128) {
    throw new CronValidationError("INVALID_TIMEZONE", "时区长度不合法");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(
      new Date(0),
    );
  } catch {
    throw new CronValidationError(
      "INVALID_TIMEZONE",
      "必须使用有效的 IANA 时区",
    );
  }
}
