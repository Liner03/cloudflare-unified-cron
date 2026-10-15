export const runStatusLabels: Record<string, string> = {
  pending: "等待派发",
  running: "运行中",
  retry_wait: "等待重试",
  succeeded: "成功",
  failed: "失败",
  unknown: "结果未知",
  skipped: "已跳过",
  cancelled: "已取消",
  unreported: "未上报",
};
export const deliveryStatusLabels: Record<string, string> = {
  pending: "等待投递",
  sending: "正在投递",
  queued: "已入队",
  unknown: "投递结果未知",
  skipped: "已跳过",
  cancelled: "已取消",
};
export function runHref(run: { id: string; mode: string }) {
  return run.mode === "queue" ? `/runs/${run.id}` : `/executions/${run.id}`;
}
export function historyQuery(
  params: URLSearchParams,
  kind: "runs" | "deliveries",
) {
  const query = new URLSearchParams();
  for (const key of [
    "status",
    "source",
    "mode",
    "targetId",
    "scheduleId",
    "cursor",
    "direction",
    "result",
    "from",
    "to",
  ]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const window =
    params.get("window") ??
    (params.has("from") || params.has("to") ? "custom" : "24h");
  if (window !== "custom") {
    query.delete("from");
    query.delete("to");
    const days = ({ "24h": 1, "7d": 7, "30d": 30 } as Record<string, number>)[
      window
    ];
    if (days)
      query.set("from", new Date(Date.now() - days * 86400000).toISOString());
  }
  if (kind === "deliveries") {
    query.delete("mode");
    query.delete("source");
  }
  query.set("limit", "50");
  return query;
}
