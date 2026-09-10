# RPC 协议

协议版本固定为 V1。共享 TypeScript 类型和 Zod schema 位于 `packages/contracts`。

## 请求

业务 Worker 的命名入口实现：

```ts
cron(input: unknown): Promise<unknown>
```

SDK 验证后得到 `CronRequestV1`：

- `executionId`：稳定业务执行身份。
- `attemptId`：每次调用的新身份。
- `idempotencyKey`：`ucp:v1:<platformInstanceId>:<executionId>`；Retry 不变化。
- `source`：原始来源 `cron/manual/rerun`，重试时不改变；`manual` 只用于迁移前历史记录，新系统不再创建。
- `dispatchReason`：`initial/automatic_retry/operator_retry`。
- `scheduledFor`：cron 的持久化原定时间；人工运行为 null。
- `deadlineAt`：协作式 deadline，不能被解释为事务回滚保证。
- `payload`：JSON，最多 16 KiB。

## 结果

成功必须表示业务操作已经完成，而不是只被另一个系统受理：

```ts
{ protocolVersion: 1, executionId, attemptId, ok: true, summary, output? }
```

预期业务错误：

```ts
{
  protocolVersion: 1,
  executionId,
  attemptId,
  ok: false,
  error: { code, message, retryable }
}
```

平台校验 protocol、executionId、attemptId 和大小。summary 最大 1 KiB，output 最大 8 KiB，错误消息最大 2 KiB。

SDK 只把显式 `CronError.retryable()` 与 `CronError.permanent()` 包装成明确错误。未知异常继续抛出，平台记录为结果未知。不符合协议 1..128 字符约束的显式错误码会规范化为 `INVALID_CRON_ERROR_CODE`，避免明确业务失败因非法 envelope 被误判为 `unknown`。

## 版本与序列化

跨 RPC 边界只传普通 JSON 值；禁止函数、Stream、RpcTarget、BigInt、循环对象和 Error 实例。部署 Target manifest 只固定物理 binding、service、entrypoint 与 protocol version；Action name、version、标签和幂等声明来自该 Worker 的最新 Registration。

协议升级顺序：先让目标兼容新旧版本，再升级平台，最后移除旧能力。不得把旧 Execution 静默改发到新 Action version。

SDK 允许同一 Action 名注册多个版本，并按 `action + actionVersion` 精确路由：

```ts
createCronHandler({
  syncUsers: [
    defineAction({ version: 1, ...syncUsersV1 }),
    defineAction({ version: 2, ...syncUsersV2 }),
  ],
});
```

空版本数组和重复版本会在 Worker 启动时失败，避免部署含糊的能力 manifest。

## Registration 协议

业务 Worker 使用 SDK 对以下端点发布完整期望状态：

```http
PUT /api/v1/registration
Authorization: Bearer <registration-token>
Idempotency-Key: registration:<declaration-digest>
Content-Type: application/json
```

请求包含 `protocolVersion`、稳定的 `registrationRevision`、Worker 标签、完整 Action 列表和完整 Schedule 列表。Target identity 只从 Token 派生，body 中不接受 Target 或 URL。

相同 revision 与内容重试为 no-op；相同 revision 携带不同内容返回 `409 REGISTRATION_REVISION_CONFLICT`。新 revision 在一个 D1 batch 中替换 Action、upsert Schedule 并软退役缺失 key。Registration 不修改 Target disable、平台全局暂停、Operator Override、Execution 或 Attempt。

平台永久保存每个 Target 已见过的 revision/hash 对，因此回滚到完全相同的历史声明是合法的，而把旧 revision 用于另一份内容始终冲突。所有 Target 的未退役 Schedule 合计最多 50 个；数据库 trigger 在并发 Registration 下执行最终约束。
