export function normalizeCronDialect(
  expression: string,
  dialect: "unix" | "cloudflare" = "unix",
): string {
  const fields = expression.trim().split(/\s+/);
  if (dialect === "unix") return fields.join(" ");
  if (fields.length !== 5) throw new Error("Cloudflare Cron 需要五个字段");
  const months = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  const weekdays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  fields[3] = (fields[3] ?? "")
    .toUpperCase()
    .replace(/[A-Z]+/g, (name) => String(months.indexOf(name) + 1 || name));
  fields[4] = (fields[4] ?? "")
    .toUpperCase()
    .replace(/[A-Z]+/g, (name) => String(weekdays.indexOf(name) + 1 || name));
  if (fields.some((field) => !/^[0-9*,/-]+$/.test(field)))
    throw new Error("不支持 L/W/#/? 等扩展，请先转换为明确的五字段规则");
  const week = fields[4] ?? "*";
  if (week !== "*") {
    const values = new Set<number>();
    for (const part of week.split(",")) {
      const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
      if (!match) throw new Error("Cloudflare 星期字段无效");
      const base = match[1] ?? "";
      const step = Number(match[2] ?? 1);
      const [a, b] = base === "*" ? [1, 7] : base.split("-").map(Number);
      const start = a ?? NaN,
        end = b ?? (match[2] ? 7 : start);
      if (
        !Number.isInteger(step) ||
        step < 1 ||
        start < 1 ||
        end > 7 ||
        start > end
      )
        throw new Error("Cloudflare 星期数字必须为 1..7，范围不能倒序");
      for (let day = start; day <= end; day += step) values.add(day - 1);
    }
    fields[4] = [...values].sort((a, b) => a - b).join(",");
  }
  if (fields[2] !== "*" && fields[4] !== "*")
    throw new Error("日和星期至少一个字段必须为 *");
  return fields.join(" ");
}
