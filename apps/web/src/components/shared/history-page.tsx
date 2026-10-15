import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiGet } from "@/lib/api-client";
import {
  deliveriesSchema,
  runsSchema,
  type RunSummary,
} from "@/lib/api-schemas";
import { displayTimezone, formatTime } from "@/lib/format";
import { deliveryStatusLabels, historyQuery, runHref } from "@/lib/runs";
import { HistoryControls, HistoryPagination } from "./history-controls";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "./page-states";
import { StatusBadge } from "./status-badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

interface HistoryResult {
  data: (RunSummary & { sendAttempts: number | null })[];
  summary: { status: string; count: number }[];
  meta: {
    total: number;
    nextCursor: string | null;
    previousCursor: string | null;
    serverTime: string;
  };
}

export function HistoryPage({ kind }: { kind: "runs" | "deliveries" }) {
  const [params] = useSearchParams();
  const query = useQuery({
    queryKey: [kind, params.toString()],
    refetchInterval: 30000,
    queryFn: async ({ signal }): Promise<HistoryResult> => {
      const search = historyQuery(params, kind);
      if (kind === "runs") {
        const response = await apiGet(
          `/api/v1/runs?${search.toString()}`,
          runsSchema,
          signal,
        );
        return {
          ...response,
          data: response.data.map((row) => ({ ...row, sendAttempts: null })),
        };
      }
      const response = await apiGet(
        `/api/v1/deliveries?${search.toString()}`,
        deliveriesSchema,
        signal,
      );
      return {
        summary: response.outcomes,
        meta: response.meta,
        data: response.data.map((row) => ({
          id: row.id,
          scheduleId: row.scheduleId,
          targetId: row.targetId,
          targetLabel: row.targetLabel,
          scheduleName: row.scheduleName,
          mode: "queue",
          source: "cron",
          status:
            row.businessResult?.status ??
            (row.consumerError
              ? "retry_wait"
              : row.startedAt
                ? "running"
                : "unreported"),
          deliveryStatus: row.status,
          attemptCount: row.businessAttempts,
          sendAttempts: row.attempts,
          summary: row.businessResult?.summary ?? null,
          reasonCode: row.consumerError ?? row.lastError,
          scheduledFor: row.scheduledFor,
          createdAt: row.createdAt,
          startedAt: row.startedAt,
          finishedAt: row.finishedAt,
        })),
      };
    },
  });
  return (
    <>
      <PageHeader
        title={kind === "runs" ? "执行记录" : "触发记录"}
        description={
          kind === "runs"
            ? "查看所有任务的运行结果，按网站、任务和时间调查异常。"
            : "查看消息投递与业务结果；暂停平台只停止后续投递。"
        }
      />
      <HistoryControls kind={kind} />
      <p className="history-context">
        时间显示：{displayTimezone}。
        {kind === "deliveries"
          ? "已入队表示消息已被接收，业务结果单独记录。"
          : "覆盖 Queue 与 RPC；未上报表示业务结果尚未确认。"}
      </p>
      {query.data && (
        <div className="history-summary" aria-label="当前筛选汇总">
          {query.data.summary.map((row) => (
            <span key={row.status}>
              <StatusBadge status={row.status} />
              <strong className="tabular">{row.count}</strong>
            </span>
          ))}
        </div>
      )}
      <section className="ledger-section">
        {query.isLoading ? (
          <div className="p-5">
            <LoadingState />
          </div>
        ) : query.isError || !query.data ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.data.data.length === 0 ? (
          <EmptyState
            title="没有匹配的运行记录"
            description="可扩大时间范围、清除筛选，或查看其他网站和任务。"
          />
        ) : (
          <div className="table-wrap">
            <Table className="history-table">
              <TableHeader>
                <TableRow>
                  <TableHead>网站 / 任务</TableHead>
                  <TableHead>计划时间</TableHead>
                  {kind === "deliveries" ? (
                    <TableHead>消息投递</TableHead>
                  ) : (
                    <TableHead>方式 / 来源</TableHead>
                  )}
                  <TableHead>业务结果</TableHead>
                  <TableHead>业务尝试</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((row) => (
                  <TableRow key={`${row.mode}:${row.id}`}>
                    <TableCell>
                      <Link className="history-task-link" to={runHref(row)}>
                        {row.scheduleName}
                      </Link>
                      <div className="history-secondary">
                        {row.targetLabel} ·{" "}
                        <Link to={`/schedules/${row.scheduleId}`}>
                          任务详情
                        </Link>
                      </div>
                    </TableCell>
                    <TableCell className="tabular">
                      {formatTime(row.scheduledFor ?? row.createdAt)}
                    </TableCell>
                    <TableCell>
                      {kind === "deliveries" ? (
                        <>
                          <StatusBadge
                            status={row.deliveryStatus ?? "pending"}
                          />
                          <div className="history-secondary">
                            投递 {row.sendAttempts} 次
                          </div>
                        </>
                      ) : (
                        <>
                          {row.mode === "queue" ? "Queue" : "RPC"}
                          <div className="history-secondary">
                            {{
                              cron: "定时触发",
                              manual: "手动触发",
                              rerun: "再次运行",
                            }[row.source] ?? row.source}
                          </div>
                        </>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                      {row.summary && (
                        <div className="history-result" title={row.summary}>
                          {row.summary}
                        </div>
                      )}
                      {row.reasonCode && (
                        <div className="history-result text-destructive">
                          {row.reasonCode}
                        </div>
                      )}
                      {kind === "runs" && row.deliveryStatus && (
                        <div className="history-secondary">
                          投递：
                          {deliveryStatusLabels[row.deliveryStatus] ??
                            row.deliveryStatus}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="tabular">
                      {row.attemptCount === null ? (
                        <span
                          className="history-secondary"
                          title="历史记录未记录业务尝试次数，不参与首次成功率统计"
                        >
                          未记录
                        </span>
                      ) : (
                        `${row.attemptCount} 次`
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
      {query.data && (
        <HistoryPagination
          nextCursor={query.data.meta.nextCursor}
          previousCursor={query.data.meta.previousCursor}
          total={query.data.meta.total}
          count={query.data.data.length}
          busy={query.isFetching}
        />
      )}
    </>
  );
}
