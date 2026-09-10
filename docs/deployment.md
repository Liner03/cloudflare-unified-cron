# 部署手册

## 必填配置

生产配置位于 `apps/platform/wrangler.jsonc`。部署前替换：

- D1 `database_id`。
- 自定义域名 `routes.pattern` 与 `PUBLIC_ORIGIN`。
- 本地管理员用户名 `ADMIN_USERNAME`。
- 稳定且永久的 `PLATFORM_INSTANCE_ID` UUID。
- `BUILD_VERSION`。
- 每个目标 Worker 的 service/binding/entrypoint。

示例业务 Worker 的生产 D1 id 和 build id 同样必须替换。Secret 使用 `wrangler secret put`，不得写进 vars、Schedule payload 或浏览器 bundle。

## 首次顺序

1. 创建平台 D1 和业务所需存储。
2. 应用 D1 migrations。
3. 先部署兼容 SDK 且能发布 Registration 的业务 Worker。
4. 生成管理员密码哈希，并把 `ADMIN_PASSWORD_HASH` 写为平台 Worker Secret。
5. 配置 Service Bindings、Target manifest 和静态资源。
6. 构建 UI，部署平台 Worker。
7. 显式同步 Target 元数据。
8. 验证本地管理员登录、Target describe 和 JSON 404。
9. 在控制台为物理 Target 签发 Registration Token，将其写为对应业务 Worker Secret。
10. 由业务 Worker 发布完整 Registration，检查 Action、Schedule 和成功率样本。
11. 等待测试 Schedule 的下一次定时发生并确认结果。

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm db:migrate:remote
pnpm targets:sync:remote
pnpm --filter @unified-cron/example-worker-data exec wrangler deploy --config wrangler.jsonc
pnpm --filter @unified-cron/platform auth:hash-password
pnpm --filter @unified-cron/platform exec wrangler secret put ADMIN_PASSWORD_HASH --config wrangler.jsonc
pnpm --filter @unified-cron/web build
pnpm --filter @unified-cron/platform exec wrangler deploy --config wrangler.jsonc
```

根 `pnpm db:migrate:remote` 会依次调用示例业务 Worker 与平台 Worker 的远程迁移脚本；两个 `wrangler.jsonc` 的 D1 占位值都必须先替换。

生产平台配置只包含一个 `* * * * *` Trigger，并关闭 `workers_dev` 与 preview URLs。Static Assets 对 `/api` 使用 Worker-first；未知 API 路径必须返回 JSON 404，不能被 SPA fallback 吞掉。

为每个业务 Worker 设置控制台一次性显示的 Token：

```bash
pnpm --filter @unified-cron/example-worker-data exec wrangler secret put REGISTRATION_TOKEN --config wrangler.jsonc
```

Secret 使用 Wrangler 的交互式提示输入；不要作为命令参数、shell history 或 CI 日志传递。

## 认证边界

平台应用认证始终由本地管理员账号负责。登录产生随机、HttpOnly、SameSite=Strict 的 D1 Session；生产 Cookie 使用 `Secure` 与 `__Host-` 前缀。登录失败按来源进行持久化限流。

Cloudflare Access 可以作为自定义域名的可选外层保护，但不替代应用 Session，也不向 Registration Token 授予管理员权限。机器 Token 只拥有 `registration:write`，在服务端绑定一个预授权 Target，原始值不会落库。

## 回滚

1. 先在 System 暂停新物化与派发。
2. 确认 D1 schema 与待回滚代码双向兼容。
3. 先保证目标 Worker 仍兼容当前 Action version，再回滚平台。
4. 恢复前检查 unknown、外部副作用和业务幂等保留窗口。

不得用清空 D1 作为发布或回滚策略。D1 Time Travel 恢复可能重新出现已经产生外部副作用的旧意图。

## 当前验证边界

仓库没有真实账户、Access、D1 id、域名或部署凭据。当前只完成本地 workerd、D1、Service Binding 和 Wrangler dry-run；没有宣称远程部署成功或测得 Cloudflare CPU。
