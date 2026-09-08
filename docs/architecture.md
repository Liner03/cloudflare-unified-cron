# V1 架构实现说明

## 部署单元

生产部署包含一个平台 Worker、一个 `* * * * *` Cron Trigger、一个平台 D1 和一组 Workers Static Assets。每个业务 Worker 独立部署，通过预声明的 Service Binding 命名入口连接。

平台没有 KV、Queue、Durable Object、Workflow、Redis、动态 URL 调用或任意方法执行。

## 分层

- `domain`：Clock、状态与重试策略，不访问 Cloudflare `env`。
- `application`：Tick 顺序、派发预算、RPC 结果决策。
- `infrastructure/d1`：业务语义 repository 与短事务。
- `infrastructure/rpc`：静态 binding allowlist 与结果校验。
- `infrastructure/auth`：Access JWT、Origin 与本地 fail-closed 边界。
- `api/routes`：按 Overview、Schedules、Targets、Executions、System 拆分的 Hono 资源模块。
- `api`：共享请求解析、执行视图序列化、Zod 入站验证、API 幂等、审计和统一错误 envelope。
- `apps/web`：只通过 `/api/v1` 访问状态，不直接接触 D1 或 Service Binding。

## 核心不变量

1. `(schedule_id, scheduled_for)` 只有一个 cron Execution。
2. 同一 Schedule 同时最多一个 `pending/running/retry_wait/unknown` Execution。
3. Execution 的快照、来源和幂等键在 Retry 中不变。
4. Attempt number 在一个 Execution 内单调递增且唯一。
5. 物化 Execution 与推进 Schedule 的 `next_run_at` 在同一 D1 `batch()`。
6. claim 与 Attempt 插入在同一 `batch()`；第二条失败会回滚 running 状态。
7. finalize 同时匹配 Execution、Attempt 和 lease token；旧响应只能记录日志。
8. RPC 在 D1 事务外。租约只隔离平台状态写入，不能回滚外部副作用。
9. Schedule 数量上限在创建 SQL 内重新检查；请求前 count 只用于快速失败，不能作为并发保护。

## Tick 顺序与预算

一次 scheduled invocation：

1. 写本轮 tickId、scheduled time 与实际开始时间。
2. 最多恢复 2 个过期租约，并结束到期的自动重试窗口。
3. 全局暂停时停止物化与派发，但完成心跳。
4. 最多物化 2 个到期 Schedule。
5. 按 `available_at, created_at, id` 最多 claim 2 个 Attempt。
6. 通过 Service Binding RPC 并发执行，逐项校验和 finalize。
7. 有余量时有界清理 50 个 Execution、50 个 audit、100 个 API 幂等记录。
8. 用 tickId 条件更新最终心跳，旧 Tick 不能覆盖新 Tick。

最坏常规路径保守低于 40 条 D1 statements；开始新 RPC 前为 finalize 保留 2 秒软件预算。45 秒是应用软 wall budget，不是 Cloudflare 平台保证。

## 状态真实性

- `failed`：收到明确失败或安全重试耗尽。
- `unknown`：超时、RPC 中断、租约过期，或结果无法安全确认。
- `skipped`：MISFIRE、OVERLAP 或禁用目标，没有调用业务。
- `cancelled`：仅取消未派发意图，或管理员明确放弃 unknown；不表示副作用被撤销。

## 已知边界

- V1 每分钟最多新派发 2 个 Attempt；集中到期会排队到后续 Tick。
- 普通 Service Binding 不固定目标的旧二进制，Action version 向后兼容由业务 Worker 负责。
- 本地 elapsed time 不是 Cloudflare CPU time；远程 p50/p95/p99 仍需受控环境验证。
