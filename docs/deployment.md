# 部署手册

## 必填配置

生产配置位于 `apps/platform/wrangler.jsonc`。部署前替换：

- D1 `database_id`。
- 自定义域名 `routes.pattern` 与 `PUBLIC_ORIGIN`。
- Cloudflare Access team domain 和 Application Audience。
- 稳定且永久的 `PLATFORM_INSTANCE_ID` UUID。
- `BUILD_VERSION`。
- 每个目标 Worker 的 service/binding/entrypoint。

示例业务 Worker 的生产 D1 id 和 build id 同样必须替换。Secret 使用 `wrangler secret put`，不得写进 vars、Schedule payload 或浏览器 bundle。

## 首次顺序

1. 创建平台 D1 和业务所需存储。
2. 应用 D1 migrations。
3. 先部署兼容 SDK 的业务 Worker。
4. 配置 Cloudflare Access，保护整个自定义域名。
5. 配置 Service Bindings、Target manifest 和静态资源。
6. 构建 UI，部署平台 Worker。
7. 显式同步 Target 元数据。
8. 验证 Access 登录、JWT、Target describe 和 JSON 404。
9. 创建暂停测试计划，Run now 并确认结果。
10. 最后启用受控生产 Schedule。

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm db:migrate:remote
pnpm targets:sync:remote
pnpm --filter @unified-cron/example-worker-data exec wrangler deploy --config wrangler.jsonc
pnpm --filter @unified-cron/web build
pnpm --filter @unified-cron/platform exec wrangler deploy --config wrangler.jsonc
```

根 `pnpm db:migrate:remote` 会依次调用示例业务 Worker 与平台 Worker 的远程迁移脚本；两个 `wrangler.jsonc` 的 D1 占位值都必须先替换。

生产平台配置只包含一个 `* * * * *` Trigger，并关闭 `workers_dev` 与 preview URLs。Static Assets 对 `/api` 使用 Worker-first；未知 API 路径必须返回 JSON 404，不能被 SPA fallback 吞掉。

## Access

Cloudflare Access 保护 UI 与 API。平台 API 还会验证 `Cf-Access-Jwt-Assertion` 的签名、issuer、audience 和过期时间。生产 `AUTH_MODE` 必须为 `access`；缺少配置时 fail closed。

## 回滚

1. 先在 System 暂停新物化与派发。
2. 确认 D1 schema 与待回滚代码双向兼容。
3. 先保证目标 Worker 仍兼容当前 Action version，再回滚平台。
4. 恢复前检查 unknown、外部副作用和业务幂等保留窗口。

不得用清空 D1 作为发布或回滚策略。D1 Time Travel 恢复可能重新出现已经产生外部副作用的旧意图。

## 当前验证边界

仓库没有真实账户、Access、D1 id、域名或部署凭据。当前只完成本地 workerd、D1、Service Binding 和 Wrangler dry-run；没有宣称远程部署成功或测得 Cloudflare CPU。
