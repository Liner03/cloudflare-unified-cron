-- Deterministic local-only fixtures for exercising the operator-first UI.
-- This file never runs as a migration or production seed.
PRAGMA foreign_keys = ON;

INSERT INTO registration_tokens (
  id, target_id, label, token_hash, scope, expires_at,
  last_used_at, revoked_at, created_by, created_at
) VALUES (
  'demo-seed-token', 'DATA', 'Local demo fixture',
  '0000000000000000000000000000000000000000000000000000000000000000',
  'registration:write', 4102444800000, NULL, NULL, 'local-demo',
  CAST(unixepoch('subsec') * 1000 AS INTEGER)
)
ON CONFLICT(id) DO UPDATE SET
  label = excluded.label,
  expires_at = excluded.expires_at,
  revoked_at = NULL;

INSERT INTO registrations (
  target_id, registration_revision, document_hash, worker_label,
  registered_at, token_id
) VALUES (
  'DATA', 'local-demo-2026-09-10',
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'Data Worker', CAST(unixepoch('subsec') * 1000 AS INTEGER),
  'demo-seed-token'
)
ON CONFLICT(target_id) DO UPDATE SET
  registration_revision = excluded.registration_revision,
  document_hash = excluded.document_hash,
  worker_label = excluded.worker_label,
  registered_at = excluded.registered_at,
  token_id = excluded.token_id;

INSERT INTO registration_revisions (
  target_id, registration_revision, document_hash, first_seen_at, token_id
) VALUES (
  'DATA', 'local-demo-2026-09-10',
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  CAST(unixepoch('subsec') * 1000 AS INTEGER), 'demo-seed-token'
)
ON CONFLICT(target_id, registration_revision) DO NOTHING;

WITH actions(name, version, label, description, idempotent) AS (
  VALUES
    ('contentSync', 1, '内容同步', '同步网站内容与索引', 1),
    ('inventoryRefresh', 1, '库存刷新', '刷新商品库存缓存', 1),
    ('dailyDigest', 1, '每日摘要', '生成每日业务摘要', 1),
    ('cacheCleanup', 1, '缓存清理', '清理过期缓存记录', 1),
    ('sitemapGenerate', 1, '站点地图', '重新生成 sitemap', 1),
    ('newsletterDigest', 1, '邮件摘要', '准备订阅邮件摘要', 1),
    ('feedImport', 1, 'Feed 导入', '导入外部内容源', 1),
    ('orderReconcile', 1, '订单核对', '核对支付与订单状态', 0)
)
INSERT INTO registered_actions (
  target_id, name, version, label, description, idempotent,
  example_payload_json, created_at, updated_at
)
SELECT
  'DATA', name, version, label, description, idempotent, '{}',
  CAST(unixepoch('subsec') * 1000 AS INTEGER),
  CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM actions
WHERE true
ON CONFLICT(target_id, name, version) DO UPDATE SET
  label = excluded.label,
  description = excluded.description,
  idempotent = excluded.idempotent,
  updated_at = excluded.updated_at;

WITH fixtures(
  id, registration_key, name, description, action, cron_expression,
  enabled, declared_enabled, operator_paused, next_offset_minutes,
  retry_policy_json
) AS (
  VALUES
    ('demo-content-sync', 'demo-content-sync', '内容同步', '同步文章、标签与搜索索引', 'contentSync', '*/5 * * * *', 1, 1, 0, 5, '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}'),
    ('demo-inventory-refresh', 'demo-inventory-refresh', '库存刷新', '刷新商品库存缓存', 'inventoryRefresh', '*/10 * * * *', 1, 1, 0, 10, '{"maxAttempts":2,"delaysSeconds":[60],"retryOnUnknown":true}'),
    ('demo-daily-digest', 'demo-daily-digest', '每日摘要', '每天生成业务摘要', 'dailyDigest', '0 9 * * *', 1, 1, 0, 180, '{"maxAttempts":2,"delaysSeconds":[300],"retryOnUnknown":false}'),
    ('demo-cache-cleanup', 'demo-cache-cleanup', '缓存清理', '每六小时清理过期缓存', 'cacheCleanup', '0 */6 * * *', 1, 1, 0, 240, '{"maxAttempts":3,"delaysSeconds":[60,300],"retryOnUnknown":false}'),
    ('demo-sitemap', 'demo-sitemap', '站点地图生成', '重新生成 sitemap.xml', 'sitemapGenerate', '0 2 * * *', 1, 1, 0, 360, '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}'),
    ('demo-newsletter', 'demo-newsletter', '邮件摘要', '网站声明暂时停用', 'newsletterDigest', '0 8 * * 1', 0, 0, 0, NULL, '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}'),
    ('demo-feed-import', 'demo-feed-import', '外部 Feed 导入', '当前配置失效，等待网站重新发布', 'feedImport', '15 * * * *', 0, 1, 0, NULL, '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}'),
    ('demo-order-reconcile', 'demo-order-reconcile', '订单核对', '维护期间由管理员暂停', 'orderReconcile', '*/15 * * * *', 0, 1, 1, NULL, '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}')
)
INSERT INTO schedules (
  id, name, description, target_id, action, action_version,
  cron_expression, timezone, enabled, archived_at, revision,
  payload_json, retry_policy_json, timeout_ms, misfire_policy,
  misfire_grace_seconds, next_run_at, created_at, updated_at,
  registration_key, managed_by_registration, declared_enabled,
  operator_paused, retired_at, registration_config_hash
)
SELECT
  id, name, description, 'DATA', action, 1,
  cron_expression, 'Asia/Shanghai', enabled, NULL, 1,
  '{}', retry_policy_json, 30000, 'coalesce', 300,
  CASE
    WHEN next_offset_minutes IS NULL THEN NULL
    ELSE CAST(unixepoch('subsec') * 1000 AS INTEGER) + next_offset_minutes * 60000
  END,
  CAST(unixepoch('subsec') * 1000 AS INTEGER),
  CAST(unixepoch('subsec') * 1000 AS INTEGER),
  registration_key, 1, declared_enabled, operator_paused, NULL,
  printf('%064x', row_number() OVER (ORDER BY id))
FROM fixtures
WHERE true
ON CONFLICT(target_id, registration_key)
  WHERE managed_by_registration = 1
DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  action = excluded.action,
  action_version = excluded.action_version,
  cron_expression = excluded.cron_expression,
  timezone = excluded.timezone,
  enabled = excluded.enabled,
  archived_at = NULL,
  payload_json = excluded.payload_json,
  retry_policy_json = excluded.retry_policy_json,
  timeout_ms = excluded.timeout_ms,
  misfire_policy = excluded.misfire_policy,
  misfire_grace_seconds = excluded.misfire_grace_seconds,
  next_run_at = excluded.next_run_at,
  declared_enabled = excluded.declared_enabled,
  operator_paused = excluded.operator_paused,
  retired_at = NULL,
  registration_config_hash = excluded.registration_config_hash,
  updated_at = excluded.updated_at;

WITH fixture_executions(
  id, schedule_id, status, reason_code, minutes_ago, attempt_count
) AS (
  VALUES
    ('demo-exec-content-1', 'demo-content-sync', 'succeeded', NULL, 35, 1),
    ('demo-exec-content-2', 'demo-content-sync', 'succeeded', NULL, 210, 1),
    ('demo-exec-content-3', 'demo-content-sync', 'succeeded', NULL, 690, 1),
    ('demo-exec-inventory-1', 'demo-inventory-refresh', 'unknown', NULL, 55, 1),
    ('demo-exec-inventory-2', 'demo-inventory-refresh', 'succeeded', NULL, 280, 1),
    ('demo-exec-digest-1', 'demo-daily-digest', 'failed', NULL, 125, 1),
    ('demo-exec-digest-2', 'demo-daily-digest', 'succeeded', NULL, 1180, 1),
    ('demo-exec-cache-1', 'demo-cache-cleanup', 'retry_wait', 'AUTOMATIC_RETRY_SCHEDULED', 185, 1),
    ('demo-exec-cache-2', 'demo-cache-cleanup', 'succeeded', NULL, 540, 1),
    ('demo-exec-sitemap-1', 'demo-sitemap', 'succeeded', NULL, 370, 1),
    ('demo-exec-order-1', 'demo-order-reconcile', 'skipped', 'TARGET_DISABLED', 95, 0)
), prepared AS (
  SELECT
    f.*,
    s.action,
    s.action_version,
    s.revision AS schedule_revision,
    s.payload_json,
    s.retry_policy_json,
    s.timeout_ms,
    s.cron_expression,
    s.timezone,
    CAST(unixepoch('subsec') * 1000 AS INTEGER) - f.minutes_ago * 60000 AS occurred_at,
    CAST(unixepoch('subsec') * 1000 AS INTEGER) AS now_ms
  FROM fixture_executions f
  JOIN schedules s ON s.id = f.schedule_id
)
INSERT INTO executions (
  id, schedule_id, target_id, source, scheduled_for, parent_execution_id,
  dedupe_key, schedule_revision, snapshot_json, status, reason_code,
  coalesced_until, available_at, next_attempt_reason, attempt_count,
  attempt_limit, max_auto_attempts, lease_token, lease_expires_at,
  retry_deadline_at, started_at, finished_at, result_json,
  last_error_json, created_at, updated_at
)
SELECT
  id, schedule_id, 'DATA', 'cron', occurred_at, NULL,
  'demo:' || id, schedule_revision,
  json_object(
    'scheduleId', schedule_id,
    'scheduleRevision', schedule_revision,
    'targetId', 'DATA',
    'action', action,
    'actionVersion', action_version,
    'targetManifestRevision', 'data-v1',
    'targetActionIdempotent', true,
    'payload', json(payload_json),
    'retryPolicy', json(retry_policy_json),
    'timeoutMs', timeout_ms,
    'cronExpression', cron_expression,
    'timezone', timezone
  ),
  status, reason_code, NULL,
  CASE WHEN status = 'retry_wait' THEN now_ms + 10 * 60000 ELSE occurred_at END,
  CASE WHEN status = 'retry_wait' THEN 'automatic_retry' ELSE 'initial' END,
  attempt_count,
  CASE WHEN status = 'retry_wait' THEN 3 ELSE MAX(1, attempt_count) END,
  CASE WHEN status = 'retry_wait' THEN 3 ELSE 1 END,
  NULL, NULL, occurred_at + 24 * 60 * 60000,
  CASE WHEN attempt_count > 0 THEN occurred_at ELSE NULL END,
  CASE
    WHEN status IN ('succeeded', 'failed', 'skipped', 'cancelled')
      THEN occurred_at + 12000
    ELSE NULL
  END,
  CASE
    WHEN status = 'succeeded'
      THEN json_object('summary', 'Local demo execution completed', 'output', json_object('records', 24))
    ELSE NULL
  END,
  CASE
    WHEN status = 'failed'
      THEN json_object('code', 'UPSTREAM_500', 'message', '演示：上游服务返回明确失败')
    WHEN status = 'unknown'
      THEN json_object('code', 'RPC_OUTCOME_UNKNOWN', 'message', '演示：未能确认 Worker 最终结果')
    WHEN status = 'retry_wait'
      THEN json_object('code', 'UPSTREAM_RATE_LIMIT', 'message', '演示：等待安全自动重试')
    ELSE NULL
  END,
  occurred_at, now_ms
FROM prepared
WHERE true
ON CONFLICT(id) DO UPDATE SET
  status = excluded.status,
  reason_code = excluded.reason_code,
  available_at = excluded.available_at,
  next_attempt_reason = excluded.next_attempt_reason,
  attempt_count = excluded.attempt_count,
  attempt_limit = excluded.attempt_limit,
  max_auto_attempts = excluded.max_auto_attempts,
  retry_deadline_at = excluded.retry_deadline_at,
  started_at = excluded.started_at,
  finished_at = excluded.finished_at,
  result_json = excluded.result_json,
  last_error_json = excluded.last_error_json,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;

INSERT INTO attempts (
  id, execution_id, number, reason, status, lease_token,
  started_at, deadline_at, finished_at, duration_ms,
  result_json, error_json, target_build_id
)
SELECT
  'demo-attempt:' || e.id,
  e.id,
  1,
  'initial',
  CASE
    WHEN e.status = 'succeeded' THEN 'succeeded'
    WHEN e.status = 'unknown' THEN 'unknown'
    ELSE 'failed'
  END,
  'demo-lease:' || e.id,
  e.created_at,
  e.created_at + 30000,
  e.created_at + 12000,
  12000,
  CASE WHEN e.status = 'succeeded' THEN e.result_json ELSE NULL END,
  CASE WHEN e.status <> 'succeeded' THEN e.last_error_json ELSE NULL END,
  'local-demo'
FROM executions e
WHERE e.id LIKE 'demo-exec-%' AND e.attempt_count > 0
ON CONFLICT(id) DO UPDATE SET
  status = excluded.status,
  started_at = excluded.started_at,
  deadline_at = excluded.deadline_at,
  finished_at = excluded.finished_at,
  duration_ms = excluded.duration_ms,
  result_json = excluded.result_json,
  error_json = excluded.error_json,
  target_build_id = excluded.target_build_id;

UPDATE platform_state
SET last_tick_id = 'local-demo-tick',
    last_tick_scheduled_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
    last_tick_started_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
    last_tick_finished_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
    last_successful_tick_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
    last_tick_outcome = 'succeeded',
    last_tick_error = NULL,
    build_version = 'local-demo',
    updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE id = 1;
