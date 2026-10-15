import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "@/lib/api-client";
import { runDetailSchema } from "@/lib/api-schemas";
import { displayTimezone, formatTime } from "@/lib/format";
import { deliveryStatusLabels } from "@/lib/runs";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/shared/page-states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";

export function RunDetailPage() {
  const { id = "" } = useParams();
  const query = useQuery({
    queryKey: ["run", id],
    queryFn: ({ signal }) =>
      apiGet(`/api/v1/runs/${encodeURIComponent(id)}`, runDetailSchema, signal),
    refetchInterval: 15000,
  });
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const run = query.data.data;
  return (
    <>
      <PageHeader
        title={run.scheduleName}
        description={`${run.targetLabel} · ${run.mode === "queue" ? "Queue" : "RPC"} · 时间显示 ${displayTimezone}`}
        action={
          <Button asChild variant="outline">
            <Link to="/executions">返回执行记录</Link>
          </Button>
        }
      />
      <section className="run-detail ledger-section">
        <div className="run-detail-head">
          <h2>业务结果</h2>
          <StatusBadge status={run.status} />
        </div>
        {run.summary ? (
          <p className="run-summary">{run.summary}</p>
        ) : (
          <EmptyState
            title={
              run.status === "running" ? "任务正在运行" : "业务结果尚未确认"
            }
            description="投递被接收后，业务结果会在任务完成时记录。"
          />
        )}
        {run.reasonCode && <p className="text-destructive">{run.reasonCode}</p>}
        <dl className="detail-list">
          <dt>任务</dt>
          <dd>
            <Link to={`/schedules/${run.scheduleId}`}>{run.scheduleName}</Link>
          </dd>
          <dt>计划触发</dt>
          <dd>{formatTime(run.scheduledFor)}</dd>
          <dt>创建时间</dt>
          <dd>{formatTime(run.createdAt)}</dd>
          <dt>消息投递</dt>
          <dd>
            {run.deliveryStatus
              ? deliveryStatusLabels[run.deliveryStatus]
              : "直接 RPC"}
            {run.sendAttempts !== null ? ` · ${run.sendAttempts} 次投递` : ""}
          </dd>
          <dt>入队时间</dt>
          <dd>{formatTime(run.queuedAt)}</dd>
          <dt>开始运行</dt>
          <dd>{formatTime(run.startedAt)}</dd>
          <dt>结果记录</dt>
          <dd>{formatTime(run.finishedAt)}</dd>
          <dt>业务尝试</dt>
          <dd>
            {run.attemptCount === null
              ? "历史记录未记录；不参与首次成功率统计"
              : `${run.attemptCount} 次`}
          </dd>
          <dt>运行 ID</dt>
          <dd className="mono break-all">{run.id}</dd>
        </dl>
      </section>
    </>
  );
}
