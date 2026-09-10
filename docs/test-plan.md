# 测试执行计划

本文档是 Cloudflare Unified Cron Platform 后续本地测试与真实 Cloudflare 测试的唯一执行清单。测试人员和自动化 Agent 必须按测试 ID 执行、记录证据并满足退出条件；未留下证据的项目不得标记为通过。

## 1. 执行规则

- 每次测试从干净的目标 commit 开始，记录完整 commit SHA、UTC 时间和环境。
- API 路径、认证、Headers 与状态语义以 [`apps/web/public/llms.txt`](../apps/web/public/llms.txt) 为准；本文不复制 API 参考。
- 本地与远程尽量复用相同场景 ID、Registration 和断言。
- 测试业务副作用只能写入专用 Test Target D1，禁止调用真实邮件、支付、删除或生产 API。
- 日志和报告必须隐藏管理员密码、Cookie、Registration Token、Cloudflare API Token、Account ID、D1 ID 和完整请求头。
- 每个失败先保存证据，再修复；修复后重新执行原测试 ID 和受影响的回归集合。
- `BLOCKED` 必须写明缺少的权限、资源或用户动作。`SKIPPED` 必须说明风险依据，不能用于绕过失败。
- 远程资源创建、Secret 写入、部署、回滚和删除需要用户明确批准。
- 每个 Worker 远程部署批次开始前必须运行 `pnpm exec wrangler whoami`，仅向用户展示 Cloudflare 登录用户名/邮箱和 Account 名称，并等待用户明确确认身份正确。Account ID、Token 等敏感值必须隐藏；确认前禁止执行 `wrangler deploy` 或任何等效发布操作。登录身份或目标 Account 发生变化后必须重新确认。
- 生产环境、生产 D1 和真实业务 Worker 不在本计划范围内。

允许的结果：`PASS`、`FAIL`、`BLOCKED`、`SKIPPED`。

## 2. 每项证据格式

每个测试 ID 至少记录：

```text
Test ID:
Result: PASS | FAIL | BLOCKED | SKIPPED
Environment: local | staging
Commit SHA:
Started/finished UTC:
Commands or browser path:
Expected:
Observed:
Evidence: screenshot/log/query/trace path or URL
Correlation: requestId/tickId/scheduleId/executionId/attemptId
Notes:
```

远程测试的执行记录写入 `docs/test-runs/<UTC-date>-staging.md`；本地里程碑记录写入 `docs/test-runs/<UTC-date>-local.md`。目录在首次执行时创建。

## 3. 环境拓扑

### 3.1 Local

```text
Playwright / HTTP driver
        │
        ├── Platform Worker + Web + Platform D1
        │          │
        │          └── Service Binding RPC
        │                         │
        └── Test Target Worker + Test D1
```

Local 使用 Wrangler、workerd、D1 local persistence 和生产同构 Worker 配置。允许通过 `/cdn-cgi/local/scheduled` 注入确定的 scheduled time。

### 3.2 Staging

```text
Agent-operated browser / remote driver
        │
        ├── unified-cron-platform-test.<approved-domain>
        │      ├── Static Assets
        │      ├── dedicated Platform D1
        │      ├── one real * * * * * Cron Trigger
        │      └── Service Binding ──────────────┐
        │                                        │
        └── unified-cron-test-target.<approved-domain>
               ├── CronEntrypoint ◄─────────────┘
               ├── dedicated Test Target D1
               └── protected scenario-control UI/API
```

两个 Worker 必须位于同一个专用测试 Account 或同一 Account 的隔离测试资源中。Staging 不复用生产数据库、域名、Secret 或业务绑定。

## 4. Test Target Worker 要求

在进入远程测试前，Test Target Worker 必须满足：

- [ ] `TTW-001` 使用仓库 Worker SDK 实现真实 `CronEntrypoint.describe()` 与 `cron()`。
- [ ] `TTW-002` 使用独立 D1 保存场景配置、RPC 调用收据和幂等结果。
- [ ] `TTW-003` 控制页/API 受 Cloudflare Access 或独立测试 Secret 保护。
- [ ] `TTW-004` 每个场景默认只影响下一次 RPC，消费后自动恢复 `success`。
- [ ] `TTW-005` 收据包含 executionId、attemptId、idempotencyKey、action、payload hash、开始/结束时间、模式和副作用计数。
- [ ] `TTW-006` reset 只清理测试 Worker 自身的测试数据，并拒绝非测试环境调用。
- [ ] `TTW-007` Registration 使用平台签发的真实 Registration Token，不使用测试后门。
- [ ] `TTW-008` Test Target 不调用任何真实外部业务服务。

必须实现的确定性模式：

- [ ] `MODE-001 success`：完成一次业务写入并返回有效成功结果。
- [ ] `MODE-002 permanent_failure`：返回明确、不可重试的业务失败。
- [ ] `MODE-003 retryable_then_success`：首次明确失败，下一次成功。
- [ ] `MODE-004 throw_before_effect`：副作用前抛出未知异常。
- [ ] `MODE-005 timeout_after_effect`：先提交幂等业务写入，再超过 Deadline。
- [ ] `MODE-006 slow_success`：接近但不超过 Deadline 后成功。
- [ ] `MODE-007 malformed_result`：返回协议不兼容的结果。
- [ ] `MODE-008 identity_mismatch`：返回错误 executionId 或 attemptId。
- [ ] `MODE-009 duplicate_idempotency`：并发或重复调用同一 key，只产生一次业务副作用。
- [ ] `MODE-010 non_idempotent_failure`：非幂等 Action 失败，用于验证禁止危险重试。

## 5. Phase L0：本地静态门禁

- [ ] `L0-001` `pnpm install --frozen-lockfile` 成功，lockfile 无变化。
- [ ] `L0-002` `pnpm format:check` 通过。
- [ ] `L0-003` `pnpm lint` 通过，包含 no-floating-promises。
- [ ] `L0-004` `pnpm typecheck` 通过，所有 workspace 使用严格 TypeScript。
- [ ] `L0-005` `pnpm test:unit` 通过，覆盖率门槛满足。
- [ ] `L0-006` `pnpm test:integration` 通过。
- [ ] `L0-007` `pnpm build` 通过。
- [ ] `L0-008` `pnpm deploy:dry-run` 通过并列出预期 D1、Assets 和 Service Binding。
- [ ] `L0-009` `pnpm test:e2e` 在 1440、768、390 三个 viewport 通过。
- [ ] `L0-010` `pnpm verify` 从头到尾以退出码 0 完成。
- [ ] `L0-011` Web build 包含 `/llms.txt`，内容与源文件一致。
- [ ] `L0-012` Git 工作树干净，测试不生成未忽略的状态文件。

## 6. Phase L1：本地 Web 联调

- [ ] `L1-001` 从空 D1 执行 migrations、Target sync 和 seed，重复执行保持幂等。
- [ ] `L1-002` `localhost` 与 `127.0.0.1` 均可登录；非允许 Origin 被拒绝。
- [ ] `L1-003` 错误密码使用统一错误文案，连续失败触发持久化限流。
- [ ] `L1-004` 登录 Cookie 为 HttpOnly、SameSite=Strict；退出后 Session 失效。
- [ ] `L1-005` Overview、网站、Cron、Execution、接入和系统页面均使用真实 API 数据。
- [ ] `L1-006` 四网站 Demo、折叠记忆、筛选、状态图和详情导航工作正常。
- [ ] `L1-007` 所有 Demo Schedule 和 Execution 详情通过前端响应 Schema。
- [ ] `L1-008` Registration Token 原文只显示一次，刷新和列表中不可恢复。
- [ ] `L1-009` Token 轮换原子撤销旧 Token；撤销后旧 Token 不能 Registration。
- [ ] `L1-010` Schedule 暂停/恢复与 Worker declaredEnabled 分开显示。
- [ ] `L1-011` Target disable、Schedule pause 和 System pause 分别生效且互不覆盖。
- [ ] `L1-012` Retry、Run again、Cancel、Resolve unknown 只在允许状态出现。
- [ ] `L1-013` JSON 404、加载、空、错误和恢复状态均可访问且文案正确。
- [ ] `L1-014` 键盘导航、焦点恢复、对话框焦点锁定和 Escape 关闭通过。
- [ ] `L1-015` 浅色/深色以及 390、768、1440 布局无不可达操作和意外横向溢出。

## 7. Phase L2：本地双 Worker 场景

- [ ] `L2-001` Platform 与 Test Target 使用生产同构配置同时启动。
- [ ] `L2-002` Test Target 使用真实 Token 发布完整 Registration。
- [ ] `L2-003` 相同 revision 与内容重复发布为 no-op。
- [ ] `L2-004` 相同 revision 携带不同内容返回 `REGISTRATION_REVISION_CONFLICT`。
- [ ] `L2-005` 新 revision 新增、更新和软退役 Schedule，历史 Execution 保留。
- [ ] `L2-006` 移除后重新加入同 key 恢复同一逻辑 Schedule，不清除 Operator Override。
- [ ] `L2-007` `describe()` 与 Registration 匹配时 Target compatible。
- [ ] `L2-008` Action version 或幂等声明不匹配时 Target incompatible。
- [ ] `L2-009` 指定 scheduled time 连续触发两次，只生成一个 Cron Execution。
- [ ] `L2-010` 并发 Tick 不重复 claim 同一 Execution。
- [ ] `L2-011` success 模式生成 succeeded Execution、一个 Attempt 和一条业务收据。
- [ ] `L2-012` permanent_failure 生成明确 failed，不进入 unknown。
- [ ] `L2-013` retryable_then_success 按延迟创建新 Attempt，Execution 最终成功。
- [ ] `L2-014` throw_before_effect 进入 unknown，不伪装成明确失败。
- [ ] `L2-015` timeout_after_effect 进入 unknown，业务 D1 副作用计数仍为 1。
- [ ] `L2-016` malformed_result 与 identity_mismatch 进入 unknown 并保存错误证据。
- [ ] `L2-017` duplicate_idempotency 在重复 RPC 下副作用计数保持 1。
- [ ] `L2-018` 非幂等 Action 不允许自动 Retry 或 retryOnUnknown。
- [ ] `L2-019` 旧 lease 的迟到 finalize 不能覆盖新 Attempt。
- [ ] `L2-020` D1 materialize、claim 或 finalize 中途失败时保持事务不变量。
- [ ] `L2-021` 每 Tick 物化和派发预算得到执行，积压按后续 Tick 有界清空。
- [ ] `L2-022` 50 个未退役 Schedule 边界在并发 Registration 下仍由 D1 拒绝超限。

## 8. Phase R0：远程测试授权与准备

- [ ] `R0-001` 用户确认测试 Cloudflare Account。
- [ ] `R0-002` 用户确认测试域名或允许使用受限 workers.dev 地址。
- [ ] `R0-003` 用户批准创建两个 Worker、两个 D1、一个 Cron Trigger 和一个 Service Binding。
- [ ] `R0-004` 用户通过安全交互完成 Cloudflare 登录；Token 不进入聊天、命令参数或日志。
- [ ] `R0-005` 资源名称、region、计划类型和预计保留时间记录在测试运行报告。
- [ ] `R0-006` 确认没有任何生产资源 ID、Secret 或路由进入测试配置。
- [ ] `R0-007` 保存部署前 commit SHA 和 Wrangler 版本。
- [ ] `R0-008` 紧邻部署前执行 `pnpm exec wrangler whoami`，向用户展示已隐藏敏感值的登录用户名/邮箱与目标 Account 名称；记录用户明确确认和 UTC 时间。未通过时停止，不进入 R1。

## 9. Phase R1：Staging 部署

进入本阶段前，`R0-008` 必须为 PASS。每次新的部署批次以及登录身份或目标 Account 变化后都必须重新执行该门禁。

- [ ] `R1-001` 创建并记录 Test Target D1，应用 migrations。
- [ ] `R1-002` 部署 Test Target Worker，控制页/API 未授权访问被拒绝。
- [ ] `R1-003` 创建并记录 Platform D1，应用 migrations。
- [ ] `R1-004` 配置 Service Binding、Target manifest 和 Target sync。
- [ ] `R1-005` 交互式写入管理员密码 Secret。
- [ ] `R1-006` 部署 Platform Worker、Static Assets 和真实分钟 Cron。
- [ ] `R1-007` `/llms.txt` 可读取，敏感信息扫描无结果。
- [ ] `R1-008` 未知 `/api` 路径返回 JSON 404，非 SPA HTML。
- [ ] `R1-009` 管理员登录、退出、Session 和 Origin 边界通过。
- [ ] `R1-010` 两个 Worker 的 Logs/Traces 可查询并包含 build 标识。

## 10. Phase R2：远程 Registration

- [ ] `R2-001` 控制台签发一次性 Registration Token。
- [ ] `R2-002` Token 通过 Wrangler Secret 安全写入 Test Target。
- [ ] `R2-003` Test Target 使用真实公开 Registration API 发布声明。
- [ ] `R2-004` 平台展示正确 Worker label、Actions、Cron、revision 和 next run。
- [ ] `R2-005` Target check 通过真实 Service Binding `describe()`。
- [ ] `R2-006` 重复发布、revision 冲突、新 revision 和软退役行为与 L2 一致。
- [ ] `R2-007` 轮换 Token 后旧 Token 立即失效，新 Token 可继续发布。

## 11. Phase R3：真实 Cron 与成功路径

- [ ] `R3-001` 记录 Cron 部署时间并等待配置传播，不用手工 scheduled endpoint 代替本项。
- [ ] `R3-002` 首次真实 Tick 在 System 页面和 Workers Logs 中可关联。
- [ ] `R3-003` 测试 Schedule 由真实 Tick 物化，不由浏览器请求直接执行。
- [ ] `R3-004` Platform 通过真实 Service Binding 调用 Test Target。
- [ ] `R3-005` Execution、Attempt 和 Test Target D1 收据 identity 完全一致。
- [ ] `R3-006` succeeded 只在业务 D1 提交后出现。
- [ ] `R3-007` 浏览器关闭后连续执行仍继续。
- [ ] `R3-008` UTC scheduledFor、IANA timezone 和 next_run_at 计算一致。
- [ ] `R3-009` 连续 60 个真实分钟 Tick 无重复物化、无遗留 running lease。

## 12. Phase R4：远程故障场景

- [ ] `R4-001` permanent_failure 保存业务错误 code/message/retryable=false。
- [ ] `R4-002` retryable_then_success 按策略完成第二 Attempt。
- [ ] `R4-003` throw_before_effect 进入 unknown，业务收据不存在。
- [ ] `R4-004` timeout_after_effect 进入 unknown，业务收据存在且副作用计数为 1。
- [ ] `R4-005` slow_success 在 Deadline 内成功并记录真实 duration。
- [ ] `R4-006` malformed_result 进入 unknown，不接受部分或错误结构。
- [ ] `R4-007` identity_mismatch 进入 unknown，不关联错误结果。
- [ ] `R4-008` 非幂等失败不出现自动 Retry 操作。
- [ ] `R4-009` 暂时移除或破坏测试绑定后记录 unavailable/unknown，再安全恢复。
- [ ] `R4-010` 每项故障均能用 tickId、executionId、attemptId 和业务收据完成日志关联。

## 13. Phase R5：远程人工控制

- [ ] `R5-001` Schedule pause 阻止新物化，Registration 不能清除覆盖。
- [ ] `R5-002` Schedule resume 只清除 Operator Override。
- [ ] `R5-003` Target disable 阻止该 Worker 新派发，不强杀 running RPC。
- [ ] `R5-004` System pause 阻止所有 Target 新物化和派发。
- [ ] `R5-005` 恢复全局派发后仍尊重 Target 和 Schedule 独立开关。
- [ ] `R5-006` Retry 保持原 Execution 和幂等键并创建新 Attempt。
- [ ] `R5-007` Run again 创建新 Execution、新幂等键和 parent 关联。
- [ ] `R5-008` Cancel 只允许 pending/retry_wait，running 被拒绝。
- [ ] `R5-009` Resolve unknown 保存结论、说明、操作者和审计事件。
- [ ] `R5-010` 所有 mutation 重复提交相同 Idempotency-Key 返回相同结果；换 body 冲突。

## 14. Phase R6：安全测试

- [ ] `R6-001` 未登录管理员 API 返回 401。
- [ ] `R6-002` 错误 Origin、缺失 Origin 和跨域 mutation 被拒绝。
- [ ] `R6-003` 非 JSON、非法 UTF-8、超过 64 KiB 和多余字段被拒绝。
- [ ] `R6-004` 缺失或非法 Idempotency-Key 被拒绝。
- [ ] `R6-005` 缺失、陈旧或错误 If-Match 被拒绝且不改变状态。
- [ ] `R6-006` Registration Token 不能访问管理员 API。
- [ ] `R6-007` 管理员 Session 不能替代 Registration Bearer Token。
- [ ] `R6-008` Token 原文不出现在 D1、列表、日志、HTML、截图和报告中。
- [ ] `R6-009` Cookie 在 Staging 使用 Secure、HttpOnly、SameSite=Strict 和 `__Host-` 前缀。
- [ ] `R6-010` CSP、X-Content-Type-Options、Referrer-Policy 和 frame protection 生效。
- [ ] `R6-011` Test Target 控制 API 未授权访问和非测试环境访问均被拒绝。

## 15. Phase R7：容量、观测与 Soak

- [ ] `R7-001` 1、10、25、50 Schedule 数据量下页面和 API 正常。
- [ ] `R7-002` 多个整点 Schedule 同时到期时，预算与 dispatch lag 可解释。
- [ ] `R7-003` Execution 和 Audit cursor 分页无重复、遗漏或顺序漂移。
- [ ] `R7-004` 记录 API、Tick、RPC 的 p50/p95/p99 wall time；不把本地时间当 Cloudflare CPU time。
- [ ] `R7-005` 记录 D1 query/row 数、Worker CPU time、错误率和冷启动证据。
- [ ] `R7-006` 24 小时真实 Cron Soak 无未解释的失败、重复副作用或永久 stuck 状态。
- [ ] `R7-007` Soak 期间至少覆盖一次 Registration 更新和一次安全暂停/恢复。
- [ ] `R7-008` Overview 成功率与底层 resolved Execution 样本人工复算一致。

性能阈值在第一次 Staging 基线测量后由用户确认，再写入本节。首次运行只记录分布，不凭空设定 SLO。

## 16. Phase R8：回滚与清理

- [ ] `R8-001` 回滚前暂停全局派发并清点 pending、retry_wait、running、unknown。
- [ ] `R8-002` 验证 D1 schema 与待回滚版本双向兼容。
- [ ] `R8-003` 先保证 Test Target 兼容当前 Action version，再回滚 Platform。
- [ ] `R8-004` 回滚后管理员 API、真实 Tick 和一次 success 场景通过。
- [ ] `R8-005` 普通代码回滚不使用 D1 清空或 Time Travel restore。
- [ ] `R8-006` 保存最终测试报告、失败清单、日志索引和 commit/build 对照。
- [ ] `R8-007` 撤销所有测试 Registration Token 和控制 Secret。
- [ ] `R8-008` 用户确认后删除或保留 Staging Worker、D1、路由和 Cron。
- [ ] `R8-009` 删除前导出需要保留的非敏感证据，删除后确认无残留路由。

## 17. 缺陷等级

- `P0`：生产边界泄漏、凭据泄漏、跨 Target 调用、数据破坏或无法安全停止派发。
- `P1`：重复业务副作用、状态机错误、错误结果被记为成功、unknown 被危险重试、回滚失败。
- `P2`：单一功能错误、有明确绕过方式、审计或可访问性证据不完整。
- `P3`：不影响正确性的视觉、文案或低风险一致性问题。

P0/P1 出现后停止后续破坏性或长时间阶段，保留现场并先修复。P2 可继续无依赖的测试；P3 进入集中收尾。

## 18. 最终退出条件

- [ ] 所有必需 `L0`、`L1`、`L2`、`R0`..`R8` 项为 PASS，或有用户批准的明确 SKIPPED 理由。
- [ ] P0、P1 为零；P2 均有负责人和处理结论。
- [ ] 所有 unknown 均已解释、人工解决或保留为明确已知风险。
- [ ] 重复 Tick、Retry 和模糊结果场景未产生重复业务副作用。
- [ ] 24 小时 Soak 完成，真实 Cron、D1、RPC 和 Web 证据完整。
- [ ] 回滚演练完成，恢复后真实成功路径通过。
- [ ] `docs/validation-report.md` 更新为当前 commit 的最终证据摘要。
- [ ] 用户审阅测试报告并批准进入下一阶段。

## 19. 当前状态

- 基线分支：`main`
- 文档基线提交：`bb612a8`（发布 `/llms.txt`）
- Local 自动化在计划创建前曾通过，但所有复测项仍保持未勾选；只有按本文重新执行并记录证据后才能更新状态。
- Staging 资源尚未创建，远程测试尚未开始。
