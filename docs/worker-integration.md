# 业务 Worker 接入

本文为同步 RPC 兼容模式。需要平台只负责可靠触发、网站独立执行时，使用 [Queue 接入指南](queue-worker-integration.md)。多网站的物理配置来源现在是 `apps/platform/targets.json`，通过 `pnpm targets:generate` 生成 bindings 与同步 SQL；不再修改 RPC 适配器。

## 1. 增加命名入口

保留现有 default fetch，只增加 `CronEntrypoint`：

```ts
import { createCronHandler, defineAction } from "@unified-cron/worker-sdk";
import { CronEntrypointBase } from "@unified-cron/worker-sdk/entrypoint";
import { z } from "zod";

const handler = createCronHandler<Env>({
  syncUsers: defineAction({
    version: 1,
    idempotent: true,
    payloadSchema: z.object({ source: z.string().min(1) }),
    async run(payload, context) {
      const result = await syncUsers({
        env: context.env,
        source: payload.source,
        idempotencyKey: context.request.idempotencyKey,
        signal: context.signal,
      });
      return {
        summary: "Users synchronized",
        output: { processed: result.processed },
      };
    },
  }),
});

export class CronEntrypoint extends CronEntrypointBase<Env> {
  cron(input: unknown): Promise<unknown> {
    return handler.cron(input, { env: this.env, ctx: this.ctx });
  }
  describe(): Promise<unknown> {
    return Promise.resolve(handler.describe());
  }
}
```

完整可运行示例位于 `examples/worker-data`。

协议升级时可让同名 Action 的旧、新版本并存：

```ts
const handler = createCronHandler<Env>({
  syncUsers: [
    defineAction({ version: 1, ...syncUsersV1 }),
    defineAction({ version: 2, ...syncUsersV2 }),
  ],
});
```

平台通过 `actionVersion` 精确选择。先部署同时兼容两个版本的 Target，再发布包含新旧版本的 Registration；确认旧 Execution 超出保留与重试窗口后，才可移除旧版本。

## 2. 实现业务幂等

`idempotent: true` 是声明，不会自动提供能力。相同 Execution key 的并发与重复调用必须最多产生一次业务副作用。

可接受方式包括：纯读、收敛写入、同一业务数据库事务中的“唯一键 + 业务变更 + 结果”，或把 key 传给真正支持幂等的上游。

不安全方式是“先查未处理，调用外部 API，再写完成”。中途崩溃会重复外部副作用。

示例 Worker 用自己的 D1 `idempotent_results` 演示结果去重；命中旧业务结果时，SDK 仍用本次 request 的 attemptId 重新包装响应。

## 3. 发布完整 Registration

使用管理员签发并绑定到该 Target 的 Token。平台只保存 SHA-256 哈希；原始值只放在业务 Worker Secret：

```bash
pnpm exec wrangler secret put REGISTRATION_TOKEN
```

声明包含该 Worker 的全部 Action 和 Schedule，而不是增量操作：

```ts
import { createRegistrationClient } from "@unified-cron/worker-sdk/registration";

export function publishRegistration(env: Env) {
  return createRegistrationClient({
    endpoint: env.PLATFORM_REGISTRATION_URL,
    token: env.REGISTRATION_TOKEN,
  }).register({
    protocolVersion: 1,
    registrationRevision: env.BUILD_ID,
    worker: { label: "Billing Worker" },
    actions: [
      {
        name: "syncInvoices",
        version: 1,
        label: "同步发票",
        idempotent: true,
      },
    ],
    schedules: [
      {
        key: "hourly-invoices",
        name: "每小时同步发票",
        action: "syncInvoices",
        actionVersion: 1,
        cronExpression: "5 * * * *",
        timezone: "UTC",
        payload: {},
        retryPolicy: {
          maxAttempts: 3,
          delaysSeconds: [60, 300],
          retryOnUnknown: true,
        },
      },
    ],
  });
}
```

Cloudflare Worker 没有通用的“部署完成”运行时 hook。应从现有的受控部署烟测、私有运维入口或自身已有的可靠生命周期路径调用 `publishRegistration()`；不要在每个普通业务请求中注册。重复发布相同 revision 和内容是 no-op。

删除声明中的 Schedule key 会软退役该计划并保留 Execution 历史。重新加入同 key 会恢复同一逻辑计划，但不会清除管理员的暂停覆盖。

## 4. 声明物理平台白名单

1. 在目标 Worker 部署 `CronEntrypoint`。
2. 在平台 `targets.json` 添加 Target id、label、binding、service、entrypoint 与 protocol version。
3. 运行 `pnpm targets:generate` 生成 bindings 和 `seed/targets.sql`，再运行 Wrangler types；`pnpm targets:check` 检查配置一致性。
4. 执行显式 manifest sync；Queue 模式还需按其指南配置 producer/consumer 和独立签名 Secret。
5. 在控制台签发 Token，由 Worker 发布 Registration。
6. 调用 Target check，核对无副作用 `describe()` 与最新 Registration。
7. 检查声明和下一次时间，等待测试 Schedule 的下一次定时发生并核对结果。

Target id 不得复用于另一物理服务。卸载时先禁用 Target、暂停 Schedule、处理 pending/retry/unknown，再移除 binding。

## 5. 迁移旧 Cron

先完成协议和幂等适配，再显式把旧 Worker 的 `crons` 设置为空数组并部署；仅删除配置属性可能保留旧 Trigger。等待配置传播并确认旧入口停止后，再启用平台 Schedule。
