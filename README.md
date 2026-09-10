# Cloudflare Unified Cron Platform

一个部署在单个 Cloudflare Account 内的统一 Cron 控制平台：用一个原生分钟级 Cron Trigger，从 D1 物化逻辑 Schedule，通过 Service Binding RPC 调用独立业务 Worker，并持久化 Execution、Attempt、有限重试与人工审计。

本仓库实现架构规格 V1。它不是通用 Job Queue，也不依赖 KV、Queues、Durable Objects、Workflows、Redis 或跨账号 HTTP。

## 架构边界

```text
Cloudflare Cron (* * * * *)
        │
        ▼
Platform Worker ── D1（计划、执行、租约、重试、审计）
        │
        └── Service Binding RPC ──► 业务 Worker / CronEntrypoint

Registrant Worker ── scoped token ──► PUT /api/v1/registration
Administrator ── local session ──► React SPA + operator API
```

平台只在 `scheduled()` 中派发。Web 的 Retry 和 Run again 先把意图写入 D1，并返回 202；它们不会在浏览器请求中直接调用业务 Worker。Schedule 本身没有人工 Run now 入口。

## 本地运行

要求 Node.js 24+、pnpm 11.21.0。

```bash
pnpm install --frozen-lockfile
cp apps/platform/.dev.vars.example apps/platform/.dev.vars
pnpm --filter @unified-cron/platform auth:hash-password
# 将输出写入 apps/platform/.dev.vars 的 ADMIN_PASSWORD_HASH
pnpm db:migrate:local
pnpm seed:local
# 可选：写入 8 个 Cron 与多种 Execution 状态，用于查看完整 UI
pnpm seed:demo:local
pnpm dev
```

`seed:demo:local` 只写入本地 D1 中以 `demo-` 开头的确定性演示记录，不属于 migration 或生产部署流程。它保留单一真实白名单 Target `DATA`，但覆盖成功、失败、结果未知、自动重试等待、管理员暂停、声明停用、配置失效和无运行历史等界面状态。

登录用户名默认为 `admin`，密码只以 PBKDF2-SHA256 哈希保存在本地
`.dev.vars` 或生产 Worker Secret 中。仓库不包含可用的默认管理员密码。

本地地址：

- 控制台：`http://127.0.0.1:5173`（本地开发也接受 `http://localhost:5173`）
- 平台 Worker：`http://127.0.0.1:8787`
- 示例业务 Worker：`http://127.0.0.1:8788`

触发一次本地 scheduled event：

```bash
curl http://127.0.0.1:8787/cdn-cgi/local/scheduled
```

Wrangler 4.129.1 同时兼容 `/__scheduled`，但项目文档与测试以 `/cdn-cgi/local/scheduled` 为准。

## 常用命令

```text
pnpm dev                  Vite + 平台 Worker + 示例 Worker
pnpm db:migrate:local     迁移示例业务 D1 与平台 D1
pnpm seed:local           幂等写入示例物理 Target（不创建可见 Schedule）
pnpm targets:sync:local   只同步部署 Target 元数据
pnpm lint                 ESLint，包括 no-floating-promises
pnpm typecheck            全 workspace TypeScript strict
pnpm test:unit            协议、SDK、Cron、状态/重试策略
pnpm test:integration     workerd + 真实 D1 + 命名 RPC
pnpm test:e2e             Chromium 桌面、平板与移动真实 API 闭环
pnpm build                UI 构建与两个 Worker dry-run bundle
pnpm deploy:dry-run       显式 Static Assets/绑定 dry run
pnpm verify               CI 聚合检查
```

远程迁移和 Target 同步使用独立命令，永远不会藏在 `test` 或 `dev` 中：

```bash
pnpm db:migrate:remote
pnpm targets:sync:remote
```

执行前必须先替换 `apps/platform/wrangler.jsonc` 与 `examples/worker-data/wrangler.jsonc` 中的占位值。根远程迁移命令会先应用示例业务 D1，再应用平台 D1。

## Workspace

- `apps/platform`：Hono API、D1 repository、Tick、RPC、本地管理员认证与注册接口。
- `apps/web`：React/shadcn 控制台，TanStack Query/Table 与 React Hook Form。
- `packages/contracts`：V1 JSON 协议与运行时 schema。
- `packages/worker-sdk`：Action allowlist、Registration client、deadline、错误分类与命名 Entrypoint 基类。
- `examples/worker-data`：保留原 fetch 的示例业务 Worker，以及业务侧持久化幂等。
- `tests/e2e`：Playwright 桌面和移动闭环。
- `docs`：协议、Cron 语义、部署、运维与验证证据。

## 可靠性说明

- D1 是平台控制状态的唯一真相来源；D1 不可用时停止新派发。
- 物化与 `next_run_at` 前移同批提交；claim 与 Attempt 创建同批提交。
- finalize 必须匹配当前 lease token；迟到响应不能覆盖新 Attempt。
- RPC 与外部副作用不在 D1 事务内，所以平台不承诺 exactly-once。
- 超时、连接中断和结果落库失败都可能表示 `unknown`，默认不自动重试。
- 业务 Worker 必须用稳定 `idempotencyKey` 实现真正的业务幂等。

更多信息见 [架构实现说明](docs/architecture.md)、[Worker 接入](docs/worker-integration.md) 与 [部署手册](docs/deployment.md)。
