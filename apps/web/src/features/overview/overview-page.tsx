import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  PauseCircle,
  RadioTower,
  RefreshCw,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ErrorState, LoadingState } from "@/components/shared/page-states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api-client";
import {
  executionsSchema,
  overviewSchema,
  schedulesSchema,
  targetsSchema,
  type ExecutionSummary,
  type ScheduleSummary,
  type Target,
} from "@/lib/api-schemas";
import { formatTime } from "@/lib/format";

const DAY_MS = 24 * 60 * 60 * 1000;
const ATTENTION_STATUSES = new Set(["failed", "unknown", "retry_wait"]);

interface WebsiteGroup {
  target: Target;
  schedules: ScheduleSummary[];
}

export function OverviewPage() {
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: ({ signal }) => apiGet("/api/v1/overview", overviewSchema, signal),
    refetchInterval: 30_000,
  });
  const schedules = useQuery({
    queryKey: ["schedules", "overview"],
    queryFn: ({ signal }) =>
      apiGet("/api/v1/schedules", schedulesSchema, signal),
    refetchInterval: 30_000,
  });
  const targets = useQuery({
    queryKey: ["targets", "overview"],
    queryFn: ({ signal }) => apiGet("/api/v1/targets", targetsSchema, signal),
    refetchInterval: 30_000,
  });
  const executions = useQuery({
    queryKey: ["executions", "overview", "24h"],
    queryFn: ({ signal }) => {
      const from = new Date(Date.now() - DAY_MS).toISOString();
      return apiGet(
        `/api/v1/executions?from=${encodeURIComponent(from)}&limit=50`,
        executionsSchema,
        signal,
      );
    },
    refetchInterval: 30_000,
  });

  const queries = [overview, schedules, targets, executions] as const;
  if (queries.some((query) => query.isLoading)) {
    return <LoadingState label="正在汇总网站运行信号" />;
  }
  const failedQuery = queries.find((query) => query.isError);
  if (
    failedQuery?.isError ||
    !overview.data ||
    !schedules.data ||
    !targets.data ||
    !executions.data
  ) {
    return (
      <ErrorState
        error={failedQuery?.error}
        retry={() => void Promise.all(queries.map((query) => query.refetch()))}
      />
    );
  }

  const { data, meta } = overview.data;
  const now = Date.parse(meta.serverTime);
  const executionRows = executions.data.data;
  const attentionExecutions = executionRows.filter((execution) =>
    ATTENTION_STATUSES.has(execution.status),
  );
  const websiteGroups = groupWebsites(
    targets.data.data,
    schedules.data.data,
    attentionExecutions,
  );
  const lastSuccessfulTick = data.system?.last_successful_tick_at ?? null;
  const heartbeatStale =
    data.system !== null &&
    (lastSuccessfulTick === null || now - lastSuccessfulTick > 3 * 60 * 1000);
  const dispatchPaused = data.system?.dispatch_paused === 1;
  const platformNeedsAttention = data.system === null || heartbeatStale;
  const heartbeatStatus =
    data.system === null
      ? "heartbeat_unavailable"
      : heartbeatStale
        ? "stale"
        : "healthy";
  const dispatchStatus =
    data.system === null
      ? "dispatch_unavailable"
      : dispatchPaused
        ? "dispatch_paused"
        : "dispatch_active";
  const attentionCount =
    attentionExecutions.length + (platformNeedsAttention ? 1 : 0);
  const verdict = businessVerdict({
    websites: websiteGroups.length,
    schedules: schedules.data.data.length,
    attentionCount,
    dispatchPaused,
  });

  return (
    <div className="operator-overview">
      <header className="overview-command">
        <div>
          <h1>业务总览</h1>
          <p className="overview-verdict" data-tone={verdict.tone}>
            <span aria-hidden="true" className="overview-verdict-dot" />
            {verdict.label}
          </p>
        </div>
        <div className="overview-command-meta">
          <span>
            {websiteGroups.length} 个网站 · {schedules.data.data.length}{" "}
            个自动任务
          </span>
          <span className="tabular">更新于 {formatTime(meta.serverTime)}</span>
          <Button
            aria-label="刷新业务总览"
            disabled={queries.some((query) => query.isFetching)}
            onClick={() =>
              void Promise.all(queries.map((query) => query.refetch()))
            }
            size="icon"
            variant="outline"
          >
            <RefreshCw
              aria-hidden="true"
              className={
                queries.some((query) => query.isFetching) ? "animate-spin" : ""
              }
              size={15}
            />
          </Button>
        </div>
      </header>

      <section className="signal-ledger" aria-labelledby="signal-ledger-title">
        <div className="signal-ledger-head">
          <div>
            <h2 id="signal-ledger-title">24 小时运行信号</h2>
            <p>每个节点都来自真实 Execution；树状分支对应网站声明的 Cron。</p>
          </div>
          <div className="signal-legend" aria-label="运行状态图例">
            <span className="is-success">成功</span>
            <span className="is-running">运行中</span>
            <span className="is-warning">结果未知</span>
            <span className="is-failure">失败</span>
            <span className="is-muted">无记录</span>
          </div>
        </div>

        <div className="signal-board">
          <TimeScale now={now} />
          {websiteGroups.length === 0 ? (
            <div className="signal-empty">
              <RadioTower aria-hidden="true" size={22} />
              <div>
                <strong>尚无网站 Worker</strong>
                <p>网站完成 Registration 后，运行信号会在这里出现。</p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/registrations">前往网站接入</Link>
              </Button>
            </div>
          ) : (
            websiteGroups.map((group) => (
              <WebsiteSignal
                executions={executionRows}
                group={group}
                key={group.target.id}
                now={now}
              />
            ))
          )}
        </div>
      </section>

      <div className="overview-workbench">
        <section
          className="website-ledger"
          aria-labelledby="website-ledger-title"
        >
          <div className="workbench-head">
            <div>
              <h2 id="website-ledger-title">网站与自动任务</h2>
              <p>先看网站，再进入它声明的 Cron 和运行证据。</p>
            </div>
            <Link to="/targets">
              查看所有网站 <ArrowRight aria-hidden="true" size={14} />
            </Link>
          </div>
          <div className="website-rows">
            {websiteGroups.map(({ target, schedules: websiteSchedules }) => {
              const active = websiteSchedules.filter(
                (schedule) => schedule.effectiveEnabled,
              ).length;
              const abnormal = websiteSchedules.filter((schedule) =>
                ["failed", "unknown", "retry_wait"].includes(
                  schedule.lastExecution?.status ?? "",
                ),
              ).length;
              return (
                <Link
                  className="website-row"
                  key={target.id}
                  to={`/schedules?target=${encodeURIComponent(target.id)}`}
                >
                  <span
                    aria-hidden="true"
                    className="website-status-node"
                    data-tone={
                      target.state?.enabled !== 1
                        ? "muted"
                        : abnormal > 0
                          ? "attention"
                          : "healthy"
                    }
                  />
                  <span className="website-row-main">
                    <strong>{target.label}</strong>
                    <small className="mono">{target.id}</small>
                  </span>
                  <span className="website-row-count tabular">
                    {active}/{websiteSchedules.length} 可派发
                  </span>
                  <span className="website-row-registration">
                    {target.registration
                      ? `版本 ${target.registration.revision}`
                      : "等待首次注册"}
                  </span>
                  <ArrowRight aria-hidden="true" size={15} />
                </Link>
              );
            })}
            {websiteGroups.length === 0 ? (
              <p className="workbench-empty">
                网站接入后会按 Worker 聚合显示。
              </p>
            ) : null}
          </div>
        </section>

        <section className="attention-ledger" aria-labelledby="attention-title">
          <div className="workbench-head">
            <div>
              <h2 id="attention-title">
                需要处理
                {attentionCount > 0 ? (
                  <span className="attention-count tabular">
                    {attentionCount}
                  </span>
                ) : null}
              </h2>
              <p>失败与结果未知优先于普通运行记录。</p>
            </div>
            <Link to="/executions">
              查看全部 <ArrowRight aria-hidden="true" size={14} />
            </Link>
          </div>
          <div className="attention-list">
            {platformNeedsAttention ? (
              <Link className="attention-item" to="/system">
                <CircleAlert aria-hidden="true" size={17} />
                <span>
                  <strong>调度心跳需要检查</strong>
                  <small>最近成功 Tick：{formatTime(lastSuccessfulTick)}</small>
                </span>
                <ArrowRight aria-hidden="true" size={14} />
              </Link>
            ) : null}
            {attentionExecutions.slice(0, 4).map((execution) => (
              <Link
                className="attention-item"
                key={execution.id}
                to={`/executions/${execution.id}`}
              >
                {execution.status === "failed" ? (
                  <CircleAlert aria-hidden="true" size={17} />
                ) : execution.status === "retry_wait" ? (
                  <Clock3 aria-hidden="true" size={17} />
                ) : (
                  <PauseCircle aria-hidden="true" size={17} />
                )}
                <span>
                  <strong>
                    {targetLabel(targets.data.data, execution.targetId)} ·{" "}
                    {execution.scheduleName ?? "未知任务"}
                  </strong>
                  <small>
                    {formatTime(execution.createdAt)} ·{" "}
                    {statusLabel(execution.status)}
                  </small>
                </span>
                <ArrowRight aria-hidden="true" size={14} />
              </Link>
            ))}
            {!platformNeedsAttention && attentionExecutions.length === 0 ? (
              <div className="attention-clear">
                <CheckCircle2 aria-hidden="true" size={20} />
                <div>
                  <strong>当前没有需要处理的执行</strong>
                  <p>调度心跳与最近 24 小时运行均未发现异常。</p>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="quality-strip" aria-label="运行质量与平台状态">
        <QualityMetric
          label="24 小时执行成功"
          value={formatRate(
            data.successRates.find((item) => item.window === "24h")?.execution
              .rate ?? null,
          )}
        />
        <QualityMetric
          label="7 天首次成功"
          value={formatRate(
            data.successRates.find((item) => item.window === "7d")?.firstAttempt
              .rate ?? null,
          )}
        />
        <div className="quality-platform">
          <StatusBadge status={heartbeatStatus} />
          <StatusBadge status={dispatchStatus} />
          <span className="tabular">
            {data.schedules.active_schedules ?? 0}/
            {data.schedules.total_schedules ?? 0} 个任务可派发
          </span>
        </div>
      </section>
    </div>
  );
}

function TimeScale({ now }: { now: number }) {
  return (
    <div className="signal-time-scale" aria-hidden="true">
      <span />
      <div>
        {Array.from({ length: 7 }, (_value, index) => {
          const time = now - DAY_MS + (DAY_MS / 6) * index;
          return <time key={time}>{formatHour(time)}</time>;
        })}
      </div>
      <span>最近结果 / 下一次</span>
    </div>
  );
}

function WebsiteSignal({
  group,
  executions,
  now,
}: {
  group: WebsiteGroup;
  executions: ExecutionSummary[];
  now: number;
}) {
  const { target, schedules } = group;
  const hasAttention = executions.some(
    (execution) =>
      execution.targetId === target.id &&
      ATTENTION_STATUSES.has(execution.status),
  );
  return (
    <article className="signal-site">
      <div className="signal-site-head">
        <span
          aria-hidden="true"
          className="signal-site-node"
          data-tone={
            target.state?.enabled !== 1
              ? "muted"
              : hasAttention
                ? "attention"
                : "healthy"
          }
        />
        <div>
          <Link to={`/schedules?target=${encodeURIComponent(target.id)}`}>
            {target.label}
          </Link>
          <span className="mono">{target.id}</span>
        </div>
        <span className="tabular">{schedules.length} 个任务</span>
      </div>
      <div className="signal-task-list">
        {schedules.length === 0 ? (
          <div className="signal-task signal-task-empty">
            <span>尚未声明 Cron</span>
            <span className="signal-track-empty">等待网站 Registration</span>
            <span>—</span>
          </div>
        ) : (
          schedules.map((schedule) => {
            const scheduleExecutions = executions.filter(
              (execution) => execution.scheduleId === schedule.id,
            );
            return (
              <div className="signal-task" key={schedule.id}>
                <div className="signal-task-name">
                  <span aria-hidden="true" className="signal-branch-node" />
                  <Link to={`/schedules/${schedule.id}`}>{schedule.name}</Link>
                  <code>{schedule.cronExpression}</code>
                </div>
                <ExecutionTrace
                  executions={scheduleExecutions}
                  now={now}
                  scheduleName={schedule.name}
                />
                <div className="signal-task-next">
                  {schedule.lastExecution ? (
                    <StatusBadge status={schedule.lastExecution.status} />
                  ) : (
                    <span className="signal-no-status">尚未运行</span>
                  )}
                  <time className="tabular">
                    {formatTime(schedule.nextRunAt)}
                  </time>
                </div>
              </div>
            );
          })
        )}
      </div>
    </article>
  );
}

function ExecutionTrace({
  executions,
  now,
  scheduleName,
}: {
  executions: ExecutionSummary[];
  now: number;
  scheduleName: string;
}) {
  const points = executions
    .flatMap((execution) => {
      const time = Date.parse(execution.createdAt ?? "");
      if (!Number.isFinite(time) || time < now - DAY_MS || time > now)
        return [];
      return [
        {
          execution,
          x: Math.max(
            1,
            Math.min(99, ((time - (now - DAY_MS)) / DAY_MS) * 100),
          ),
          y: traceY(execution.status),
        },
      ];
    })
    .sort((left, right) => left.x - right.x);
  const path =
    points.length === 0
      ? "M 0 16 L 100 16"
      : `M 0 16 ${points.map((point) => `L ${point.x.toFixed(2)} ${point.y}`).join(" ")} L 100 16`;
  const summary =
    points.length === 0
      ? `${scheduleName} 最近 24 小时没有执行记录`
      : `${scheduleName} 最近 24 小时有 ${points.length} 次执行`;

  return (
    <div className="signal-track">
      <svg
        aria-label={summary}
        preserveAspectRatio="none"
        role="img"
        viewBox="0 0 100 32"
      >
        <path className={points.length === 0 ? "is-empty" : ""} d={path} />
        {points.map(({ execution, x, y }) => (
          <circle
            className={`signal-execution-point status-${execution.status}`}
            cx={x}
            cy={y}
            key={execution.id}
            r="1.65"
          />
        ))}
      </svg>
      {points.length > 0 ? (
        <ul className="sr-only">
          {points.map(({ execution }) => (
            <li key={execution.id}>
              {scheduleName}，{formatTime(execution.createdAt)}，
              {statusLabel(execution.status)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function QualityMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="quality-metric">
      <span>{label}</span>
      <strong className="tabular">{value}</strong>
    </div>
  );
}

function groupWebsites(
  targets: Target[],
  schedules: ScheduleSummary[],
  attentionExecutions: ExecutionSummary[],
): WebsiteGroup[] {
  return targets
    .map((target) => ({
      target,
      schedules: schedules
        .filter((schedule) => schedule.targetId === target.id)
        .sort((left, right) => {
          const leftAttention = attentionExecutions.some(
            (execution) => execution.scheduleId === left.id,
          );
          const rightAttention = attentionExecutions.some(
            (execution) => execution.scheduleId === right.id,
          );
          return (
            Number(rightAttention) - Number(leftAttention) ||
            left.name.localeCompare(right.name, "zh-CN")
          );
        }),
    }))
    .sort((left, right) => {
      const leftAttention = attentionExecutions.some(
        (execution) => execution.targetId === left.target.id,
      );
      const rightAttention = attentionExecutions.some(
        (execution) => execution.targetId === right.target.id,
      );
      return (
        Number(rightAttention) - Number(leftAttention) ||
        left.target.label.localeCompare(right.target.label, "zh-CN")
      );
    });
}

function businessVerdict(input: {
  websites: number;
  schedules: number;
  attentionCount: number;
  dispatchPaused: boolean;
}) {
  if (input.websites === 0 || input.schedules === 0) {
    return { label: "等待网站发布自动任务", tone: "quiet" } as const;
  }
  if (input.dispatchPaused) {
    return { label: "所有网站的自动派发已暂停", tone: "attention" } as const;
  }
  if (input.attentionCount > 0) {
    return {
      label: `${input.attentionCount} 项需要处理`,
      tone: "attention",
    } as const;
  }
  return { label: "所有网站自动任务运行正常", tone: "healthy" } as const;
}

function traceY(status: string): number {
  if (status === "failed") return 8;
  if (status === "unknown" || status === "retry_wait") return 24;
  if (status === "running" || status === "pending") return 12;
  return 16;
}

function statusLabel(status: string): string {
  return (
    {
      failed: "明确失败",
      unknown: "结果未知",
      retry_wait: "等待重试",
    }[status] ?? status
  );
}

function targetLabel(targets: Target[], targetId: string): string {
  return targets.find((target) => target.id === targetId)?.label ?? targetId;
}

function formatHour(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

function formatRate(value: number | null): string {
  return value === null ? "暂无样本" : `${(value * 100).toFixed(1)}%`;
}
