import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  PauseCircle,
  RadioTower,
  RefreshCw,
} from "lucide-react";
import { useEffect, useId, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { ErrorState, LoadingState } from "@/components/shared/page-states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api-client";
import {
  overviewSchema,
  schedulesSchema,
  targetsSchema,
  type SignalBucket,
  type ScheduleSummary,
  type Target,
} from "@/lib/api-schemas";
import { displayTimezone, formatCron, formatTime } from "@/lib/format";
import { runHref, runStatusLabels } from "@/lib/runs";

const DAY_MS = 24 * 60 * 60 * 1000;
const ATTENTION_STATUSES = new Set(["failed", "unknown", "retry_wait"]);
const SIGNAL_EXPANSION_KEY = "unified-cron:overview:site-expansion";

interface WebsiteGroup {
  target: Target;
  schedules: ScheduleSummary[];
}

export function OverviewPage() {
  const [signalExpansion, setSignalExpansion] =
    useState<Record<string, boolean>>(readSignalExpansion);
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
  useEffect(() => {
    try {
      window.localStorage.setItem(
        SIGNAL_EXPANSION_KEY,
        JSON.stringify(signalExpansion),
      );
    } catch {
      // The control remains usable when browser storage is unavailable.
    }
  }, [signalExpansion]);

  const queries = [overview, schedules, targets] as const;
  if (queries.some((query) => query.isLoading)) {
    return <LoadingState label="正在汇总网站运行信号" />;
  }
  const failedQuery = queries.find((query) => query.isError);
  if (
    failedQuery?.isError ||
    !overview.data ||
    !schedules.data ||
    !targets.data
  ) {
    return (
      <ErrorState
        error={failedQuery?.error}
        retry={() => void Promise.all(queries.map((query) => query.refetch()))}
      />
    );
  }

  const { data, meta } = overview.data;
  const weekRate = data.successRates.find((item) => item.window === "7d");
  const now = Date.parse(meta.serverTime);
  const attentionExecutions = data.attention.items;
  const websiteGroups = groupWebsites(
    targets.data.data,
    schedules.data.data,
    new Set([
      ...data.signalBuckets
        .filter((bucket) => ATTENTION_STATUSES.has(bucket.status))
        .map((bucket) => bucket.scheduleId),
      ...attentionExecutions.map((run) => run.scheduleId),
    ]),
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
    data.attention.total + (platformNeedsAttention ? 1 : 0);
  const verdict = businessVerdict({
    websites: websiteGroups.length,
    schedules: schedules.data.data.length,
    attentionCount,
    dispatchPaused,
    coverage: data.coverage,
    blocked:
      (data.schedules.total_schedules ?? 0) -
      (data.schedules.active_schedules ?? 0),
  });
  const isSiteExpanded = (targetId: string, index: number) =>
    signalExpansion[targetId] ?? (websiteGroups.length === 1 || index === 0);
  const allSitesExpanded = websiteGroups.every((group, index) =>
    isSiteExpanded(group.target.id, index),
  );

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
            <p>
              覆盖全部 Queue 与 RPC 运行，按小时聚合；点击节点查看详情。时间：
              {displayTimezone}。
            </p>
          </div>
          <div className="signal-ledger-tools">
            <div className="signal-legend" aria-label="运行状态图例">
              <span className="is-success">成功</span>
              <span className="is-running">运行中</span>
              <span className="is-retry">等待重试</span>
              <span className="is-warning">结果未知</span>
              <span className="is-failure">失败</span>
              <span className="is-warning">未上报</span>
              <span className="is-muted">无记录</span>
            </div>
            {websiteGroups.length > 1 ? (
              <Button
                onClick={() =>
                  setSignalExpansion((current) => ({
                    ...current,
                    ...Object.fromEntries(
                      websiteGroups.map((group) => [
                        group.target.id,
                        !allSitesExpanded,
                      ]),
                    ),
                  }))
                }
                size="sm"
                variant="outline"
              >
                {allSitesExpanded ? "全部收起" : "全部展开"}
              </Button>
            ) : null}
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
            websiteGroups.map((group, index) => (
              <WebsiteSignal
                expanded={isSiteExpanded(group.target.id, index)}
                buckets={data.signalBuckets}
                group={group}
                key={group.target.id}
                now={now}
                onToggle={() =>
                  setSignalExpansion((current) => ({
                    ...current,
                    [group.target.id]: !isSiteExpanded(group.target.id, index),
                  }))
                }
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
              const abnormal = data.signalBuckets.filter(
                (bucket) =>
                  websiteSchedules.some(
                    (schedule) => schedule.id === bucket.scheduleId,
                  ) && ATTENTION_STATUSES.has(bucket.status),
              ).length;
              const latest = websiteSchedules
                .map((schedule) => schedule.lastExecution)
                .filter((item) => item !== null)
                .sort(
                  (a, b) => Date.parse(b.at ?? "") - Date.parse(a.at ?? ""),
                )[0];
              const next = websiteSchedules
                .filter(
                  (schedule) => schedule.effectiveEnabled && schedule.nextRunAt,
                )
                .map((schedule) => schedule.nextRunAt ?? "")
                .sort()[0];
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
                          : latest?.status === "succeeded"
                            ? "healthy"
                            : "muted"
                    }
                  />
                  <span className="website-row-main">
                    <strong>{target.label}</strong>
                    <small>
                      {latest ? (
                        <>
                          最近结果：{statusLabel(latest.status)} ·{" "}
                          {formatTime(latest.at)}
                        </>
                      ) : (
                        "暂无运行结果"
                      )}
                    </small>
                  </span>
                  <span className="website-row-count tabular">
                    {active}/{websiteSchedules.length} 可派发
                  </span>
                  <span className="website-row-registration">
                    下次 {formatTime(next)}
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
                to={runHref(execution)}
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
                    {execution.reasonCode ? ` · ${execution.reasonCode}` : ""}
                  </small>
                </span>
                <ArrowRight aria-hidden="true" size={14} />
              </Link>
            ))}
            {!platformNeedsAttention && attentionExecutions.length === 0 ? (
              <div
                className="attention-clear"
                data-quiet={
                  data.coverage.total === 0 ||
                  data.coverage.unreported > 0 ||
                  data.coverage.unverifiedSchedules > 0
                }
              >
                {data.coverage.total > 0 &&
                data.coverage.unreported === 0 &&
                data.coverage.unverifiedSchedules === 0 ? (
                  <CheckCircle2 aria-hidden="true" size={20} />
                ) : (
                  <Clock3 aria-hidden="true" size={20} />
                )}
                <div>
                  <strong>
                    {data.coverage.unreported > 0
                      ? `${data.coverage.unreported} 次运行尚未上报结果`
                      : data.coverage.total === 0
                        ? "暂无运行证据"
                        : data.coverage.unverifiedSchedules > 0
                          ? `${data.coverage.unverifiedSchedules} 个任务等待首次结果`
                          : "最近 24 小时未发现失败或结果未知"}
                  </strong>
                  <p>
                    {data.coverage.unreported > 0
                      ? "业务结果尚未确认，可前往执行记录查看。"
                      : "运行结果与调度心跳分别检查。"}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="quality-strip" aria-label="运行质量与平台状态">
        <QualityMetric
          label="24 小时执行成功"
          metric={
            data.successRates.find((item) => item.window === "24h")
              ?.execution ?? null
          }
          tone="info"
        />
        <QualityMetric
          label="7 天首次成功"
          metric={weekRate?.firstAttempt ?? null}
          excludedSamples={Math.max(
            0,
            (weekRate?.execution.denominator ?? 0) -
              (weekRate?.firstAttempt.denominator ?? 0),
          )}
          tone="comparison"
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
  buckets,
  expanded,
  now,
  onToggle,
}: {
  group: WebsiteGroup;
  buckets: SignalBucket[];
  expanded: boolean;
  now: number;
  onToggle: () => void;
}) {
  const { target, schedules } = group;
  const taskListId = useId();
  const siteBuckets = buckets.filter((bucket) =>
    schedules.some((schedule) => schedule.id === bucket.scheduleId),
  );
  const hasAttention = siteBuckets.some((bucket) =>
    ATTENTION_STATUSES.has(bucket.status),
  );
  const confirmed = schedules.every(
    (schedule) => schedule.lastExecution?.status === "succeeded",
  );
  return (
    <article className="signal-site" data-expanded={expanded}>
      <div className="signal-site-head">
        <button
          aria-controls={taskListId}
          aria-expanded={expanded}
          aria-label={`${expanded ? "收起" : "展开"} ${target.label} 的 ${schedules.length} 个任务`}
          className="signal-site-toggle"
          onClick={onToggle}
          type="button"
        >
          <span
            aria-hidden="true"
            className="signal-site-node"
            data-tone={
              target.state?.enabled !== 1
                ? "muted"
                : hasAttention
                  ? "attention"
                  : confirmed
                    ? "healthy"
                    : "muted"
            }
          />
          <span className="signal-site-identity">
            <strong>{target.label}</strong>
            <span className="mono">{target.id}</span>
          </span>
          <span className="signal-site-toggle-meta tabular">
            {schedules.length} 个任务 ·{" "}
            {siteBuckets.reduce((sum, bucket) => sum + bucket.count, 0)} 次运行
            <ChevronDown aria-hidden="true" size={15} />
          </span>
        </button>
        <Link
          aria-label={`查看 ${target.label} 的所有 Cron`}
          className="signal-site-open"
          to={`/schedules?target=${encodeURIComponent(target.id)}`}
        >
          <ArrowRight aria-hidden="true" size={14} />
        </Link>
      </div>
      <div className="signal-task-list" hidden={!expanded} id={taskListId}>
        {schedules.length === 0 ? (
          <div className="signal-task signal-task-empty">
            <span>尚未声明 Cron</span>
            <span className="signal-track-empty">等待网站 Registration</span>
            <span>—</span>
          </div>
        ) : (
          schedules.map((schedule) => {
            const scheduleBuckets = buckets.filter(
              (bucket) => bucket.scheduleId === schedule.id,
            );
            return (
              <div className="signal-task" key={schedule.id}>
                <div className="signal-task-name">
                  <span aria-hidden="true" className="signal-branch-node" />
                  <Link to={`/schedules/${schedule.id}`}>{schedule.name}</Link>
                  <span
                    className="signal-task-schedule"
                    title={`${schedule.cronExpression} · ${schedule.timezone}`}
                  >
                    {formatCron(schedule.cronExpression, schedule.timezone)}
                  </span>
                </div>
                <ExecutionTrace
                  buckets={scheduleBuckets}
                  now={now}
                  scheduleName={schedule.name}
                />
                <div className="signal-task-next">
                  {schedule.lastExecution ? (
                    <StatusBadge status={schedule.lastExecution.status} />
                  ) : (
                    <span className="signal-no-status">暂无运行结果</span>
                  )}
                  {schedule.lastExecution && (
                    <small className="tabular">
                      最近 {formatTime(schedule.lastExecution.at)}
                    </small>
                  )}
                  <time className="tabular">
                    下次{" "}
                    {schedule.effectiveEnabled
                      ? formatTime(schedule.nextRunAt)
                      : "已暂停"}
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
  buckets,
  now,
  scheduleName,
}: {
  buckets: SignalBucket[];
  now: number;
  scheduleName: string;
}) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const summary =
    total === 0
      ? `${scheduleName} 最近 24 小时没有执行记录`
      : `${scheduleName} 最近 24 小时有 ${total} 次执行`;
  return (
    <div className="signal-track">
      <div
        aria-label={summary}
        className={`signal-track-plot${total === 0 ? " is-empty" : ""}`}
        role="group"
      >
        {buckets.map((bucket) => {
          const x = Math.max(
            1,
            Math.min(
              99,
              ((Date.parse(bucket.at) - (now - DAY_MS)) / DAY_MS) * 100,
            ),
          );
          const y = traceY(bucket.status);
          const query = new URLSearchParams({
            scheduleId: bucket.scheduleId,
            window: "custom",
            from: bucket.from,
            to: bucket.to,
          });
          const href = bucket.runId
            ? runHref({ id: bucket.runId, mode: bucket.mode })
            : `/executions?${query.toString()}`;
          const label = `${scheduleName}，${formatTime(bucket.at)}，${bucket.count} 次运行，${statusLabel(bucket.status)}${bucket.count > 1 ? "（该小时最需关注的状态）" : ""}`;
          return (
            <Link
              aria-label={label}
              title={label}
              className={`signal-execution-link status-${bucket.status}`}
              key={`${bucket.scheduleId}:${bucket.from}`}
              style={
                {
                  "--signal-x": `${x}%`,
                  "--signal-y": `${y}px`,
                  "--signal-stem-top": `${Math.min(y, 16)}px`,
                  "--signal-stem-height": `${Math.abs(y - 16)}px`,
                } as CSSProperties
              }
              to={href}
            >
              <span aria-hidden="true" className="signal-execution-stem" />
              <span aria-hidden="true" className="signal-execution-point" />
              {bucket.count > 1 && (
                <span className="signal-bucket-count" aria-hidden="true">
                  {bucket.count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function QualityMetric({
  label,
  metric,
  tone,
  excludedSamples = 0,
}: {
  label: string;
  metric: {
    numerator: number;
    denominator: number;
    rate: number | null;
  } | null;
  tone: "info" | "comparison";
  excludedSamples?: number;
}) {
  const percentage =
    metric?.rate === null || metric?.rate === undefined
      ? null
      : Math.round(metric.rate * 1000) / 10;
  const value =
    percentage === null
      ? excludedSamples > 0
        ? "次数未记录"
        : "暂无样本"
      : `${percentage}%`;
  return (
    <div className="quality-metric" data-tone={tone}>
      <div className="quality-metric-head">
        <span>{label}</span>
        <strong className="tabular">{value}</strong>
      </div>
      <div
        aria-label={`${label}：${value}`}
        aria-valuemax={100}
        aria-valuemin={0}
        {...(percentage === null ? {} : { "aria-valuenow": percentage })}
        className="quality-meter"
        role="meter"
      >
        <span
          className="quality-meter-fill"
          style={
            {
              "--quality-value": `${percentage ?? 0}%`,
            } as CSSProperties
          }
        />
      </div>
      <small
        className="tabular"
        title={
          excludedSamples > 0
            ? `${excludedSamples} 条历史回报未记录业务尝试次数，已排除出首次成功率`
            : undefined
        }
      >
        {metric && metric.denominator > 0
          ? `${metric.numerator}/${metric.denominator} 次成功`
          : excludedSamples > 0
            ? "历史回报缺少业务尝试次数"
            : "等待有效样本"}
      </small>
    </div>
  );
}

function readSignalExpansion(): Record<string, boolean> {
  try {
    const stored = window.localStorage.getItem(SIGNAL_EXPANSION_KEY);
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

function groupWebsites(
  targets: Target[],
  schedules: ScheduleSummary[],
  attentionScheduleIds: Set<string>,
): WebsiteGroup[] {
  return targets
    .map((target) => ({
      target,
      schedules: schedules
        .filter((schedule) => schedule.targetId === target.id)
        .sort((left, right) => {
          const leftAttention = attentionScheduleIds.has(left.id);
          const rightAttention = attentionScheduleIds.has(right.id);
          return (
            Number(rightAttention) - Number(leftAttention) ||
            left.name.localeCompare(right.name, "zh-CN")
          );
        }),
    }))
    .sort((left, right) => {
      const leftAttention = left.schedules.some((schedule) =>
        attentionScheduleIds.has(schedule.id),
      );
      const rightAttention = right.schedules.some((schedule) =>
        attentionScheduleIds.has(schedule.id),
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
  coverage: {
    total: number;
    succeeded: number;
    unreported: number;
    active: number;
    unverifiedSchedules: number;
  };
  blocked: number;
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
  if (input.blocked > 0)
    return {
      label: `${input.blocked} 个任务当前不可派发`,
      tone: "attention",
    } as const;
  if (input.coverage.unreported > 0)
    return {
      label: `${input.coverage.unreported} 次运行尚未确认业务结果`,
      tone: "quiet",
    } as const;
  if (input.coverage.unverifiedSchedules > 0)
    return {
      label: `${input.coverage.unverifiedSchedules} 个任务等待首次运行结果`,
      tone: "quiet",
    } as const;
  if (input.coverage.succeeded === 0)
    return {
      label:
        input.coverage.active > 0
          ? `${input.coverage.active} 次任务正在进行`
          : "最近 24 小时暂无成功运行证据",
      tone: "quiet",
    } as const;
  return {
    label: `最近 24 小时已确认 ${input.coverage.succeeded} 次成功`,
    tone: "healthy",
  } as const;
}

function traceY(status: string): number {
  if (status === "failed") return 8;
  if (status === "unknown" || status === "retry_wait") return 24;
  if (status === "running" || status === "pending") return 12;
  return 16;
}

function statusLabel(status: string): string {
  return runStatusLabels[status] ?? status;
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
