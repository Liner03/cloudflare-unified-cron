# Validation Report

后续验证以 [测试执行计划](test-plan.md) 为执行清单；本文只记录已经完成并有证据支持的结果。

日期：2026-09-10。环境：macOS arm64、Node.js 24.19.0、pnpm 11.21.0、Wrangler 4.129.1。

## 聚合结果

```text
CI=true pnpm verify
```

通过以下串行门槛：Prettier、ESLint、全 workspace TypeScript、单元/覆盖率、workerd/D1/RPC 集成、React/Vite build、Wrangler dry-run、Playwright desktop/tablet/mobile E2E。

## 自动化测试

| 层级                            |      结果 | 关键范围                                                                                         |
| ------------------------------- | --------: | ------------------------------------------------------------------------------------------------ |
| Contracts unit                  |  7 passed | RPC identity、retry schema、完整 Registration、unsafe retry 与共享 bounded JSON reader           |
| Worker SDK unit                 | 10 passed | Cron envelope、多版本、独立 Registration client、响应大小/JSON 错误与 credential header          |
| Platform unit                   | 32 passed | Cron/DST、规范化 Registration、retry policy、成功 output、Target check、架构守卫、Node 版本      |
| Platform workerd/D1 integration | 39 passed | 本地认证、规范化 hash、容量 UPSERT/trigger、统一有效状态、Token rotation、reconcile、claim/lease |
| Example Worker RPC integration  |  2 passed | default fetch 保留、命名 Entrypoint、业务 D1 幂等、Attempt 身份重包装                            |
| Playwright E2E                  | 15 passed | 1440/768/390px、本地登录、Token 签发/轮换一次性展示、注册状态、Operator Override、移动导航       |

自动化测试合计 105 项通过。

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

- 示例 Worker dry-run：755.82 KiB，gzip 116.76 KiB。
- 平台 Worker + 28 个 Static Assets dry-run：1313.59 KiB，gzip 227.63 KiB。
- Vite 主入口：530.79 KiB，gzip 164.04 KiB；页面按 route code-split。
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

## 尚未执行

缺少 Cloudflare 账户和生产凭据，因此以下项目没有执行，也未标记为通过：

- 真实自定义域名、生产 `Secure` Cookie、可选 Cloudflare Access 外层与生产管理员 Secret。
- 远程 D1 migration、Time Travel、生产 Target 部署和 Cron 全网传播。
- Cloudflare 生产 CPU p50/p95/p99、wall time、D1 rows read/written 与日额度测量。
- 50 个真实业务 Schedule 的生产类错峰负载和账户其他 Worker 竞争。
- 真实邮件、支付、删除等高副作用 Action；示例只操作测试 D1。

上线前必须按 `docs/deployment.md` 使用非生产 Cloudflare 资源完成 L5 验证，并把结果追加到本报告，不能用本地 elapsed time 替代。
