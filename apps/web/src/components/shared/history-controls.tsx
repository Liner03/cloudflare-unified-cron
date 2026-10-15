import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiGet } from "@/lib/api-client";
import { schedulesSchema, targetsSchema } from "@/lib/api-schemas";
import { deliveryStatusLabels, runStatusLabels } from "@/lib/runs";
import { displayTimezone } from "@/lib/format";
import { Select, Input } from "@/components/ui/form-controls";
import { Button } from "@/components/ui/button";

export function HistoryControls({ kind }: { kind: "runs" | "deliveries" }) {
  const [params, setParams] = useSearchParams();
  const targets = useQuery({
    queryKey: ["targets", "history"],
    queryFn: ({ signal }) => apiGet("/api/v1/targets", targetsSchema, signal),
  });
  const schedules = useQuery({
    queryKey: ["schedules", "history"],
    queryFn: ({ signal }) =>
      apiGet("/api/v1/schedules", schedulesSchema, signal),
  });
  const target = params.get("targetId") ?? "";
  const window =
    params.get("window") ??
    (params.has("from") || params.has("to") ? "custom" : "24h");
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.delete("cursor");
    next.delete("direction");
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "targetId") next.delete("scheduleId");
    if (key === "window") {
      next.delete("from");
      next.delete("to");
    }
    setParams(next, { replace: true });
  }
  return (
    <div className="history-filters">
      <label className="field">
        <span>网站</span>
        <Select
          aria-label="网站筛选"
          value={target}
          onChange={(event) => update("targetId", event.target.value)}
        >
          <option value="">全部网站</option>
          {targets.data?.data.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span>任务</span>
        <Select
          aria-label="任务筛选"
          value={params.get("scheduleId") ?? ""}
          onChange={(event) => update("scheduleId", event.target.value)}
        >
          <option value="">全部任务</option>
          {schedules.data?.data
            .filter((item) => !target || item.targetId === target)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </Select>
      </label>
      <label className="field">
        <span>{kind === "runs" ? "运行状态" : "投递状态"}</span>
        <Select
          aria-label="状态筛选"
          value={params.get("status") ?? ""}
          onChange={(event) => update("status", event.target.value)}
        >
          <option value="">全部状态</option>
          {Object.entries(
            kind === "runs" ? runStatusLabels : deliveryStatusLabels,
          ).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </label>
      {kind === "runs" ? (
        <>
          <label className="field">
            <span>执行方式</span>
            <Select
              aria-label="执行方式筛选"
              value={params.get("mode") ?? ""}
              onChange={(event) => update("mode", event.target.value)}
            >
              <option value="">全部方式</option>
              <option value="queue">Queue</option>
              <option value="rpc">RPC</option>
            </Select>
          </label>
          <label className="field">
            <span>触发来源</span>
            <Select
              aria-label="来源筛选"
              value={params.get("source") ?? ""}
              onChange={(event) => update("source", event.target.value)}
            >
              <option value="">全部来源</option>
              <option value="cron">定时触发</option>
              <option value="manual">手动触发</option>
              <option value="rerun">再次运行</option>
            </Select>
          </label>
        </>
      ) : (
        <label className="field">
          <span>业务结果</span>
          <Select
            aria-label="业务结果筛选"
            value={params.get("result") ?? ""}
            onChange={(event) => update("result", event.target.value)}
          >
            <option value="">全部结果</option>
            <option value="succeeded">成功</option>
            <option value="failed">失败</option>
            <option value="unreported">未上报</option>
          </Select>
        </label>
      )}
      <label className="field">
        <span>时间范围</span>
        <Select
          aria-label="时间范围"
          value={window}
          onChange={(event) => update("window", event.target.value)}
        >
          <option value="24h">最近 24 小时</option>
          <option value="7d">最近 7 天</option>
          <option value="30d">最近 30 天</option>
          <option value="all">全部保留记录</option>
          <option value="custom">自定义时间</option>
        </Select>
      </label>
      {window === "custom" &&
        ["from", "to"].map((key) => (
          <label className="field" key={key}>
            <span>
              {key === "from" ? "开始时间" : "结束时间"} · {displayTimezone}
            </span>
            <Input
              aria-label={key === "from" ? "开始时间" : "结束时间"}
              type="datetime-local"
              value={localInput(params.get(key))}
              onChange={(event) =>
                update(
                  key,
                  event.target.value
                    ? new Date(event.target.value).toISOString()
                    : "",
                )
              }
            />
          </label>
        ))}
      {params.toString() && (
        <Button
          variant="ghost"
          onClick={() => setParams({}, { replace: true })}
        >
          清除筛选
        </Button>
      )}
    </div>
  );
}

export function HistoryPagination({
  nextCursor,
  previousCursor,
  total,
  count,
  busy,
}: {
  nextCursor: string | null;
  previousCursor: string | null;
  total: number;
  count: number;
  busy: boolean;
}) {
  const [params, setParams] = useSearchParams();
  function go(value: string, direction: "next" | "previous") {
    const next = new URLSearchParams(params);
    if (value) next.set("cursor", value);
    else next.delete("cursor");
    if (direction === "previous") next.set("direction", "previous");
    else next.delete("direction");
    setParams(next);
  }
  return (
    <div className="history-pagination">
      <span className="tabular">
        当前 {count} 条 · 共 {total} 条匹配记录
      </span>
      <div>
        <Button
          variant="outline"
          disabled={!previousCursor || busy}
          onClick={() => {
            if (previousCursor) go(previousCursor, "previous");
          }}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          disabled={!nextCursor || busy}
          onClick={() => {
            if (nextCursor) {
              go(nextCursor, "next");
            }
          }}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}

function localInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
