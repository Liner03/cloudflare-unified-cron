# 运维手册

## 健康含义

- API 可查询：控制面请求可用。
- Tick healthy：最近 3 分钟内成功完成 scheduled handler。
- Target compatible：上次人工 `describe()` 与最新 Registration 完全一致。
- Execution succeeded：收到并持久化有效业务结果。

四者不能互相替代。Overview 不根据页面可打开就显示 Scheduler 正常。

## 常见故障

### D1 不可用

平台停止新派发，API 返回 503，不回退到内存 Schedule。恢复后按 D1 状态、租约和 misfire 策略继续。

### RPC 超时或连接中断

结果记为 unknown；这不证明业务未执行。先用 executionId、attemptId、targetId 和 action 检查 Workers Logs 与业务系统。只有快照和当前 Registration 都声明幂等，且策略允许时，才可 Retry。

### 业务完成但 finalize 失败

Execution 保持 running，租约到期后恢复为 unknown 或安全 retry_wait。不要凭日志手动直接写 succeeded；使用控制台的人工核实并填写说明。

### Target 禁用或不兼容

禁用阻止新的物化与派发，不消耗 Attempt，也不强杀 running RPC。先处理 existing pending/retry/unknown，升级目标，再执行 Target check。

### 集中到期

V1 每 Tick 最多派发 2 个 Attempt。大量整点 Schedule 会产生 dispatch lag。优先错开分钟；提高批量前必须测量 CPU、D1 statements 与 rows。

## 人工操作

- Schedule 配置：只读，来自 Worker Registration；管理员不创建、编辑或归档。
- Pause / Resume：只修改独立 Operator Override；Worker 重新注册不能清除暂停。
- Target disable / enable：物理派发安全开关，不修改 Worker 声明。
- Registration Token rotate：在同一事务中签发替换 Token 并撤销旧 Token；新原始值仍只显示一次。
- Retry：同一 Execution、同一幂等键、新 Attempt；仅当不可变快照与当前同版本 Action 都声明幂等时可用，并受 7 天窗口和 Attempt 总上限 10 约束。
- Run again：新 Execution、新幂等键、记录 parent；可能重复业务副作用。
- Cancel：仅 pending/retry_wait；running 不可强杀。
- Resolve unknown：必须选择 confirmed success、confirmed failure 或 abandon，并写人工说明。

Schedule 不提供 Run now。需要重放一个已完成的业务意图时使用 Execution 的 Run again；需要验证新声明时使用短周期测试 Schedule，并让统一 Tick 正常物化。

## 成功率

- Execution success rate = `succeeded / (succeeded + failed + unknown)`。
- First-attempt success rate 使用同一 resolved 样本，只把 `attempt_count = 1` 的 succeeded 计为分子。
- `skipped`、`cancelled`、pending、running 与 retry_wait 不进入分母。
- 每个值必须同时展示 24 小时、7 天或 30 天窗口以及 numerator/denominator；分母为 0 时显示无数据，不显示 100%。

## 保留与清理

- succeeded/skipped/cancelled：14 天。
- failed：30 天。
- audit：90 天。
- API idempotency：7 天。
- Admin Session：到期后由 Tick 有界清理；失败登录限流记录在窗口结束后清理。
- active 和 unknown：不自动清理。

清理在已有 Tick 中有界执行，不增加第二个 Cron。

## 日志

D1 保存有界审计与结果摘要。完整调试日志使用 Workers Logs，并以 platformInstanceId、tickId、scheduleId、executionId、attemptId、targetId、action 和 errorCode 关联。不得记录 Cookie、Registration Token、密码、完整请求头或无界第三方响应。
