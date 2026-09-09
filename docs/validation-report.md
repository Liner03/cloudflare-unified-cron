# Validation Report

日期：2026-09-09。环境：macOS arm64、Node.js 24.19.0、pnpm 11.21.0、Wrangler 4.129.1。

## 聚合结果

```text
CI=true pnpm verify
```

通过以下串行门槛：Prettier、ESLint、全 workspace TypeScript、单元/覆盖率、workerd/D1/RPC 集成、React/Vite build、Wrangler dry-run、Playwright desktop/tablet/mobile E2E。

## 自动化测试

| 层级                            |      结果 | 关键范围                                                                                                  |
| ------------------------------- | --------: | --------------------------------------------------------------------------------------------------------- |
| Contracts unit                  |  5 passed | RPC identity、UTF-8 大小、retry schema、完整 Registration 与 unsafe retry 拒绝                            |
| Worker SDK unit                 |  9 passed | Cron envelope、异常语义、多版本、Registration client、错误 envelope 与 credential header                  |
| Platform unit                   | 25 passed | Cron/DST、retry policy、部署 manifest、SQL seam 架构守卫、Node 版本                                       |
| Platform workerd/D1 integration | 27 passed | 本地登录/限流、Session、Token、最大批量 Registration、reconcile/退役/覆盖、成功率、物化/claim/lease/Retry |
| Example Worker RPC integration  |  2 passed | default fetch 保留、命名 Entrypoint、业务 D1 幂等、Attempt 身份重包装                                     |
| Playwright E2E                  | 15 passed | 1440/768/390px、本地登录、一次性 Token、注册状态、Operator Override、Run now、移动导航                    |

自动化测试合计 83 项通过。

核心 domain + CronCalculator V8 覆盖率：

| Statements | Branches | Functions |  Lines |
| ---------: | -------: | --------: | -----: |
|     96.55% |   92.30% |      100% | 98.03% |

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
- 使用 `json_each(?)` 在固定少量 statements 中原子写入 100 个 Action 与 50 个 Schedule。
- 相同 Registration revision 与内容是 no-op；相同 revision 不同内容冲突。
- 缺失 Schedule 软退役；重新加入相同 key 时沿用逻辑身份且保留 Operator Override。
- Registration Token 只存 SHA-256 hash，撤销后立即拒绝机器注册而不影响 Admin Session。
- Retry 同时要求快照与当前同版本 Action 声明幂等。
- `EXPLAIN QUERY PLAN` 使用 `idx_schedules_due` 与 `idx_execution_recent`。

## 本地真实闭环

启动平台和示例 Worker 后，Wrangler 显示：

```text
env.CRON_DATA (worker-data-local#CronEntrypoint) Worker local [connected]
```

请求 `GET /cdn-cgi/local/scheduled` 返回 200 `ok`。先前由 Web Run now 写入的两条 pending Execution 被同一 Tick 领取，经真实命名 Service Binding RPC 执行，并以一条 Attempt 各自落为 succeeded。该检查没有使用公网生产 Worker。

## 构建与路由

- 示例 Worker dry-run：755.01 KiB，gzip 116.60 KiB。
- 平台 Worker + 24 个 Static Assets dry-run：1301.52 KiB，gzip 225.10 KiB。
- Vite 主入口：496.99 KiB，gzip 152.34 KiB；页面按 route code-split。
- `wrangler check startup` 本地 profile：27.3 ms window，12.6 ms active（含 2.5 ms GC）。该值只用于定位本机启动开销，不代表 Cloudflare CPU。
- Static Assets 根路径返回 HTML 200，并带 CSP、X-Frame-Options、nosniff、Referrer 与 Permissions Policy。
- `/api/v1/not-a-route` 返回 JSON 404 和 `Cache-Control: no-store`。
- SPA 深链 `/schedules/deep-link` 在 navigation 请求中返回 index HTML 200。

## UI 证据

- Desktop 1275px 与 Mobile 390px 的最终人工截图写入临时目录，不提交到仓库。
- Playwright 在相同三个精确 viewport 执行并断言运行时尺寸。
- 登录页、Registration 状态条、一次性 Token 对话框和凭据 ledger 均经真实浏览器检查；窄桌面状态列换行问题已修复并复拍。
- Impeccable mechanical detector 对全部本轮 UI 目标返回空 findings。

## 尚未执行

缺少 Cloudflare 账户和生产凭据，因此以下项目没有执行，也未标记为通过：

- 真实自定义域名、生产 `Secure` Cookie、可选 Cloudflare Access 外层与生产管理员 Secret。
- 远程 D1 migration、Time Travel、生产 Target 部署和 Cron 全网传播。
- Cloudflare 生产 CPU p50/p95/p99、wall time、D1 rows read/written 与日额度测量。
- 50 个真实业务 Schedule 的生产类错峰负载和账户其他 Worker 竞争。
- 真实邮件、支付、删除等高副作用 Action；示例只操作测试 D1。

上线前必须按 `docs/deployment.md` 使用非生产 Cloudflare 资源完成 L5 验证，并把结果追加到本报告，不能用本地 elapsed time 替代。
