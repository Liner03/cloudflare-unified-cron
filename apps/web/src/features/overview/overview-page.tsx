import { useGSAP } from "@gsap/react";
import { useQuery } from "@tanstack/react-query";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowDownRight, ArrowRight, CalendarPlus, RadioTower } from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { ErrorState, LoadingState } from "@/components/shared/page-states";
import { apiGet } from "@/lib/api-client";
import { overviewSchema } from "@/lib/api-schemas";
import { formatTime, shortId } from "@/lib/format";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function OverviewPage() {
  const scope = useRef<HTMLDivElement>(null);
  const query = useQuery({
    queryKey: ["overview"],
    queryFn: ({ signal }) => apiGet("/api/v1/overview", overviewSchema, signal),
    refetchInterval: 30_000,
  });

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const cards = gsap.utils.toArray<HTMLElement>(".execution-stack-card");
      if (cards.length > 0) {
        ScrollTrigger.create({
          trigger: ".execution-story",
          start: "top 96px",
          end: "bottom bottom-=120",
          pin: ".execution-story-title",
          pinSpacing: false,
        });
        cards.forEach((card, index) => {
          gsap.fromTo(
            card,
            { y: 90, scale: 0.94, opacity: 0.45 },
            {
              y: 0,
              scale: 1,
              opacity: 1,
              ease: "none",
              scrollTrigger: {
                trigger: card,
                start: "top 90%",
                end: "top 42%",
                scrub: true,
              },
            },
          );
          if (index < cards.length - 1) {
            const nextCard = cards[index + 1];
            if (!nextCard) return;
            gsap.to(card, {
              scale: 0.96,
              opacity: 0.38,
              ease: "none",
              scrollTrigger: {
                trigger: nextCard,
                start: "top 68%",
                end: "top 35%",
                scrub: true,
              },
            });
          }
        });
      }
    },
    { scope, dependencies: [query.data?.data.recentExecutions.length] },
  );

  if (query.isLoading) return <div ref={scope}><LoadingState /></div>;
  if (query.isError || !query.data) {
    return <div ref={scope}><ErrorState error={query.error} retry={() => void query.refetch()} /></div>;
  }

  const { data, meta } = query.data;
  const state = data.system;
  const serverNow = Date.parse(meta.serverTime);
  const lastSuccess = state?.last_successful_tick_at ?? null;
  const stale = lastSuccess === null || serverNow - lastSuccess > 3 * 60 * 1000;
  const paused = state?.dispatch_paused === 1;
  const tickStatus = paused ? "paused" : stale ? "stale" : "healthy";
  const counts = new Map(data.executions24h.map((row) => [row.status, row.count]));
  const recent = data.recentExecutions.slice(0, 5);

  return (
    <div className="overview-experience" ref={scope}>
      <section className="overview-hero" aria-labelledby="overview-title">
        <div className="overview-hero-copy">
          <h1 className="w-full max-w-6xl" id="overview-title">
            一个真实时钟，<br />驱动所有关键计划。
          </h1>
          <p>
            D1 保存每次执行意图，Service Binding RPC 连接独立业务 Worker。失败可以处理，结果未知不会被粉饰成成功。
          </p>
          <div className="overview-hero-actions">
            <Button asChild size="lg">
              <Link to="/schedules/new"><CalendarPlus size={17} /> 新建计划</Link>
            </Button>
            <Button asChild className="hero-secondary" size="lg" variant="outline">
              <Link to="/executions?status=unknown">查看风险执行 <ArrowRight size={16} /></Link>
            </Button>
          </div>
        </div>
        <div className="overview-hero-media group overflow-hidden">
          <img
            alt="抽象的数据中心和网络运行环境"
            className="h-full w-full object-cover grayscale contrast-125 transition-transform duration-700 ease-out group-hover:scale-105"
            src="https://picsum.photos/seed/network-operations/1920/1080"
          />
          <div className="overview-hero-wash" />
          <div className="overview-hero-caption">
            <RadioTower aria-hidden="true" size={18} />
            <span>Cloudflare Worker scheduled() · every minute</span>
          </div>
        </div>
      </section>

      <section className="overview-interest" aria-labelledby="operating-state-title">
        <div className="section-heading-wide">
          <h2 id="operating-state-title">当前运行态，不做推测。</h2>
          <p>数据来自 API 与 D1。心跳、业务结果和目标兼容性是三种不同的健康信号。</p>
        </div>
        <div className="operations-bento grid-flow-dense">
          <article className="bento-primary col-span-7 row-span-2">
            <div className="bento-card-head">
              <div>
                <h3>24 小时执行分布</h3>
                <p>终态与风险状态分别计数</p>
              </div>
              <ArrowDownRight aria-hidden="true" size={20} />
            </div>
            <div className="execution-bars">
              {([
                ["succeeded", "成功"],
                ["failed", "失败"],
                ["unknown", "结果未知"],
                ["retry_wait", "等待重试"],
                ["skipped", "跳过"],
              ] as const).map(([status, label]) => {
                const count = counts.get(status) ?? 0;
                const maximum = Math.max(1, ...Array.from(counts.values()));
                return (
                  <div className="execution-bar-row" key={status}>
                    <span>{label}</span>
                    <div className="execution-bar-track">
                      <div className={`execution-bar-fill status-fill-${status}`} style={{ width: `${Math.max(3, (count / maximum) * 100)}%` }} />
                    </div>
                    <strong className="tabular">{count}</strong>
                  </div>
                );
              })}
            </div>
            <div className="status-marquee" aria-label="平台执行语义">
              <div className="status-marquee-track">
                {["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "UNKNOWN", "SKIPPED", "CANCELLED", "PENDING", "RUNNING", "SUCCEEDED", "FAILED", "UNKNOWN", "SKIPPED", "CANCELLED"].map((label, index) => (
                  <span aria-hidden={index >= 7} key={`${label}-${index}`}>{label}</span>
                ))}
              </div>
            </div>
          </article>

          <article className="bento-secondary col-span-5 row-span-1">
            <span className={`bento-signal ${tickStatus}`} />
            <div>
              <h3>{tickStatus === "healthy" ? "调度心跳正常" : paused ? "全局派发已暂停" : "心跳陈旧或尚未建立"}</h3>
              <p>最近成功 Tick：{formatTime(lastSuccess)}</p>
            </div>
            <div className="bento-value tabular">{data.schedules.active_schedules ?? 0}<small> / {data.schedules.total_schedules ?? 0} 计划</small></div>
          </article>

          <article className="bento-tertiary col-span-5 row-span-1">
            <div>
              <h3>有界派发</h3>
              <p>每 Tick 最多物化 2 个、派发 2 个 Attempt</p>
            </div>
            <div className="capacity-lines" aria-hidden="true">
              <span /><span /><span /><span /><span />
            </div>
            <Link className="bento-link" to="/system">查看预算与平台状态 <ArrowRight size={14} /></Link>
          </article>
        </div>
      </section>

      <section className="risk-accordion-section" aria-labelledby="risk-title">
        <div className="section-heading-wide">
          <h2 id="risk-title">把不同风险分开看。</h2>
          <p>失败表示收到明确结果；unknown 表示外部副作用可能已发生；retry_wait 只承诺最早可领取时间。</p>
        </div>
        <div className="risk-accordion">
          {[
            { status: "failed", label: "明确失败", count: counts.get("failed") ?? 0, copy: "可查看错误码，再决定 Retry 或 Run again。" },
            { status: "unknown", label: "结果未知", count: counts.get("unknown") ?? 0, copy: "默认占用执行槽，需要人工核实或安全重试。" },
            { status: "retry_wait", label: "重试等待", count: counts.get("retry_wait") ?? 0, copy: "同一 Execution、同一幂等键，在后续 Tick 领取。" },
          ].map((item) => (
            <Link className={`risk-slice status-${item.status}`} key={item.status} to={`/executions?status=${item.status}`}>
              <div className="risk-slice-number tabular">{item.count}</div>
              <div className="risk-slice-body"><h3>{item.label}</h3><p>{item.copy}</p></div>
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
          ))}
        </div>
      </section>

      <section className="execution-story" aria-labelledby="execution-story-title">
        <div className="execution-story-title">
          <h2 id="execution-story-title">
            每次执行都有
            <span
              aria-hidden="true"
              className="inline-title-image"
              style={{ backgroundImage: "url(https://picsum.photos/seed/server-ledger/640/320)" }}
            />
            可追溯身份。
          </h2>
          <p>Execution 固定业务意图与幂等键；每次 Attempt 只记录一次具体调用。</p>
          <Button asChild variant="outline"><Link to="/executions">打开完整台账</Link></Button>
        </div>
        <div className="execution-stack">
          {recent.length === 0 ? (
            <article className="execution-stack-card">
              <span className="text-sm text-muted-foreground">尚无执行记录</span>
              <h3>创建一个暂停计划，再进行受控的立即安排。</h3>
              <Button asChild><Link to="/schedules/new">新建计划</Link></Button>
            </article>
          ) : (
            recent.map((execution, index) => (
              <Link className="execution-stack-card group" key={execution.id} to={`/executions/${execution.id}`}>
                <div className="flex items-center justify-between gap-4">
                  <span className="mono text-xs">{shortId(execution.id)}</span>
                  <StatusBadge status={execution.status} />
                </div>
                <h3>{execution.targetId} / {execution.source}</h3>
                <div className="execution-stack-meta">
                  <span>Attempt {execution.attemptCount}</span>
                  <span>{formatTime(execution.createdAt)}</span>
                  <ArrowRight className="transition-transform duration-700 ease-out group-hover:translate-x-1" size={18} />
                </div>
                <span className="execution-stack-index tabular">{String(index + 1).padStart(2, "0")}</span>
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="overview-action">
        <div>
          <h2>先保存意图，再让 Tick 安全领取。</h2>
          <p>计划编辑、人工运行和重试都不会在浏览器请求中直接调用业务 Worker。</p>
        </div>
        <div className="overview-action-buttons">
          <Button asChild className="action-primary" size="lg"><Link to="/schedules/new">建立第一个计划</Link></Button>
          <Button asChild className="action-secondary" size="lg" variant="outline"><Link to="/targets">核对 Target</Link></Button>
        </div>
      </section>
      <footer className="overview-footer">
        <span>Cloudflare Unified Cron Platform</span>
        <nav aria-label="Overview footer"><Link to="/system">System</Link><Link to="/executions">Execution ledger</Link></nav>
      </footer>
    </div>
  );
}
