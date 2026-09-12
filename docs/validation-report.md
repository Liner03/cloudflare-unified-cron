# Validation Report

## 最新：2026-09-12 Queue 架构 Staging 联调

部署提交：`8941a6d1f9dcc1b81fc1e9d2ef1a7a64fe7219b9`。在已确认的独立测试账号中创建并部署一个 Platform Worker、三个真实 Test Target Worker、两个专用 D1、三组 Queue/DLQ、对应 Service Bindings，以及唯一一个原生 `* * * * *` Cron Trigger。全部资源使用 `unified-cron-*` 名称；未读取或修改其他项目资源。

已验证通过：三个网站 Worker 的独立 Queue consumer、真实 Registration 与 Token 轮换、Service Binding `describe()` 兼容检查、管理员登录/Session/Origin、Static Assets、`/llms.txt`、JSON API 404、请求边界、Cookie 安全属性以及 D1/公开内容无原始凭据。10 条分钟规则已按 4/3/3 分布到三个真实 Worker，平台已安全暂停且无在途 Delivery/Execution。

关键失败：Cloudflare API 确认 `unified-cron-platform-test` 上确实保存了一条 `* * * * *` Trigger（创建于 `2026-09-12T10:07:20Z`，重应用于 `13:16:06Z`），但截至 `13:46:33Z`，Platform D1 的 `last_tick_*` 和 `build_version` 仍全部为空，Delivery 为 0。等待已超过 Cloudflare 文档所述最长 15 分钟传播窗口。Wrangler OAuth 可以只读确认 Schedule，但缺少 Workers Observability 权限，无法取得持久化 invocation trace；未登录的 Dashboard 浏览器没有切换到其他账号。

因此当前不能声明“完全代替 Cloudflare Trigger”或 Free 下 10/25/50/100 已通过。`R3-002` 为 FAIL，`R3-003..009` 与 `R7-009..012` 受其阻塞；25/50/100 档未继续制造流量。资源目前保留且全局派发暂停，若底层 Trigger 延迟恢复，不会继续入队测试任务。逐项证据见 [2026-09-12 Staging 记录](test-runs/2026-09-12-staging.md)。

## 最新：2026-09-12 触发架构修复（本地）

实现提交：`abee082a8990afdea90f4f7878e8fb5fefbef48f`。`pnpm verify` 在固定提交上退出码 0：Contracts 18、SDK 11、Platform unit 34、Platform integration 66、网站 Worker integration 11、E2E 39，合计 179 项。

多 Target 绑定、100 条规则注册/列表/批量投递、可配置预算、独立 Queue 消费者、投递/业务结果分离、专用结果回报凭据、Cloudflare Cron 方言转换与 UI 已在本地完成验证。完整 Tick 的 35 秒网站业务用例证明：平台先完成投递，其他网站照常执行，慢网站随后完成。100 条大 payload 的 D1/Queue 分批边界与混合 RPC/Queue 总预算也通过。

证据：[2026-09-12 本地记录](test-runs/2026-09-12-local.md)；架构：[ADR 0003](adr/0003-independent-trigger-delivery.md)；接入：[Queue 指南](queue-worker-integration.md)。

当前仓库保留已有 DATA 的 RPC 模式；需要网站独立执行时显式配置 Queue Target。新模式已经部署到隔离 Staging，但因本轮原生 Cron 未产生 Tick，`R7-009`..`R7-012` 未通过；不能据本地测试声称 100/min 在 Free 上已验证。此前旧 Staging 证据仍不得沿用。

以下为 2026-09-11 旧同步 RPC 版本的历史验证结果，不能沿用为新架构的远程 PASS。

后续验证以 [测试执行计划](test-plan.md) 为执行清单；本文只记录已经完成并有证据支持的结果。

日期：2026-09-11。环境：macOS arm64、Node.js 24.19.0、pnpm 11.21.0、Wrangler 4.129.1；本地与隔离 Cloudflare Staging。

## 聚合结果

```text
CI=true pnpm verify
```

通过以下串行门槛：Prettier、ESLint、全 workspace TypeScript、单元/覆盖率、workerd/D1/RPC 集成、React/Vite build、Wrangler dry-run、Playwright desktop/tablet/mobile E2E。

## 自动化测试

| 层级                            |      结果 | 关键范围                                                                                     |
| ------------------------------- | --------: | -------------------------------------------------------------------------------------------- |
| Contracts unit                  |  7 passed | RPC identity、retry schema、完整 Registration、unsafe retry 与共享 bounded JSON reader       |
| Worker SDK unit                 | 11 passed | Cron envelope、Registration client、每次有意发布独立 key、响应边界与 credential header       |
| Platform unit                   | 34 passed | Cron/DST、规范化 Registration、retry policy、Target check、架构守卫、认证与 Node 版本        |
| Platform workerd/D1 integration | 49 passed | 认证、Registration/Token mutation 幂等、容量、事务、override、reconcile、claim/lease、成功率 |
| Example Worker RPC integration  |  9 passed | 十种确定性模式、命名 Entrypoint、业务 D1 幂等、Attempt identity、受保护控制 API              |
| Playwright E2E                  | 33 passed | 1440/768/390px 登录、Token、注册状态、Operator Override、错误恢复、导航与响应式布局          |

自动化测试合计 143 项通过。最终修复后的 `pnpm verify` 从头到尾退出码为 0。

核心 domain + CronCalculator V8 覆盖率：

| Statements | Branches | Functions |  Lines |
| ---------: | -------: | --------: | -----: |
|     94.93% |   90.38% |      100% | 95.83% |

## D1 与一致性证据

真实本地 D1 测试覆盖：

- 20 个相同物化竞争者只创建一个 cron occurrence。
- 20 个并发 claim 只有一个 lease token、一个 Attempt。
- 物化第二条 SQL 故障时 Execution 与 `next_run_at` 一起回滚。
- Attempt 插入故障时 running、attempt_count 与 lease 一起回滚。
- finalize 后重复提交旧 lease 返回 false，不覆盖终态。
- 过期 lease 在 `retryOnUnknown=false` 时保守进入 unknown。
- 三次自动尝试按 60/300 秒最早时间领取，第三次耗尽后停止。
- 所有 skipped 在物化时写入 `finished_at`；清理也兼容早期缺失该字段的 skipped 记录，并始终保留 unknown。
- 使用 `json_each(?)` 在固定少量 statements 中原子写入 100 个 Action 与 50 个 Schedule；容量已满时更新现有 key 仍成功并正确推进 revision。
- 相同 Registration revision 与内容是 no-op；相同 revision 不同内容冲突。
- 递归交换 payload object keys、Action 顺序或 Schedule 顺序不改变 Registration hash；语义相同的新 revision 不推进 Schedule revision 或 `next_run_at`。
- 历史 revision/hash 永久保留；完全相同的历史声明可回滚，换内容复用旧 revision 被拒绝。
- 缺失 Schedule 软退役；重新加入相同 key 时沿用逻辑身份且保留 Operator Override。
- Registration Token 只存 SHA-256 hash，撤销后立即拒绝机器注册而不影响 Admin Session。
- Token rotation 原子撤销旧值并签发替换值；并发轮换只有一个成功。
- 49 个其他 Target Schedule 加 1 个注册 Schedule 可达到全局上限；第 51 个同时受应用预检、reconcile guard 和 D1 trigger 拒绝。
- Schedule Operator Override 会阻止既有 intent 的领取，Schedule 不提供 Run now。
- Retry 同时要求快照与当前同版本 Action 声明幂等。
- 已排队 Retry 若在领取前失去当前幂等声明，会以 `RETRY_IDEMPOTENCY_REVOKED` 终止且不进入 RPC；成功响应的 bounded `output` 会与 summary 一同持久化。
- Schedule list/detail 返回声明、管理员、无效配置、Target 与全局派发的完整 blocker；系统配置禁用、筛选和 Overview active 计数均读取同一 D1 投影。
- `EXPLAIN QUERY PLAN` 使用 `idx_schedules_due` 与 `idx_execution_recent`。

## 本地真实闭环

启动平台和示例 Worker 后，Wrangler 显示：

```text
env.CRON_DATA (worker-data-local#CronEntrypoint) Worker local [connected]
```

示例 Worker 集成测试通过真实命名 Entrypoint 调用验证业务 D1 幂等与 Attempt 身份重包装；平台物化、claim、暂停覆盖和结果 finalize 通过本地 workerd/D1 集成测试验证。检查没有使用公网生产 Worker。

## 构建与路由

- 示例 Worker dry-run：767.19 KiB，gzip 119.21 KiB。
- 平台 Worker + 32 个 Static Assets dry-run：1326.68 KiB，gzip 229.92 KiB。
- Vite 主入口：533.71 KiB，gzip 164.98 KiB；页面按 route code-split。
- `wrangler check startup` 本地 profile：27.3 ms window，12.6 ms active（含 2.5 ms GC）。该值只用于定位本机启动开销，不代表 Cloudflare CPU。
- Static Assets 根路径返回 HTML 200，并带 CSP、X-Frame-Options、nosniff、Referrer 与 Permissions Policy。
- `/api/v1/not-a-route` 返回 JSON 404 和 `Cache-Control: no-store`。
- SPA 深链 `/schedules/deep-link` 在 navigation 请求中返回 index HTML 200。

## UI 证据

- 业务总览按批准 comp 在 1536×1024 完成 hero reproduction，并复核 1440×900、768×1024、390×844 与用户 1513×827 视口。
- Playwright 在 desktop、tablet、mobile 三个精确 viewport 执行；900px 导航断点、菜单焦点恢复、Token、Operator Override 与平台状态均通过。
- 登录、网站目录、网站/Cron 树、24 小时运行信号、异常入口、Registration Token 与深色模式均经真实浏览器检查。
- Impeccable mechanical detector 因本机缺少 HTML parser 模块降级为 regex 扫描；fallback 返回空 findings，但未被当作完整通过。独立 finish reviewer 对其 7 项 material fixes 全部判定 resolved，最终 disposition 为 `ship`。
- Asset producer 确认 `produce` 为空：实时信号与树保持 SVG/CSS/语义 HTML，不引入运行时 raster。

## Staging 结果

- 仅创建并操作两个批准的 Worker 与两个专用 D1；使用受限 workers.dev、Free plan、一个真实分钟 Cron 和一个 `CRON_DATA` Service Binding。未接触生产资源。
- L0、L1、L2、R0、R1、R2、R3、R4、R5、R6、R8 均完成。R7 有七项 PASS；`R7-005` 仅 cold-start 显式字段由用户批准 SKIPPED，其余观测证据完整。
- 60 分钟真实 Cron Soak 跨 UTC 整点：59 个正常执行分钟全部 succeeded，计划内暂停分钟由独立真实 Tick 证据补齐；无重复 occurrence、重复业务副作用或 stuck 状态。
- API external wall p50/p95/p99 为 273/367/735 ms；Tick Worker wall 为 3201/3920/4718 ms；RPC Attempt wall 为 1452/1724/1938 ms。客户端 wall time 未冒充 Cloudflare CPU time。
- Cloudflare real-time tail 的两个 Cron invocation 为 CPU 12/11 ms、wall 3252/3474 ms、outcome=ok。Dashboard 所选测试 Worker 显示 1,602 Success、0 Errors。
- Platform D1 最近 1 天 top-100 query shapes 合计 10,606 次、116,812 rows read、7,898 rows written；Target D1 17 shapes、758 次、546 rows read、903 rows written。
- 回滚演练：当前代码之前的 Worker 版本 `ea146073-…`（代码 `fc8556c…`）与现有 schema 双向兼容；回滚后真实成功路径通过；当前 Platform 代码 `c900b39…` 已恢复并再次通过真实 Cron。

## Commit / build 对照

| 范围                                    | Git commit                                 | Cloudflare Worker version              |
| --------------------------------------- | ------------------------------------------ | -------------------------------------- |
| Platform 最后部署测试代码（资源已删除） | `c900b39d2dec386a6843010a0ec76c8b1ee2a864` | `ec06cce9-6ee5-4be3-918a-2c35ac38d7fc` |
| Platform 回滚候选                       | `fc8556cbac3855127191630f8d4d27af86948a1a` | `ea146073-29cd-4bed-98aa-b446d98f932b` |
| Test Target 最后部署代码（资源已删除）  | `df47924e6e2e1bed1c7297b7c20e40f565815661` | `15884179-1d74-41b7-83a2-710a943f71f5` |

完整逐项证据见 [`docs/test-runs/2026-09-10-local.md`](test-runs/2026-09-10-local.md) 与 [`docs/test-runs/2026-09-11-staging.md`](test-runs/2026-09-11-staging.md)。

## 证据索引

- 本地逐项记录：[`docs/test-runs/2026-09-10-local.md`](test-runs/2026-09-10-local.md)。
- Staging 逐项记录、失败保留、Correlation 与部署版本：[`docs/test-runs/2026-09-11-staging.md`](test-runs/2026-09-11-staging.md)。
- Soak 监视摘要：[`docs/test-runs/2026-09-11-soak.ndjson`](test-runs/2026-09-11-soak.ndjson)。
- Cloudflare 日志证据：Platform `api_request`、`tick_dispatch_started`、`tick_dispatch_finished`；Target build 与 receipt 通过逐项报告中的 executionId/attemptId 关联。完整请求头和凭据未保存。
- D1 证据：仅对 `unified-cron-platform-test-db` 与 `unified-cron-test-target-db` 执行命名的只读聚合；Account ID 与 D1 ID 未写入报告。

## 最终状态

- `R7-005`：D1 query/row、CPU、wall、outcome 与错误率已有证据；当前 Wrangler OAuth 对 Observability API 返回 403，Dashboard 首个新版本 invocation 未暴露可选 `coldStart` 字段。用户明确批准仅将该子检查标记为 SKIPPED。
- `R8-007`：全部有效测试 Registration Token 已撤销；Target 的 Registration 与控制 Secret 已删除，旧凭据分别返回 401/503。
- `R8-008`、`R8-009`：用户批准后永久删除两个测试 Worker 和两个测试 D1；两个原 workers.dev 地址返回 404，两个 D1 精确名称查询均不存在。本地忽略的 Staging Secret/config 文件已删除。
- 生产环境始终不在本轮测试范围内；没有执行生产 D1、路由、Worker 或真实业务副作用测试。
- 最终结果：P0=0，P1=0；所有必需项目均 PASS 或具有用户批准的明确 SKIPPED 理由。
