# Cron 语义

## 方言

平台只接受 Unix 五字段数字子集：

```text
minute hour day-of-month month day-of-week
```

支持 `*`、数字、列表、范围和步长。不支持秒字段、年字段、`@daily`、`?`、`L`、`W`、`#`、`H` 或名称缩写。day-of-month 与 day-of-week 至少一项必须是字面量 `*`。

平台星期编号为 Unix 语义：0 或 7 是 Sunday，1 是 Monday。Cloudflare 原生 Cron 的数字星期语义不同，不能直接复制含数字星期的表达式。

## 实现

锁定 `cron-parser` 5.10.0。平台先校验五字段子集，再补固定秒字段 `0`，使用 strict mode 和 IANA timezone。`nextAfter` 必须严格大于输入时间，搜索上限为 8 年，preview 最多 10 项。

`next_run_at` 和 `scheduled_for` 使用 UTC epoch 毫秒。编辑 cron/timezone 或恢复计划时从实际 Clock 重新计算未来时间；不会把周期变成“业务完成后再等 N 分钟”。

## DST 固定测试

以下是锁定库的 2026 年实际结果：

- `30 2 * * *` + `America/New_York`：春季缺失的本地 02:30 在 2026-03-08 对应 `07:30Z`，即落到本地 03:30。
- `30 1 * * *` + `America/New_York`：秋季重复小时只产生一个 2026-11-01 occurrence，为 `05:30Z`；下一次是 2026-11-02 `06:30Z`。

这些行为由单元测试固定。升级 cron-parser 或 compatibility date 时必须先重新验证，不凭经验改文档。

## Misfire 与重叠

- `coalesce`：只创建一个 Execution，保留最早 `scheduled_for`，将 next 推进到当前时间之后。
- `skip`：超过宽限时创建 `skipped/MISFIRE`，不发 RPC。
- 同一 Schedule 有 active 或 unknown Execution 时，新发生记录为 `skipped/OVERLAP`。

不会循环补齐宕机期间的每一分钟。
