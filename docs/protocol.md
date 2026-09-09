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
- `source`：原始来源 `cron/manual/rerun`，重试时不改变。
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

跨 RPC 边界只传普通 JSON 值；禁止函数、Stream、RpcTarget、BigInt、循环对象和 Error 实例。Target manifest 同时固定 protocol version、Action name、Action version 与幂等声明。

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
