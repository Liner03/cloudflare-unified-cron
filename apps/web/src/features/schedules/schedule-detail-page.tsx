import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CirclePause, CirclePlay } from "lucide-react";
import { Link, useParams } from "react-router-dom";
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
import { scheduleDetailSchema, stateMutationSchema } from "@/lib/api-schemas";
import {
  formatScheduleBlockingReasons,
  formatTime,
  shortId,
} from "@/lib/format";

export function ScheduleDetailPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["schedule", id],
    queryFn: ({ signal }) =>
      apiGet(`/api/v1/schedules/${id}`, scheduleDetailSchema, signal),
    enabled: id.length > 0,
  });
  const mutation = useMutation({
    mutationFn: async (operation: "pause" | "resume") => {
      const schedule = query.data?.data;
      if (!schedule) throw new Error("Schedule 尚未加载");
      return apiMutate(
        `/api/v1/schedules/${id}/${operation}`,
        {},
        stateMutationSchema,
        {
          revision: schedule.revision,
        },
      );
    },
    onSuccess: async (_result, operation) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["schedule", id] }),
        queryClient.invalidateQueries({ queryKey: ["schedules"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
      ]);
      toast.success(
        operation === "pause" ? "Schedule 已暂停" : "Schedule 已恢复",
      );
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
        {schedule.isDemo ? (
          <div className="demo-readonly-note">
            <StatusBadge status="local_demo" />
            <span>这条 Schedule 仅用于本地界面演示，操作已禁用。</span>
          </div>
        ) : !schedule.operatorPaused ? (
          <ActionConfirm
            confirmLabel="暂停计划"
            description="管理员覆盖会持续存在，后续 Registration 不能清除；现有 Execution 不会被删除。"
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
            description="只清除管理员覆盖。若 Worker 声明为停用，Schedule 仍不会产生新执行。"
            onConfirm={() => mutation.mutate("resume")}
            title="恢复定时计划？"
            trigger={
              <Button disabled={mutation.isPending} variant="outline">
                <CirclePlay size={15} /> 恢复
              </Button>
            }
          />
        )}
      </div>

      <div className="detail-grid">
        <Card>
          <CardHeader>
            <CardTitle>配置快照</CardTitle>
            <StatusBadge
              status={schedule.effectiveEnabled ? "enabled" : "schedule_paused"}
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
              <dt>Registration key</dt>
              <dd className="mono">{schedule.key}</dd>
              <dt>声明 / 覆盖</dt>
              <dd>
                {schedule.declaredEnabled ? "Worker 启用" : "Worker 停用"} ·{" "}
                {schedule.operatorPaused ? "管理员暂停" : "无管理员覆盖"}
              </dd>
              <dt>有效状态</dt>
              <dd>{formatScheduleBlockingReasons(schedule.blockingReasons)}</dd>
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
                尚无执行记录。等待 Worker 声明的下一次定时发生。
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
