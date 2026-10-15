const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function formatTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

export function formatDuration(value: number | null): string {
  if (value === null) return "—";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

export function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export const displayTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function formatCron(expression: string, timezone: string) {
  const [minute, hour, day, month, weekday] = expression.trim().split(/\s+/);
  let text = expression;
  if (day === "*" && month === "*" && weekday === "*") {
    if (minute === "*" && hour === "*") text = "每分钟";
    else if (minute?.startsWith("*/") && hour === "*")
      text = `每 ${minute.slice(2)} 分钟`;
    else if (/^\d+$/.test(minute ?? "") && /^\d+$/.test(hour ?? ""))
      text = `每天 ${hour?.padStart(2, "0")}:${minute?.padStart(2, "0")}`;
    else if (/^\d+$/.test(minute ?? "") && hour?.startsWith("*/"))
      text = `每 ${hour.slice(2)} 小时，第 ${minute} 分`;
  }
  return `${text} · ${timezone}`;
}

const scheduleBlockingLabels = {
  declared_disabled: "Worker 声明停用",
  operator_paused: "管理员暂停",
  invalid_configuration: "配置无效，系统已停用",
  target_disabled: "Target 已停用",
  dispatch_paused: "全局派发暂停",
} as const;

export function formatScheduleBlockingReasons(
  reasons: Array<keyof typeof scheduleBlockingLabels>,
): string {
  return reasons.length === 0
    ? "当前可派发"
    : reasons.map((reason) => scheduleBlockingLabels[reason]).join(" · ");
}
