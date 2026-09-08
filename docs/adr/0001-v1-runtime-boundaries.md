# ADR 0001：V1 运行时边界

状态：接受，2026-09-08。

## 决策

V1 使用一个平台 Worker、一个 Cron Trigger、D1、命名 Service Binding RPC 和 Static Assets。采用 D1 短 batch + 条件更新实现物化、claim、finalize 和租约恢复。

不使用 Queue、KV、Durable Object、Workflow、Redis、外部 Cron、动态 HTTP target 或通用插件系统。

## 理由

产品目标是节省并统一单账号 Cron，而不是构建通用任务平台。D1 持久化计划和执行状态；Service Binding 提供账户内显式连接；命名 Entrypoint 允许业务 Worker 保留现有 fetch。

## 后果

- 平台不会把 accepted 当作业务成功。
- 跨 D1 与业务副作用不能 exactly-once，unknown 与业务幂等是协议的一部分。
- 目标能力仍需部署时声明；Web 不能动态创建 binding。
- 每 Tick 工作量严格有界，集中到期可能延后。
- 将来接入 Queue/Workflow 必须设计新的 accepted/final completion 契约，不能复用同步成功结果。
