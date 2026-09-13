# 用一个 Cron 接入多个网站

平台只配置一个原生 `* * * * *`。每个网站可以声明多条逻辑规则。业务代码放在网站 Worker；Queue 模式在可靠入队后不再等待网站业务结束。

现有 RPC 接入方式仍可使用，见 [Worker 接入](worker-integration.md)。只有配置 `delivery.mode=queue` 的 Target 使用独立执行模式。

## 配置 Target 与 Queue

在 `apps/platform/targets.json` 中添加网站，示例：

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
    "binding": "QUEUE_SHOP",
    "queue": "shop-cron"
  }
}
```

运行 `pnpm targets:generate` 更新生产配置中的 services、Queue producers 与 `seed/targets.sql`；该命令只改本地配置，不创建或部署远程资源。随后生成 Env 类型、应用 migrations 与 Target sync。`pnpm targets:check` 和 `pnpm verify` 会拒绝 manifest/binding 漂移。生成器拥有配置中的完整 services/producers 列表，额外绑定必须纳入配置来源。

给平台设置独立随机 `TRIGGER_SIGNING_KEY`（至少 32 字符，高熵），用于每次投递的结果回报凭据；不要复用网站密码或 Registration Token。生成器在有 Queue Target 时把该 Secret 加入 required。没有 Queue Target 的现有部署无需此 Secret。

为每个网站创建对应 Queue、配置该网站 Worker 为消费者，并设置重试上限和 Dead Letter Queue。网站越多不意味着原生 Cron 越多。远程创建 Queue/Secret/绑定和部署仍需明确授权；本次本地实现没有自动重建已删除的测试资源。

## 网站执行端

SDK 提供 `createTriggerConsumer` 与 `reportTriggerResult`。消费者固定 `targetId` 和 `queueName`，只处理属于自己网站的消息。`execute(job, env)` 必须按 `job.idempotencyKey` 原子保存业务变更和结果，才能安全处理重复投递。

可运行示例在 `examples/worker-data/src/queue-worker.ts`、`queue-trigger.ts` 和 `wrangler.queue.local.jsonc`。其中 `executeQueueProbe` 把结果和一个模拟业务副作用放在同一个 D1 batch 中；重复投递只返回原结果。真实业务应使用同样的事务边界，或把幂等键传给支持它的上游。

示例 Queue 名按环境选择：本地为 `worker-data-triggers-local`，生产为 `worker-data-triggers`。生产网站应把自己的消费配置和固定 Queue 名一起调整。示例 `publishQueueRegistration(env)` 仅声明幂等 `queueProbe`；旧示例 Registration 包含非幂等 Action，不能直接拿它切换到 Queue 模式。

`queue-worker.ts` 的测试注册端点只接受 test/staging 和独立测试 Secret。生产发布应在网站自己的受保护运维流程调用 `publishQueueRegistration`，不要在普通网页请求里注册。

可复用旧 `scheduled()` 中的业务函数；新消费者调用该函数，但不能简单把会产生不可重复副作用的旧函数包一层就声明幂等。需要串行或不重叠的业务，在网站端持久锁/事务内实现。

结果回报 origin 由网站配置，不从收到的消息读取任意 URL。每条消息携带的回报凭据只用于自己的 Delivery。回报暂时失败会按消费者重试设置再次取缓存结果上报；永久失败进入 DLQ 后可重放缓存结果，不能重做已完成业务。

同一 Cloudflare Account 内，网站 Worker 必须配置指向 Platform 的 `CRON_PLATFORM` Service Binding，并把该 binding 的 `fetch()` 传给 `reportTriggerResult`。不要把公开 `workers.dev` 回调作为默认传输；Service Binding 不经过公网路由，仍由每条消息的专用 `ucrr_` capability 完成应用层授权。

```jsonc
"services": [
  {
    "binding": "CRON_PLATFORM",
    "service": "unified-cron-platform"
  }
]
```

```ts
reportTriggerResult(origin, job, result, (input, init) =>
  env.CRON_PLATFORM.fetch(input, init),
);
```

## 调度容量与运行状态

控制台“调度设置 → 触发容量”可调整规则数、物化预算、Queue 投递预算、RPC 次数/并发以及单站批量。配置以 D1 为准，更新使用 If-Match 与 Idempotency-Key。默认 100 条规则不等于免费承诺每分钟执行 100 次。

Queue 记录在“触发记录”查看，最近 1000 条加完整状态数量汇总；Schedule 详情有对应链接。状态区分等待投递、正在投递、投递结果未知、已入队、已跳过；业务结果另列，未上报保持未上报。旧“执行记录”和成功率仍针对同步 RPC Execution，不能把 Queue 入队数计为业务成功。

停用/暂停阻止未来 claim，不能撤回已发送消息。要停止消费，需另行暂停网站 Queue consumer 并清点在途消息。投递 unknown 会保留并重投，同一 key 的副作用去重由网站保障；不会因上一轮业务未上报而阻塞下一分钟触发。

## 迁移 Cloudflare Cron 表达式

在 Registration 的 Schedule 或 `/api/v1/cron/preview` 中显式指定 `cronDialect: "cloudflare"`。平台将数字星期 `1..7`（Sunday..Saturday）转换为 Unix `0..6`，也转换 JAN..DEC、SUN..SAT 名称。存入 D1 的是转换后的 Unix 表达式。

未指定方言时保持原 Unix 行为。L/W/#/? 等未支持扩展以及同时限定日和星期的表达式会明确拒绝；先改写并通过未来执行时间预览核对，不能静默解释成另一日期。

先在停用的逻辑规则上验证接入和时间预览，再由网站部署流程显式清空旧 `triggers.crons`，等待原生配置传播并确认停止，最后启用平台规则。切换期间使用一致的业务 occurrence 幂等标识或明确切换时间，避免旧/新入口双重业务执行。

## 本地与远程验证边界

本地多 Worker/Queue/D1 集成测试与 100 规则矩阵见 [本轮测试记录](test-runs/2026-09-12-local.md)。Remote Free CPU、Queue quota、100 个不同 Worker 和 100/min 持续吞吐未由本地测试证明。生产使用前按 [唯一测试计划](test-plan.md) 安排经授权的 Staging 复测。
