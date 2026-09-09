import { useQuery } from "@tanstack/react-query";
import { Filter, History } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form-controls";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/shared/page-states";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiGet } from "@/lib/api-client";
import { executionsSchema } from "@/lib/api-schemas";
import { formatTime, shortId } from "@/lib/format";

const statuses = [
  "",
  "pending",
  "running",
  "retry_wait",
  "succeeded",
  "failed",
  "unknown",
  "skipped",
  "cancelled",
];

export function ExecutionsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const source = params.get("source") ?? "";
  const cursor = params.get("cursor") ?? "";
  const query = useQuery({
    queryKey: ["executions", status, source, cursor],
    queryFn: ({ signal }) =>
      apiGet(
        `/api/v1/executions?status=${encodeURIComponent(status)}&source=${encodeURIComponent(source)}&cursor=${encodeURIComponent(cursor)}`,
        executionsSchema,
        signal,
      ),
    refetchInterval: 30_000,
  });

  return (
    <>
      <PageHeader
        description="Execution 保存稳定业务身份，Attempt 记录每次具体调用。时间范围、状态和来源筛选均由 API 执行。"
        title="执行记录"
      />
      <div className="toolbar">
        <label className="field">
          <span className="sr-only">状态筛选</span>
          <Select
            value={status}
            onChange={(event) => update("status", event.target.value)}
          >
            {statuses.map((value) => (
              <option key={value || "all"} value={value}>
                {value || "全部状态"}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="sr-only">来源筛选</span>
          <Select
            value={source}
            onChange={(event) => update("source", event.target.value)}
          >
            <option value="">全部来源</option>
            <option value="cron">cron</option>
            <option value="manual">manual</option>
            <option value="rerun">rerun</option>
          </Select>
        </label>
        {status || source ? (
          <Button
            onClick={() => setParams({}, { replace: true })}
            variant="ghost"
          >
            <Filter size={15} /> 清除筛选
          </Button>
        ) : null}
      </div>

      <section className="ledger-section">
        {query.isLoading ? (
          <div className="p-5">
            <LoadingState />
          </div>
        ) : query.isError || !query.data ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.data.data.length === 0 ? (
          <EmptyState
            description="调整筛选，或先创建一个计划并提交运行意图。"
            title="没有匹配的执行记录"
          />
        ) : (
          <div className="table-wrap">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>创建时间</TableHead>
                  <TableHead>执行 / Schedule</TableHead>
                  <TableHead>目标</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((execution) => (
                  <TableRow key={execution.id}>
                    <TableCell className="tabular text-xs text-muted-foreground">
                      {formatTime(execution.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Link
                        className="mono text-xs font-semibold hover:underline"
                        to={`/executions/${execution.id}`}
                      >
                        {shortId(execution.id)}
                      </Link>
                      <div className="mt-1 max-w-52 truncate text-xs text-muted-foreground">
                        {execution.scheduleName ?? execution.scheduleId}
                      </div>
                    </TableCell>
                    <TableCell className="mono text-xs">
                      {execution.targetId}
                    </TableCell>
                    <TableCell>{execution.source}</TableCell>
                    <TableCell className="tabular">
                      {execution.attemptCount}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={execution.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
      {query.data?.meta.nextCursor ? (
        <div className="mt-4 flex justify-end">
          <Button
            onClick={() => update("cursor", query.data.meta.nextCursor ?? "")}
            variant="outline"
          >
            <History size={15} /> 下一页
          </Button>
        </div>
      ) : null}
    </>
  );

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "cursor") next.delete("cursor");
    setParams(next, { replace: true });
  }
}
