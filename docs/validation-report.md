# Validation Report

日期：2026-09-08。环境：macOS arm64、Node.js 24.19.0、pnpm 11.21.0、Wrangler 4.129.1。

## 聚合结果

```text
CI=true pnpm verify
```

通过以下串行门槛：Prettier、ESLint、全 workspace TypeScript、单元/覆盖率、workerd/D1/RPC 集成、React/Vite build、Wrangler dry-run、Playwright desktop/tablet/mobile E2E。

## 自动化测试

| 层级                            |      结果 | 关键范围                                                                                                   |
| ------------------------------- | --------: | ---------------------------------------------------------------------------------------------------------- |
| Contracts unit                  |  3 passed | RPC request/result identity、UTF-8 大小、retry schema                                                      |
| Worker SDK unit                 |  7 passed | success envelope、显式/非法 CronError code、超限 payload envelope、未知异常、多 Action 版本与重复声明保护  |
| Platform unit                   | 24 passed | Cron 子集、Unix weekday、闰日/31 日、DST、输入边界、retry policy、部署 manifest/路径/远程迁移、Node 版本   |
| Access JWT unit                 |  5 passed | 本地签名的有效、过期、错误 issuer/AUD 与缺失可信 actor                                                     |
| Platform workerd/D1 integration | 20 passed | migration、并发物化/claim、Run-now revision CAS、暂停期 cleanup、lease、overlap、Retry 保护、API 幂等/CAS  |
| Production auth integration     |  2 passed | 缺失和伪造 Access assertion 均 fail closed                                                                 |
| Example Worker RPC integration  |  2 passed | default fetch 保留、命名 Entrypoint、业务 D1 幂等、Attempt 身份重包装                                      |
| Playwright E2E                  | 15 passed | 1440/768/390px、抽屉焦点、实体状态分域、心跳/派发并显、Action 多版本与 payload 编辑保护、Schedule/RPC 闭环 |

自动化测试合计 78 项通过。

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
- 创建 SQL 在事务内重新检查 50 Schedule 上限；并发请求和过期 precheck 均不能突破限制。
- Retry 同时要求快照与当前同版本 Action 声明幂等。
- `EXPLAIN QUERY PLAN` 使用 `idx_schedules_due` 与 `idx_execution_recent`。

## 本地真实闭环

启动平台和示例 Worker 后，Wrangler 显示：

```text
env.CRON_DATA (worker-data-local#CronEntrypoint) Worker local [connected]
```

请求 `GET /cdn-cgi/local/scheduled` 返回 200 `ok`。先前由 Web Run now 写入的两条 pending Execution 被同一 Tick 领取，经真实命名 Service Binding RPC 执行，并以一条 Attempt 各自落为 succeeded。该检查没有使用公网生产 Worker。

## 构建与路由

- 示例 Worker dry-run：744.09 KiB，gzip 114.01 KiB。
- 平台 Worker + 30 个 Static Assets dry-run：1292.24 KiB，gzip 226.74 KiB。
- Vite 主入口：388.01 KiB，gzip 122.05 KiB；页面按 route code-split。
- `wrangler check startup` 本地 profile：27.3 ms window，12.6 ms active（含 2.5 ms GC）。该值只用于定位本机启动开销，不代表 Cloudflare CPU。
- Static Assets 根路径返回 HTML 200，并带 CSP、X-Frame-Options、nosniff、Referrer 与 Permissions Policy。
- `/api/v1/not-a-route` 返回 JSON 404 和 `Cache-Control: no-store`。
- SPA 深链 `/schedules/deep-link` 在 navigation 请求中返回 index HTML 200。

## UI 证据

- Desktop 1440px、Tablet 768px、Mobile 390px 的人工截图保存在本地 `.impeccable/review/`，不提交到仓库。
- Playwright 在相同三个精确 viewport 执行并断言运行时尺寸。
- 测量结果：三端无横向溢出；H1 桌面 2 行、平板 2 行、移动 2 行；平板与移动均没有 pin/scrub 产物，移动菜单和主题按钮均为 44×44px。
- 主 CTA 对比度 5.08:1。
- Impeccable 独立 finish review：初次 `fix` 的 8 项全部 resolved，最终 disposition `ship`。

## 尚未执行

缺少 Cloudflare 账户和生产凭据，因此以下项目没有执行，也未标记为通过：

- 真实自定义域名、Cloudflare Access policy 与 Access 登录签发 JWT 的端到端链路；签名、有效期、issuer 和 audience 的本地密码学路径已经覆盖。
- 远程 D1 migration、Time Travel、生产 Target 部署和 Cron 全网传播。
- Cloudflare 生产 CPU p50/p95/p99、wall time、D1 rows read/written 与日额度测量。
- 50 个真实业务 Schedule 的生产类错峰负载和账户其他 Worker 竞争。
- 真实邮件、支付、删除等高副作用 Action；示例只操作测试 D1。

上线前必须按 `docs/deployment.md` 使用非生产 Cloudflare 资源完成 L5 验证，并把结果追加到本报告，不能用本地 elapsed time 替代。
