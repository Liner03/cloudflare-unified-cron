import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Copy, RefreshCw, RotateCcw } from "lucide-react";
import { useState } from "react";
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
import { Label, Select, Textarea } from "@/components/ui/form-controls";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogActions,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiGet, apiMutate, errorMessage } from "@/lib/api-client";
import {
  executionDetailSchema,
  executionMutationSchema,
  stateMutationSchema,
} from "@/lib/api-schemas";
import { formatDuration, formatTime, shortId } from "@/lib/format";

const activeStatuses = new Set(["pending", "running", "retry_wait"]);

export function ExecutionDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [resolution, setResolution] = useState("confirmed_succeeded");
  const [note, setNote] = useState("");
  const query = useQuery({
    queryKey: ["execution", id],
    queryFn: ({ signal }) =>
      apiGet(`/api/v1/executions/${id}`, executionDetailSchema, signal),
    enabled: id.length > 0,
    refetchInterval: (current) =>
      activeStatuses.has(current.state.data?.data.status ?? "")
        ? 10_000
        : false,
  });
  const mutation = useMutation({
    mutationFn: async (input: {
      operation: "retry" | "rerun" | "cancel" | "resolve";
      body?: unknown;
    }) => {
      const schema =
        input.operation === "retry" || input.operation === "rerun"
          ? executionMutationSchema
          : stateMutationSchema;
      return apiMutate(
        `/api/v1/executions/${id}/${input.operation}`,
        input.body ?? {},
        schema,
      );
    },
    onSuccess: async (result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["execution", id] }),
        queryClient.invalidateQueries({ queryKey: ["executions"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
      ]);
      if (input.operation === "rerun" && "executionId" in result.data) {
        void navigate(`/executions/${String(result.data.executionId)}`);
      }
      toast.success("操作意图已持久化");
    },
    onError: (error) =>
      toast.error("操作未完成", { description: errorMessage(error) }),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const execution = query.data.data;
  const isDemo =
    typeof execution.snapshot.targetManifestRevision === "string" &&
    execution.snapshot.targetManifestRevision.startsWith("local-demo-");

  return (
    <>
      <PageHeader
        action={
          <Button asChild variant="ghost">
            <Link to="/executions">
              <ArrowLeft size={15} /> 返回台账
            </Link>
          </Button>
        }
        description={`${execution.source} · ${execution.targetId} · Schedule revision ${execution.scheduleRevision}`}
        title={`执行 ${shortId(execution.id)}`}
      />
      <div className="mb-5 flex flex-wrap gap-2">
        {isDemo ? (
          <div className="demo-readonly-note">
            <StatusBadge status="local_demo" />
            <span>这条 Execution 仅用于本地界面演示，操作已禁用。</span>
          </div>
        ) : null}
        {!isDemo &&
        (execution.status === "failed" || execution.status === "unknown") &&
        execution.snapshot.targetActionIdempotent ? (
          <ActionConfirm
            confirmLabel="重试本次执行"
            description="Retry 保持相同 Execution 与幂等键，并创建新的 Attempt。原业务可能已经执行；服务端仍会核对次数、时间窗口与执行槽。"
            onConfirm={() =>
              mutation.mutate({
                operation: "retry",
                body: { confirmRisk: true },
              })
            }
            title="确认重试同一执行？"
            trigger={
              <Button disabled={mutation.isPending}>
                <RefreshCw size={15} /> Retry
              </Button>
            }
          />
        ) : null}
        {!isDemo &&
        ["succeeded", "failed", "skipped", "cancelled"].includes(
          execution.status,
        ) ? (
          <ActionConfirm
            confirmLabel="新建一次运行"
            danger
            description="Run again 会创建新的 Execution 与新的幂等键，因此可能再次产生业务副作用。"
            onConfirm={() =>
              mutation.mutate({
                operation: "rerun",
                body: { confirmRisk: true },
              })
            }
            title="确认 Run again？"
            trigger={
              <Button disabled={mutation.isPending} variant="outline">
                <RotateCcw size={15} /> Run again
              </Button>
            }
          />
        ) : null}
        {!isDemo &&
        (execution.status === "pending" ||
          execution.status === "retry_wait") ? (
          <ActionConfirm
            confirmLabel="取消等待"
            danger
            description="只会取消尚未派发的意图，不会撤销已经发生的外部副作用。running 状态不能强杀。"
            onConfirm={() => mutation.mutate({ operation: "cancel" })}
            title="取消这个执行意图？"
            trigger={
              <Button disabled={mutation.isPending} variant="outline">
                <Ban size={15} /> 取消
              </Button>
            }
          />
        ) : null}
        {!isDemo && execution.status === "unknown" ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">人工核实 unknown</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>记录人工核实结果</AlertDialogTitle>
              <AlertDialogDescription>
                Attempt 保持 unknown；仅更新
                Execution，并留下操作者、说明与审计记录。
              </AlertDialogDescription>
              <div className="mt-5 grid gap-4">
                <div className="field">
                  <Label htmlFor="resolution">核实结论</Label>
                  <Select
                    id="resolution"
                    value={resolution}
                    onChange={(event) => setResolution(event.target.value)}
                  >
                    <option value="confirmed_succeeded">确认已完成</option>
                    <option value="confirmed_failed">确认失败</option>
                    <option value="abandon">承认不确定并放弃</option>
                  </Select>
                </div>
                <div className="field">
                  <Label htmlFor="resolution-note">核实说明</Label>
                  <Textarea
                    id="resolution-note"
                    minLength={3}
                    onChange={(event) => setNote(event.target.value)}
                    value={note}
                  />
                </div>
              </div>
              <AlertDialogActions>
                <AlertDialogCancel>返回</AlertDialogCancel>
                <AlertDialogAction
                  disabled={note.trim().length < 3}
                  onClick={() =>
                    mutation.mutate({
                      operation: "resolve",
                      body: { resolution, note, confirmRisk: true },
                    })
                  }
                >
                  保存核实结果
                </AlertDialogAction>
              </AlertDialogActions>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>

      {execution.status === "unknown" ? (
        <div
          className="mb-5 rounded-[14px] border border-[color:var(--unknown)] bg-card p-4 text-sm"
          role="alert"
        >
          <strong className="status-unknown">结果未知：</strong> RPC
          超时、中断或租约过期都不能证明业务未执行。先检查业务系统和关联日志，再选择安全重试或人工核实。
        </div>
      ) : null}
      {(execution.status === "failed" || execution.status === "unknown") &&
      !execution.snapshot.targetActionIdempotent ? (
        <div
          className="mb-5 rounded-[14px] border border-border bg-card p-4 text-sm text-muted-foreground"
          role="note"
        >
          该 Execution 的不可变快照声明为非幂等，不能 Retry
          同一业务意图。请先核实结果；需要再次执行时使用具有新幂等键的 Run
          again。
        </div>
      ) : null}

      <div className="detail-grid">
        <Card>
          <CardHeader>
            <CardTitle>Attempt 时间线</CardTitle>
            <StatusBadge status={execution.status} />
          </CardHeader>
          <CardContent>
            {execution.attempts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                执行意图尚未被 Tick 领取。
              </p>
            ) : (
              <div className="timeline">
                {execution.attempts.map((attempt) => (
                  <article
                    className={`timeline-item status-${attempt.status}`}
                    key={attempt.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <strong>Attempt {attempt.number}</strong>
                      <StatusBadge status={attempt.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {attempt.reason} · {formatTime(attempt.startedAt)} →{" "}
                      {formatTime(attempt.finishedAt)} ·{" "}
                      {formatDuration(attempt.durationMs)}
                    </div>
                    {attempt.error === null ? null : (
                      <pre className="code-block">
                        {JSON.stringify(attempt.error, null, 2)}
                      </pre>
                    )}
                    {attempt.result === null ? null : (
                      <pre className="code-block">
                        {JSON.stringify(attempt.result, null, 2)}
                      </pre>
                    )}
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-5">
          <Card>
            <CardHeader>
              <CardTitle>执行身份</CardTitle>
              <Button
                aria-label="复制执行 ID"
                onClick={() => void navigator.clipboard.writeText(execution.id)}
                size="icon"
                variant="ghost"
              >
                <Copy size={15} />
              </Button>
            </CardHeader>
            <CardContent>
              <dl className="detail-list">
                <dt>Execution</dt>
                <dd className="mono break-all">{execution.id}</dd>
                <dt>Schedule</dt>
                <dd>
                  <Link
                    className="mono hover:underline"
                    to={`/schedules/${execution.scheduleId}`}
                  >
                    {shortId(execution.scheduleId)}
                  </Link>
                </dd>
                <dt>原定时间</dt>
                <dd>{formatTime(execution.scheduledFor)}</dd>
                <dt>最早可领取</dt>
                <dd>{formatTime(execution.availableAt)}</dd>
                <dt>Attempts</dt>
                <dd>
                  {execution.attemptCount} / {execution.attemptLimit}
                </dd>
                <dt>重试期限</dt>
                <dd>{formatTime(execution.retryDeadlineAt)}</dd>
                <dt>Reason</dt>
                <dd className="mono">{execution.reasonCode ?? "—"}</dd>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>不可变配置快照</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="code-block">
                {JSON.stringify(execution.snapshot, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
