import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Globe2,
  Power,
  PowerOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
import { apiGet, apiMutate, errorMessage } from "@/lib/api-client";
import {
  schedulesSchema,
  stateMutationSchema,
  targetsSchema,
} from "@/lib/api-schemas";
import { formatScheduleBlockingReasons, formatTime } from "@/lib/format";

const TARGET_EXPANSION_KEY = "unified-cron:targets:site-expansion";

export function TargetsPage() {
  const queryClient = useQueryClient();
  const [siteExpansion, setSiteExpansion] =
    useState<Record<string, boolean>>(readTargetExpansion);
  const targets = useQuery({
    queryKey: ["targets"],
    queryFn: ({ signal }) => apiGet("/api/v1/targets", targetsSchema, signal),
  });
  const schedules = useQuery({
    queryKey: ["schedules", "site-directory"],
    queryFn: ({ signal }) =>
      apiGet("/api/v1/schedules", schedulesSchema, signal),
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["targets"] }),
        queryClient.invalidateQueries({ queryKey: ["schedules"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
      ]);
      toast.success(
        input.operation === "check"
          ? "网站 Worker 连接检查已记录"
          : "网站 Worker 派发状态已更新",
      );
    },
    onError: (error) =>
      toast.error("网站操作未完成", { description: errorMessage(error) }),
  });

  const loading = targets.isLoading || schedules.isLoading;
  const error = targets.error ?? schedules.error;
  useEffect(() => {
    try {
      window.localStorage.setItem(
        TARGET_EXPANSION_KEY,
        JSON.stringify(siteExpansion),
      );
    } catch {
      // The directory remains usable when browser storage is unavailable.
    }
  }, [siteExpansion]);

  return (
    <>
      <PageHeader
        description="每个网站由一个 Cloudflare Worker 承载；在这里查看它声明的自动任务、运行状态和连接证据。"
        title="网站"
      />
      {loading ? (
        <LoadingState label="正在读取网站 Worker" />
      ) : error || !targets.data || !schedules.data ? (
        <ErrorState
          error={error}
          retry={() => {
            void targets.refetch();
            void schedules.refetch();
          }}
        />
      ) : targets.data.data.length === 0 ? (
        <EmptyState
          description="先在部署 manifest 与 Wrangler Service Binding 中声明网站 Worker，再进行网站接入。"
          title="尚无网站 Worker"
        />
      ) : (
        <div className="site-directory">
          {targets.data.data.map((target, index) => {
            const enabled = target.state?.enabled === 1;
            const websiteSchedules = schedules.data.data.filter(
              (schedule) => schedule.targetId === target.id,
            );
            const active = websiteSchedules.filter(
              (schedule) => schedule.effectiveEnabled,
            ).length;
            const abnormal = websiteSchedules.filter((schedule) =>
              ["failed", "unknown", "retry_wait"].includes(
                schedule.lastExecution?.status ?? "",
              ),
            ).length;
            const expanded =
              siteExpansion[target.id] ??
              (targets.data.data.length === 1 || index === 0);
            const contentId = `target-site-${target.id.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
            return (
              <article
                className="site-panel"
                data-expanded={expanded}
                key={target.id}
              >
                <header className="site-panel-head">
                  <button
                    aria-controls={contentId}
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "收起" : "展开"} ${target.label} 网站详情`}
                    className="site-panel-toggle"
                    onClick={() =>
                      setSiteExpansion((current) => ({
                        ...current,
                        [target.id]: !expanded,
                      }))
                    }
                    type="button"
                  >
                    <div className="site-identity">
                      <span
                        aria-hidden="true"
                        className="site-identity-mark"
                        data-tone={
                          !enabled
                            ? "muted"
                            : abnormal > 0
                              ? "attention"
                              : "healthy"
                        }
                      >
                        <Globe2 size={18} />
                      </span>
                      <div>
                        <h2>{target.label}</h2>
                        <p className="mono">{target.id}</p>
                      </div>
                    </div>
                    <div className="site-panel-facts">
                      <div>
                        <span>自动任务</span>
                        <strong className="tabular">
                          {active}/{websiteSchedules.length} 运行中
                        </strong>
                      </div>
                      <div>
                        <span>当前版本</span>
                        <strong className="mono">
                          {target.registration?.revision ?? "等待注册"}
                        </strong>
                      </div>
                      <div>
                        <span>最近检查</span>
                        <strong>
                          {formatTime(target.state?.last_check_at ?? null)}
                        </strong>
                      </div>
                    </div>
                    <div className="site-panel-status">
                      <StatusBadge
                        status={
                          target.isDemo
                            ? "local_demo"
                            : target.state === null
                              ? "not_synced"
                              : enabled
                                ? abnormal > 0
                                  ? "attention"
                                  : "enabled"
                                : "disabled"
                        }
                      />
                    </div>
                    <ChevronDown
                      aria-hidden="true"
                      className="site-panel-chevron"
                      size={17}
                    />
                  </button>
                </header>

                <div
                  className="site-panel-body"
                  hidden={!expanded}
                  id={contentId}
                >
                  <div className="site-cron-tree">
                    <div className="site-cron-tree-head">
                      <h3>网站自动任务</h3>
                      <Link
                        to={`/schedules?target=${encodeURIComponent(target.id)}`}
                      >
                        查看全部 <ArrowRight aria-hidden="true" size={14} />
                      </Link>
                    </div>
                    {websiteSchedules.length === 0 ? (
                      <p className="site-cron-empty">
                        该网站尚未通过 Registration 声明 Cron。
                      </p>
                    ) : (
                      websiteSchedules.slice(0, 6).map((schedule) => (
                        <Link
                          className="site-cron-row"
                          key={schedule.id}
                          to={`/schedules/${schedule.id}`}
                        >
                          <span aria-hidden="true" className="site-cron-node" />
                          <span>
                            <strong>{schedule.name}</strong>
                            <small className="mono">
                              {schedule.cronExpression} · {schedule.timezone}
                            </small>
                          </span>
                          <span className="site-cron-state">
                            {schedule.effectiveEnabled
                              ? "当前可派发"
                              : formatScheduleBlockingReasons(
                                  schedule.blockingReasons,
                                )}
                          </span>
                          <span className="tabular">
                            下次 {formatTime(schedule.nextRunAt)}
                          </span>
                          <ArrowRight aria-hidden="true" size={14} />
                        </Link>
                      ))
                    )}
                  </div>

                  <aside
                    className="site-evidence"
                    aria-label="网站 Worker 技术证据"
                  >
                    <dl>
                      <dt>Registration</dt>
                      <dd>
                        <StatusBadge
                          status={
                            target.registration ? "registered" : "unregistered"
                          }
                        />
                      </dd>
                      <dt>连接检查</dt>
                      <dd>
                        <StatusBadge
                          status={target.state?.last_check_status ?? "neutral"}
                        />
                      </dd>
                      <dt>Service Binding</dt>
                      <dd className="mono">
                        {target.binding} → {target.service}#{target.entrypoint}
                      </dd>
                      <dt>Actions</dt>
                      <dd className="tabular">
                        {target.actions.length} 项能力
                      </dd>
                    </dl>
                    <div className="site-actions">
                      {target.isDemo ? (
                        <p className="site-demo-note">
                          本地只读演示，不会调用实际 Worker。
                        </p>
                      ) : (
                        <Button
                          disabled={mutation.isPending || !target.state}
                          onClick={() =>
                            mutation.mutate({
                              id: target.id,
                              operation: "check",
                            })
                          }
                          size="sm"
                          variant="outline"
                        >
                          <CheckCircle2 size={14} /> 检查连接
                        </Button>
                      )}
                      {!target.isDemo && enabled ? (
                        <ActionConfirm
                          confirmLabel="停用网站派发"
                          danger
                          description="保留既有执行记录，不会强制终止正在运行的 RPC。"
                          onConfirm={() =>
                            mutation.mutate({
                              id: target.id,
                              operation: "disable",
                            })
                          }
                          title="停用这个网站 Worker？"
                          trigger={
                            <Button
                              disabled={mutation.isPending}
                              size="sm"
                              variant="ghost"
                            >
                              <PowerOff size={14} /> 停用
                            </Button>
                          }
                        />
                      ) : !target.isDemo ? (
                        <ActionConfirm
                          confirmLabel="恢复网站派发"
                          description="后续 Tick 可以重新领取该网站的待执行任务。"
                          onConfirm={() =>
                            mutation.mutate({
                              id: target.id,
                              operation: "enable",
                            })
                          }
                          title="恢复这个网站 Worker？"
                          trigger={
                            <Button
                              disabled={mutation.isPending}
                              size="sm"
                              variant="ghost"
                            >
                              <Power size={14} /> 恢复
                            </Button>
                          }
                        />
                      ) : null}
                    </div>
                  </aside>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function readTargetExpansion(): Record<string, boolean> {
  try {
    const stored = window.localStorage.getItem(TARGET_EXPANSION_KEY);
    if (stored === null) return {};
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    );
  } catch {
    return {};
  }
}
