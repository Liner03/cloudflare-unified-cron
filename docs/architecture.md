# V1 架构实现说明

## 部署单元

生产部署包含一个平台 Worker、一个 `* * * * *` Cron Trigger、一个平台 D1 和一组 Workers Static Assets。每个业务 Worker 独立部署，通过预声明的 Service Binding 命名入口连接。

平台没有 KV、Queue、Durable Object、Workflow、Redis、动态 URL 调用或任意方法执行。

## 分层

- `domain`：Clock、状态、重试策略与 transport-neutral `DomainError`，不访问 Cloudflare `env`。
- `application`：Tick 顺序、派发预算、RPC 结果决策与 Target compatibility 判定。
- `infrastructure/d1`：全部 SQL、业务语义 repository 与有界短事务；不依赖 Hono、Response 或 API error envelope。
- `infrastructure/rpc`：静态 binding allowlist 与结果校验。
- `infrastructure/auth`：本地管理员 Session、PBKDF2 密码校验与 Origin 边界。
- `api/routes`：按 Overview、Schedules、Targets、Registrations、Executions、System 拆分的薄 Hono 资源模块。
- `api`：共享请求解析、HTTP 幂等适配、Zod 入站验证和统一错误 envelope。
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
9. Registration Token 在服务端绑定一个物理 Target；请求体不能选择 Target，也不能修改 Service Binding。
10. 一个 `registrationRevision` 只能对应一份规范化声明；同 revision 不同内容返回冲突。
11. Registration 是完整期望状态：缺失 Schedule 软退役，Action 与 Schedule 批量原子替换。
12. `operator_paused` 独立于 `declared_enabled`；任何 Registration 都不能清除 Operator Override。
13. `(target_id, registration_revision)` 永久绑定首次声明 hash；旧 revision 可以原样回滚，不能绑定另一份内容。
14. 所有未退役 Managed Schedule 在整个平台合计不超过 50；D1 `AFTER INSERT` / reactivation trigger 与 reconcile 末尾 guard 是并发下的最终约束，且不会误拒绝容量上限处的 UPSERT。
15. Schedule 没有 Run now；Operator Override 会同时阻止新物化与既有 intent 的派发。
16. Retry 在每次 RPC 前重新验证快照与当前 Action 的幂等声明；幂等性被撤销时安全终止，不调用业务 Worker。
17. Effective Schedule 由 D1 `managed_schedule_effective_state` 只读投影统一计算；列表筛选、详情和 Overview 聚合不各自复制状态谓词。

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

Registration 使用 `json_each(?)` 批量写入最多 100 个 Action 与 50 个 Schedule，整个 reconcile 固定为少量 statements，不随声明条目数线性增加 D1 子请求。
Registration hash 会递归排序 JSON object keys，并按领域 identity 排序 Action 与 Schedule 集合；payload array 顺序仍保留业务语义。Schedule 声明保存同样规范化的配置 hash；revision 与 `next_run_at` 的更新只比较该 hash 和退役状态，不在多个 SQL 分支复制字段相等逻辑。

## 状态真实性

- `failed`：收到明确失败或安全重试耗尽。
- `unknown`：超时、RPC 中断、租约过期，或结果无法安全确认。
- `skipped`：MISFIRE、OVERLAP 或禁用目标，没有调用业务。
- `cancelled`：仅取消未派发意图，或管理员明确放弃 unknown；不表示副作用被撤销。

## 已知边界

- V1 每分钟最多新派发 2 个 Attempt；集中到期会排队到后续 Tick。
- 普通 Service Binding 不固定目标的旧二进制，Action version 向后兼容由业务 Worker 负责。
- 本地 elapsed time 不是 Cloudflare CPU time；远程 p50/p95/p99 仍需受控环境验证。
