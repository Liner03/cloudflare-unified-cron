# 用一个 Cron 接入多个网站

平台只配置一个原生 `* * * * *` 和一个共享 Dispatch Queue。每个网站可以声明多条逻辑规则；业务仍在网站 Worker 的 `CronEntrypoint.cron()` 中执行。

```text
Cloudflare Cron
  -> Platform scheduled()：查 D1、物化 occurrence、写入共享 Queue
  -> Platform queue()：每条消息独立调用目标 Service Binding
  -> Website CronEntrypoint.cron()：幂等提交业务
  -> Platform D1：记录业务结果
```

Queue consumer 的 `max_batch_size` 固定为 `1`。一个慢网站只占用自己的 consumer invocation，不会让同一批次中的其他网站等待。Cron invocation 在可靠入队后结束，网站业务不占用 Cron 的生命周期。

## 配置 Target

在 `apps/platform/targets.json` 中添加网站。所有 Queue Target 共用相同的 `DISPATCH_QUEUE`：

```json
{
  "id": "SHOP",
  "label": "Shop",
  "binding": "CRON_SHOP",
  "service": "shop-worker",
  "entrypoint": "CronEntrypoint",
  "protocolVersion": 1,
  "manifestRevision": "shop-v1",
  "delivery": {
    "mode": "queue",
    "binding": "DISPATCH_QUEUE",
    "queue": "unified-cron-dispatch"
  }
}
```

运行 `pnpm targets:generate` 会：

- 为每个网站生成一个 allowlisted Service Binding；
- 只生成一个去重后的 Queue producer；
- 同步 `seed/targets.sql`；
- 拒绝多个不同 Dispatch Queue 混入同一部署。

Platform 的 Wrangler 配置同时把同一 Queue 配为 producer 和 consumer：

```jsonc
"queues": {
  "producers": [
    { "binding": "DISPATCH_QUEUE", "queue": "unified-cron-dispatch" }
  ],
  "consumers": [
    {
      "queue": "unified-cron-dispatch",
      "dead_letter_queue": "unified-cron-dispatch-dlq",
      "max_batch_size": 1,
      "max_batch_timeout": 1,
      "max_retries": 3
    }
  ]
}
```

## 网站执行端

网站只需实现仓库 SDK 的 `CronEntrypoint.describe()` 与 `cron()`。它不需要：

- 自己的 Queue 或 DLQ；
- 指向 Platform 的反向 Service Binding；
- 公开结果回调 URL；
- 每条逻辑规则一个 Cloudflare Cron Trigger。

Platform consumer 会把 Queue message 转成 `CronRequestV1`。`executionId` 等于 Delivery ID；每次基础设施重试生成新的 `attemptId`，但 `idempotencyKey` 保持不变。网站必须按该 key 原子保存业务副作用和结果，重试时返回已保存结果并包装当前 Attempt identity。

显式业务失败会记录为 failed 并确认 Queue message；抛出异常、RPC 中断或结果协议错误会重试相同 Delivery。安全日志只记录脱敏后的错误摘要，不记录 Queue message、Registration Token 或 `ucrr_` capability。

旧的“网站直接消费专属 Queue”SDK 仍保留用于兼容，但不再是默认部署架构。

## 暂停与积压

Platform pause 阻止后续物化和派发。已被共享 Queue 接受的消息不能假装撤销；consumer 仍会完成它们。Schedule 暂停或退役会阻止尚未 claim 的 Delivery，恢复后可继续清空同一 occurrence，不会生成新的幂等键。

要做无新增 occurrence 的积压演练，可把相同 Schedule key 更新到未来 Cron，再恢复 Platform：旧 pending Delivery 会继续，未来规则不会立即到期。

## 免费版换算成人话

Cloudflare Queues Free 每天包含 10,000 次操作。正常完成一条任务通常消耗 3 次：写入、读取、确认删除。

因此免费额度大约等于：

- 每天约 `3,333` 次网站任务；
- 平均每小时约 `138` 次；
- 长期平均每分钟约 `2.3` 次。

这不是说每分钟最多只能触发 2 个。短时间同一分钟触发 100 个已经通过；只是如果每分钟都持续 100 个，一天约 144,000 个任务、432,000 次 Queue 操作，会超过免费额度约 43 倍。

100 条逻辑规则本身没有问题。例如 100 条“每天一次”的规则只有约 300 次 Queue 操作/天。真正消耗额度的是实际触发次数，不是规则数量。

Workers Free 还限制每个 Account 最多 100 个 Worker。Platform 自己占一个，因此“Platform + 100 个独立网站 Worker”无法全部放进同一个 Free Account；现有其他 Worker 也会占名额。

## 验证边界

真实 Cloudflare 10/25/50/100 同分钟矩阵、D1/Queue 用量和缺陷证据见 `docs/test-runs/2026-09-13-staging.md`。共享 Queue 重构必须重新执行本地完整门禁和远程三网站矩阵，不能沿用专属 Queue 的 PASS。
