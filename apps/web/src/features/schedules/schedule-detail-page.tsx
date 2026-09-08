import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  CirclePause,
  CirclePlay,
  Pencil,
  Play,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ActionConfirm } from "@/components/shared/action-confirm";
import {
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/shared/page-states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiGet, apiMutate, errorMessage } from "@/lib/api-client";
import {
  executionMutationSchema,
  scheduleDetailSchema,
  stateMutationSchema,
} from "@/lib/api-schemas";
import { formatTime, shortId } from "@/lib/format";

export function ScheduleDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["schedule", id],
    queryFn: ({ signal }) =>
      apiGet(`/api/v1/schedules/${id}`, scheduleDetailSchema, signal),
    enabled: id.length > 0,
  });
  const mutation = useMutation({
    mutationFn: async (operation: "run" | "pause" | "resume" | "archive") => {
      const schedule = query.data?.data;
      if (!schedule) throw new Error("Schedule 尚未加载");
      if (operation === "run") {
        return apiMutate(
          `/api/v1/schedules/${id}/run`,
          {},
          executionMutationSchema,
        );
      }
      return apiMutate(
        `/api/v1/schedules/${id}/${operation}`,
        {},
        stateMutationSchema,
        {
          revision: schedule.revision,
        },
      );
    },
    onSuccess: async (result, operation) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["schedule", id] }),
        queryClient.invalidateQueries({ queryKey: ["schedules"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
      ]);
      if (operation === "archive") {
        toast.success("Schedule 已归档");
        void navigate("/schedules");
      } else if (operation === "run" && "executionId" in result.data) {
        toast.success("执行意图已保存");
        void navigate(`/executions/${String(result.data.executionId)}`);
      } else {
        toast.success(
          operation === "pause" ? "Schedule 已暂停" : "Schedule 已恢复",
        );
      }
    },
    onError: (error) =>
      toast.error("操作未完成", { description: errorMessage(error) }),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const schedule = query.data.data;

  return (
    <>
      <PageHeader
        action={
          <Button asChild variant="ghost">
            <Link to="/schedules">
              <ArrowLeft size={15} /> 返回列表
            </Link>
          </Button>
        }
        description={`${schedule.targetId} / ${schedule.action} · revision ${schedule.revision}`}
        title={schedule.name}
      />
      <div className="mb-5 flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link to={`/schedules/${schedule.id}/edit`}>
            <Pencil size={15} /> 编辑
          </Link>
        </Button>
        <ActionConfirm
          confirmLabel="立即安排"
          description="这会创建新的 Execution 和新的幂等键。HTTP 请求只保存意图，业务 RPC 将由后续可用 Tick 领取。"
          onConfirm={() => mutation.mutate("run")}
          title="安排一次新的人工运行？"
          trigger={
            <Button disabled={mutation.isPending}>
              <Play size={15} /> 立即安排
            </Button>
          }
        />
        {schedule.enabled ? (
          <ActionConfirm
            confirmLabel="暂停计划"
            description="暂停只停止新的 cron Execution；现有 pending、retry_wait、running 或 unknown 不会被删除。"
            onConfirm={() => mutation.mutate("pause")}
            title="暂停新的定时发生？"
            trigger={
              <Button disabled={mutation.isPending} variant="outline">
                <CirclePause size={15} /> 暂停
              </Button>
            }
          />
        ) : (
          <ActionConfirm
            confirmLabel="恢复计划"
            description="恢复时会从当前时间重新计算 next_run_at，默认不追补暂停期间的发生。"
            onConfirm={() => mutation.mutate("resume")}
            title="恢复定时计划？"
            trigger={
              <Button disabled={mutation.isPending} variant="outline">
                <CirclePlay size={15} /> 恢复
              </Button>
            }
          />
        )}
        <ActionConfirm
          confirmLabel="归档"
          danger
          description="归档是软删除；存在 active 或 unknown Execution 时服务端会拒绝。历史记录继续保留。"
          onConfirm={() => mutation.mutate("archive")}
          title="归档这个 Schedule？"
          trigger={
            <Button disabled={mutation.isPending} variant="ghost">
              <Archive size={15} /> 归档
            </Button>
          }
        />
      </div>

      <div className="detail-grid">
        <Card>
          <CardHeader>
            <CardTitle>配置快照</CardTitle>
            <StatusBadge
              status={schedule.enabled ? "enabled" : "schedule_paused"}
            />
          </CardHeader>
          <CardContent>
            <dl className="detail-list">
              <dt>下一次</dt>
              <dd className="tabular">{formatTime(schedule.nextRunAt)}</dd>
              <dt>Cron</dt>
              <dd className="mono">{schedule.cronExpression}</dd>
              <dt>Timezone</dt>
              <dd className="mono">{schedule.timezone}</dd>
              <dt>Target / Action</dt>
              <dd className="mono">
                {schedule.targetId} / {schedule.action} / v
                {schedule.actionVersion}
              </dd>
              <dt>Retry</dt>
              <dd>
                共 {schedule.retryPolicy.maxAttempts} 次 · delay [
                {schedule.retryPolicy.delaysSeconds.join(", ") || "无"}] 秒
              </dd>
              <dt>Unknown retry</dt>
              <dd>
                {schedule.retryPolicy.retryOnUnknown
                  ? "允许（仍需幂等）"
                  : "关闭"}
              </dd>
              <dt>Deadline</dt>
              <dd className="tabular">{schedule.timeoutMs} ms</dd>
              <dt>Misfire</dt>
              <dd>
                {schedule.misfirePolicy} · 宽限 {schedule.misfireGraceSeconds}{" "}
                秒
              </dd>
              <dt>更新</dt>
              <dd>{formatTime(schedule.updatedAt)}</dd>
            </dl>
            <h3 className="mb-2 mt-6 text-sm font-semibold">Payload</h3>
            <pre className="code-block">
              {JSON.stringify(schedule.payload, null, 2)}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>最近执行</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {schedule.recentExecutions.length === 0 ? (
              <div className="p-5 text-sm text-muted-foreground">
                尚无执行记录。可先进行一次受控的立即安排。
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>执行</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedule.recentExecutions.map((execution) => (
                    <TableRow key={execution.id}>
                      <TableCell>
                        <Link
                          className="mono text-xs font-semibold hover:underline"
                          to={`/executions/${execution.id}`}
                        >
                          {shortId(execution.id)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={execution.status} />
                      </TableCell>
                      <TableCell className="tabular text-xs text-muted-foreground">
                        {formatTime(execution.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
