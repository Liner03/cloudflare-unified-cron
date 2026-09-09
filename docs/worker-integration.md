# 业务 Worker 接入

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

平台通过 `actionVersion` 精确选择。先部署兼容两个版本的 Target，再更新平台 manifest；确认旧 Execution 超出保留与重试窗口后，才可移除旧版本。

## 2. 实现业务幂等

`idempotent: true` 是声明，不会自动提供能力。相同 Execution key 的并发与重复调用必须最多产生一次业务副作用。

可接受方式包括：纯读、收敛写入、同一业务数据库事务中的“唯一键 + 业务变更 + 结果”，或把 key 传给真正支持幂等的上游。

不安全方式是“先查未处理，调用外部 API，再写完成”。中途崩溃会重复外部副作用。

示例 Worker 用自己的 D1 `idempotent_results` 演示结果去重；命中旧业务结果时，SDK 仍用本次 request 的 attemptId 重新包装响应。

## 3. 声明平台白名单

1. 在目标 Worker 部署 `CronEntrypoint`。
2. 在平台 `wrangler.jsonc` 的 `services` 添加 binding、service、entrypoint。
3. 在 `targets.manifest.ts` 添加 Target/Action/version/idempotent。
4. 更新 `seed/targets.sql`，执行显式 manifest sync。
5. 调用控制台 Target check，核对无副作用 `describe()`。
6. 先创建暂停 Schedule，preview 后进行受控 Run now，再启用。

Target id 不得复用于另一物理服务。卸载时先禁用 Target、暂停 Schedule、处理 pending/retry/unknown，再移除 binding。

## 4. 迁移旧 Cron

先完成协议和幂等适配，再显式把旧 Worker 的 `crons` 设置为空数组并部署；仅删除配置属性可能保留旧 Trigger。等待配置传播并确认旧入口停止后，再启用平台 Schedule。
