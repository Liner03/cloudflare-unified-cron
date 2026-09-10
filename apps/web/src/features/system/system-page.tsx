import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CirclePause,
  CirclePlay,
  Database,
  Gauge,
  ShieldCheck,
} from "lucide-react";
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
  auditSchema,
  stateMutationSchema,
  systemSchema,
} from "@/lib/api-schemas";
import { formatTime, shortId } from "@/lib/format";

export function SystemPage() {
  const queryClient = useQueryClient();
  const system = useQuery({
    queryKey: ["system"],
    queryFn: ({ signal }) => apiGet("/api/v1/system", systemSchema, signal),
    refetchInterval: 30_000,
  });
  const audit = useQuery({
    queryKey: ["audit"],
    queryFn: ({ signal }) =>
      apiGet("/api/v1/audit-events?limit=20", auditSchema, signal),
  });
  const mutation = useMutation({
    mutationFn: (operation: "pause" | "resume") =>
      apiMutate(`/api/v1/system/${operation}`, {}, stateMutationSchema),
    onSuccess: async (_data, operation) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
        queryClient.invalidateQueries({ queryKey: ["audit"] }),
      ]);
      toast.success(
        operation === "pause" ? "全局新派发已暂停" : "全局派发已恢复",
      );
    },
    onError: (error) =>
      toast.error("系统操作未完成", { description: errorMessage(error) }),
  });

  if (system.isLoading) return <LoadingState />;
  if (system.isError || !system.data)
    return (
      <ErrorState error={system.error} retry={() => void system.refetch()} />
    );
  const state = system.data.data;
  const paused = state.dispatch_paused === 1;
  const stale =
    state.last_successful_tick_at === null ||
    Date.parse(system.data.meta.serverTime) - state.last_successful_tick_at >
      180_000;

  return (
    <>
      <PageHeader
        action={
          paused ? (
            <ActionConfirm
              confirmLabel="恢复派发"
              description="恢复后按每个 Schedule 的 misfire 策略物化到期发生，并在后续 Tick 有界派发。"
              onConfirm={() => mutation.mutate("resume")}
              title="恢复全局派发？"
              trigger={
                <Button disabled={mutation.isPending}>
                  <CirclePlay size={16} /> 恢复派发
                </Button>
              }
            />
          ) : (
            <ActionConfirm
              confirmLabel="紧急暂停"
              danger
              description="停止新物化与派发；读取状态、租约恢复和审计仍继续。"
              onConfirm={() => mutation.mutate("pause")}
              title="暂停全局新派发？"
              trigger={
                <Button disabled={mutation.isPending} variant="danger">
                  <CirclePause size={16} /> 紧急暂停
                </Button>
              }
            />
          )
        }
        description="这里展示本应用实际观察到的心跳与软件预算，不伪装成全账户 Cloudflare 配额。"
        title="系统"
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Tick 心跳</CardTitle>
            <Gauge size={18} />
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap gap-2">
              <StatusBadge status={stale ? "stale" : "healthy"} />
              <StatusBadge
                status={paused ? "dispatch_paused" : "dispatch_active"}
              />
            </div>
            <dl className="detail-list">
              <dt>最近成功</dt>
              <dd>{formatTime(state.last_successful_tick_at)}</dd>
              <dt>最近结果</dt>
              <dd>{state.last_tick_outcome ?? "尚无"}</dd>
              <dt>Tick ID</dt>
              <dd className="mono">
                {state.last_tick_id ? shortId(state.last_tick_id) : "—"}
              </dd>
              <dt>Build</dt>
              <dd className="mono">{state.build_version ?? "—"}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>运行绑定</CardTitle>
            <Database size={18} />
          </CardHeader>
          <CardContent>
            <dl className="detail-list">
              <dt>存储</dt>
              <dd>D1 / DB</dd>
              <dt>派发</dt>
              <dd>Service Binding RPC</dd>
              <dt>原生 Cron</dt>
              <dd className="mono">* * * * *</dd>
              <dt>Protocol</dt>
              <dd>v{state.protocolVersion}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>安全边界</CardTitle>
            <ShieldCheck size={18} />
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-muted-foreground">
              平台使用本地管理员 Session；业务 Worker 使用绑定单一 Target 的
              Registration Token。管理员写操作校验
              Origin，机器注册不共享浏览器权限。
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>软件预算</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-px overflow-hidden rounded-[12px] border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(state.budgets).map(([key, value]) => (
              <div className="bg-card p-4" key={key}>
                <div className="mono text-xs text-muted-foreground">{key}</div>
                <div className="mt-2 text-xl font-semibold tabular">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <section className="ledger-section mt-5">
        <div className="ledger-heading">
          <div>
            <h2 className="text-sm font-semibold">最近审计</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              所有写操作使用可信 actor 与持久化审计
            </p>
          </div>
        </div>
        {audit.isLoading ? (
          <div className="p-5">
            <LoadingState />
          </div>
        ) : audit.isError || !audit.data ? (
          <ErrorState error={audit.error} retry={() => void audit.refetch()} />
        ) : (
          <div className="table-wrap">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>动作</TableHead>
                  <TableHead>对象</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.data.data.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="tabular text-xs">
                      {formatTime(event.createdAt)}
                    </TableCell>
                    <TableCell>{event.actor}</TableCell>
                    <TableCell className="mono text-xs">
                      {event.action}
                    </TableCell>
                    <TableCell className="mono text-xs">
                      {event.entity_type} / {shortId(event.entity_id)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  );
}
