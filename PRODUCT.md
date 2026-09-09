# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

由实施规格固定：React、Vite、TypeScript、shadcn/ui（Radix）、Tailwind CSS、TanStack Query、TanStack Table、React Hook Form 与 Zod；静态 SPA 和 API 一同部署到 Cloudflare Workers Static Assets。

## Users

推导自实施规格：单一 Cloudflare Account 的管理员和当值工程师。他们在桌面或移动浏览器中观察、暂停、恢复和审核运行业务 Worker 声明的逻辑 Cron 计划，并在失败或结果未知时做风险明确的人工处置。

## Product Purpose

以一个 Cloudflare 原生分钟 Cron 统一驱动多个独立业务 Worker 的逻辑 Schedule。成功意味着浏览器关闭后调度仍持续、每次 Attempt 可审计、失败可按安全边界重试、未知结果不会伪装为失败或成功。

## Positioning

平台以 D1 中的持久化执行意图和租约状态机，将“一次真实 Cron”映射成多个受白名单约束的 Service Binding RPC 调用；它是 Cron 控制中心，不是通用 Job Queue 或跨账号 SaaS。

## Operating Context

管理员主要查看 Overview、Schedules、Executions、Targets 和 System；为预授权 Target 生成 Registration Token，并在故障时对 Attempt 时间线、错误和幂等风险做判断。业务 Worker 通过注册接口声明 Action 与 Cron，控制台不再手工创建或编辑声明。应用使用本地管理员登录，Cloudflare Access 可作为生产入口的可选外层保护。

## Capabilities and Constraints

- 固定使用 Workers、一个 `* * * * *` Cron Trigger、D1、Service Bindings/RPC 和 Static Assets。
- V1 最多 50 个 Schedule，默认每 Tick 最多物化 2 个并派发 2 个 Attempt。
- 五字段 Unix Cron 数字子集，明确区别 Cloudflare 原生数字星期语义。
- Execution 与 Attempt 分离；Retry 保持 Execution/幂等键，Run again 创建新身份。
- 超时和连接中断为 `unknown`；非幂等 Action 禁止自动重试。
- Registrant Worker 通过受限 Token 提交完整期望状态；Operator override 始终优先且不能被注册覆盖。
- 成功率分别展示 Execution 最终成功率与首次 Attempt 成功率，并包含窗口和样本量。
- 不加入 KV、Queues、Durable Objects、Workflows、Redis、跨账号 HTTP 或任意代码执行。

## Brand Commitments

名称为 Cloudflare Unified Cron Platform；界面称“Cron Control Center”。默认简体中文，开发字段和状态枚举保留英文。工作页保持低装饰、信息密度适中和运维控制台语气；用户后续明确批准 Overview 使用 `gpt-taste` 的 Editorial Split、Gapless Bento 与有目的的 GSAP 动效。所有统计必须来自真实 API，禁止随机数据或伪造成功指标。

## Evidence on Hand

原始架构规格曾由用户通过 `/Users/lin/Downloads/cloudflare-unified-cron-platform-v1-architecture.md` 提供，但该外部路径当前已不可用；仓库内的架构、协议、Cron、部署和运维文档是已提交的派生基线。仓库包含真实 API、D1 migration、SDK 与示例 Worker；没有品牌 Logo、客户证明、线上性能数据或远程部署凭据，后续工作不得虚构。

## Product Principles

- 状态真实：unknown、skipped、业务失败和平台故障始终分开。
- 风险可见：人工 Retry、Run again 和核实未知结果有不同身份与清晰确认。
- 控制持久：浏览器只提交意图，D1 和 scheduled handler 承担执行连续性。
- 能力收敛：物理 Target 来自部署白名单，Action 来自该 Target 的受限 Registration；不接受任意 URL 或方法。
- 运维优先：最重要的健康、阻塞、到期和失败信息能在数秒内被扫描。

## Accessibility & Inclusion

实施规格要求键盘导航、语义表头、表单 label、错误朗读、可见焦点、对话框焦点管理、浅深色对比，以及状态不能只靠红绿区分；至少验证 390px、768px 和 1440px。
