import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, CheckCircle2, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { ActionConfirm } from "@/components/shared/action-confirm";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/shared/page-states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiGet, apiMutate, errorMessage } from "@/lib/api-client";
import { stateMutationSchema, targetsSchema } from "@/lib/api-schemas";
import { formatTime } from "@/lib/format";

export function TargetsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["targets"],
    queryFn: ({ signal }) => apiGet("/api/v1/targets", targetsSchema, signal),
  });
  const mutation = useMutation({
    mutationFn: ({
      id,
      operation,
    }: {
      id: string;
      operation: "check" | "enable" | "disable";
    }) =>
      apiMutate(`/api/v1/targets/${id}/${operation}`, {}, stateMutationSchema),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({ queryKey: ["targets"] });
      toast.success(
        input.operation === "check"
          ? "连接检查已记录"
          : "Target 派发状态已更新",
      );
    },
    onError: (error) =>
      toast.error("Target 操作未完成", { description: errorMessage(error) }),
  });

  return (
    <>
      <PageHeader
        description="部署 manifest 只预授权物理 Service Binding；Actions 与计划来自该 Worker 的最新 Registration。"
        title="目标服务"
      />
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError || !query.data ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.data.data.length === 0 ? (
        <EmptyState
          description="先在 targets.manifest.ts 与 Wrangler services 中声明 Target，再执行 manifest 同步。"
          title="尚无部署 Target"
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {query.data.data.map((target) => {
            const enabled = target.state?.enabled === 1;
            const checkStatus = target.state?.last_check_status ?? "neutral";
            return (
              <Card
                className="group overflow-hidden transition-colors duration-700 ease-out hover:bg-muted/35"
                key={target.id}
              >
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-[11px] bg-secondary">
                      <Cable size={18} />
                    </div>
                    <div>
                      <CardTitle>{target.label}</CardTitle>
                      <p className="mono mt-1 text-xs text-muted-foreground">
                        {target.id}
                      </p>
                    </div>
                  </div>
                  <StatusBadge
                    status={
                      target.state === null
                        ? "not_synced"
                        : enabled
                          ? "enabled"
                          : "disabled"
                    }
                  />
                </CardHeader>
                <CardContent>
                  <dl className="detail-list">
                    <dt>Binding</dt>
                    <dd className="mono">{target.binding}</dd>
                    <dt>Service</dt>
                    <dd className="mono">{target.service}</dd>
                    <dt>Entrypoint</dt>
                    <dd className="mono">{target.entrypoint}</dd>
                    <dt>Manifest</dt>
                    <dd className="mono">{target.manifestRevision}</dd>
                    <dt>Registration</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        status={
                          target.registration ? "registered" : "unregistered"
                        }
                      />
                      <span className="mono min-w-0 break-all">
                        {target.registration?.revision ?? "尚未注册"}
                      </span>
                    </dd>
                    <dt>上次检查</dt>
                    <dd>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={checkStatus} />
                        <span className="text-xs text-muted-foreground">
                          {formatTime(target.state?.last_check_at ?? null)}
                        </span>
                      </div>
                    </dd>
                  </dl>
                  <div className="mt-5 border-t border-border pt-4">
                    <h3 className="mb-3 text-sm font-semibold">Actions</h3>
                    <div className="grid gap-2">
                      {target.actions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Worker 尚未发布 Action 声明。
                        </p>
                      ) : (
                        target.actions.map((action) => (
                          <div
                            className="flex items-center justify-between gap-4 rounded-[10px] bg-muted/55 px-3 py-2"
                            key={`${action.name}:${action.version}`}
                          >
                            <div>
                              <code className="mono text-xs font-semibold">
                                {action.name} / v{action.version}
                              </code>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {action.description ?? "无说明"}
                              </p>
                            </div>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {action.idempotent ? "幂等声明" : "非幂等"}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button
                      disabled={mutation.isPending || !target.state}
                      onClick={() =>
                        mutation.mutate({ id: target.id, operation: "check" })
                      }
                      variant="outline"
                    >
                      <CheckCircle2 size={15} /> 检查连接
                    </Button>
                    {enabled ? (
                      <ActionConfirm
                        confirmLabel="禁用新派发"
                        danger
                        description="已有待执行记录会保留；不会强制终止正在运行的 RPC。"
                        onConfirm={() =>
                          mutation.mutate({
                            id: target.id,
                            operation: "disable",
                          })
                        }
                        title="禁用这个 Target？"
                        trigger={
                          <Button disabled={mutation.isPending} variant="ghost">
                            <PowerOff size={15} /> 禁用
                          </Button>
                        }
                      />
                    ) : (
                      <ActionConfirm
                        confirmLabel="启用 Target"
                        description="后续 Tick 可以领取该 Target 的既有 pending 与 retry_wait 记录。"
                        onConfirm={() =>
                          mutation.mutate({
                            id: target.id,
                            operation: "enable",
                          })
                        }
                        title="恢复 Target 派发？"
                        trigger={
                          <Button disabled={mutation.isPending} variant="ghost">
                            <Power size={15} /> 启用
                          </Button>
                        }
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
