-- Deterministic local-only fixtures for exercising the operator-first UI.
-- This file never runs as a migration or production seed.
PRAGMA foreign_keys = ON;

WITH demo_targets(
  id, label, enabled, manifest_revision, last_check_status, last_check_message
) AS (
  VALUES
    ('SEARCH', 'Search Worker', 1, 'local-demo-search-v1', 'compatible', 'Local demo binding is healthy'),
    ('STOREFRONT', 'Storefront Worker', 1, 'local-demo-storefront-v1', 'compatible', 'Local demo binding is healthy'),
    ('ANALYTICS', 'Analytics Worker', 0, 'local-demo-analytics-v1', 'unreachable', 'Local demo site is intentionally offline')
)
INSERT INTO targets (
  id, label, enabled, manifest_revision, last_check_at, last_check_status,
  last_check_message, created_at, updated_at
)
SELECT
  id, label, enabled, manifest_revision,
  CAST(unixepoch('subsec') * 1000 AS INTEGER), last_check_status,
  last_check_message, CAST(unixepoch('subsec') * 1000 AS INTEGER),
  CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM demo_targets
WHERE true
ON CONFLICT(id) DO UPDATE SET
  label = excluded.label,
  enabled = excluded.enabled,
  manifest_revision = excluded.manifest_revision,
  last_check_at = excluded.last_check_at,
  last_check_status = excluded.last_check_status,
  last_check_message = excluded.last_check_message,
  updated_at = excluded.updated_at;

WITH demo_tokens(id, target_id, label, token_hash) AS (
  VALUES
    ('demo-seed-token', 'DATA', 'Local demo fixture', '0000000000000000000000000000000000000000000000000000000000000000'),
    ('demo-search-token', 'SEARCH', 'Local Search fixture', '1111111111111111111111111111111111111111111111111111111111111111'),
    ('demo-storefront-token', 'STOREFRONT', 'Local Storefront fixture', '2222222222222222222222222222222222222222222222222222222222222222'),
    ('demo-analytics-token', 'ANALYTICS', 'Local Analytics fixture', '3333333333333333333333333333333333333333333333333333333333333333')
)
INSERT INTO registration_tokens (
  id, target_id, label, token_hash, scope, expires_at,
  last_used_at, revoked_at, created_by, created_at
) SELECT
  id, target_id, label, token_hash,
  'registration:write', 4102444800000, NULL, NULL, 'local-demo',
  CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM demo_tokens
WHERE true
ON CONFLICT(id) DO UPDATE SET
  label = excluded.label,
  expires_at = excluded.expires_at,
  revoked_at = NULL;

WITH demo_registrations(
  target_id, registration_revision, document_hash, worker_label, token_id
) AS (
  VALUES
    ('DATA', 'local-demo-2026-09-10', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'Data Worker', 'demo-seed-token'),
    ('SEARCH', 'local-demo-search-2026-09-10', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'Search Worker', 'demo-search-token'),
    ('STOREFRONT', 'local-demo-storefront-2026-09-10', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'Storefront Worker', 'demo-storefront-token'),
    ('ANALYTICS', 'local-demo-analytics-2026-09-10', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Analytics Worker', 'demo-analytics-token')
)
INSERT INTO registrations (
  target_id, registration_revision, document_hash, worker_label,
  registered_at, token_id
)
SELECT
  target_id, registration_revision, document_hash, worker_label,
  CAST(unixepoch('subsec') * 1000 AS INTEGER), token_id
FROM demo_registrations
WHERE true
ON CONFLICT(target_id) DO UPDATE SET
  registration_revision = excluded.registration_revision,
  document_hash = excluded.document_hash,
  worker_label = excluded.worker_label,
  registered_at = excluded.registered_at,
  token_id = excluded.token_id;

WITH demo_registrations(
  target_id, registration_revision, document_hash, token_id
) AS (
  VALUES
    ('DATA', 'local-demo-2026-09-10', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'demo-seed-token'),
    ('SEARCH', 'local-demo-search-2026-09-10', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'demo-search-token'),
    ('STOREFRONT', 'local-demo-storefront-2026-09-10', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'demo-storefront-token'),
    ('ANALYTICS', 'local-demo-analytics-2026-09-10', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'demo-analytics-token')
)
INSERT INTO registration_revisions (
  target_id, registration_revision, document_hash, first_seen_at, token_id
)
SELECT
  target_id, registration_revision, document_hash,
  CAST(unixepoch('subsec') * 1000 AS INTEGER), token_id
FROM demo_registrations
WHERE true
ON CONFLICT(target_id, registration_revision) DO NOTHING;

WITH actions(target_id, name, version, label, description, idempotent) AS (
  VALUES
    ('DATA', 'contentSync', 1, '内容同步', '同步网站内容与索引', 1),
    ('DATA', 'inventoryRefresh', 1, '库存刷新', '刷新商品库存缓存', 1),
    ('DATA', 'dailyDigest', 1, '每日摘要', '生成每日业务摘要', 1),
    ('DATA', 'cacheCleanup', 1, '缓存清理', '清理过期缓存记录', 1),
    ('DATA', 'sitemapGenerate', 1, '站点地图', '重新生成 sitemap', 1),
    ('DATA', 'newsletterDigest', 1, '邮件摘要', '准备订阅邮件摘要', 1),
    ('DATA', 'feedImport', 1, 'Feed 导入', '导入外部内容源', 1),
    ('DATA', 'orderReconcile', 1, '订单核对', '核对支付与订单状态', 0),
    ('SEARCH', 'indexRefresh', 1, '索引刷新', '增量刷新全文搜索索引', 1),
    ('SEARCH', 'synonymSync', 1, '同义词同步', '同步搜索同义词词典', 1),
    ('SEARCH', 'queryMetrics', 1, '查询指标归档', '归档搜索查询指标', 1),
    ('STOREFRONT', 'catalogPublish', 1, '目录发布', '发布最新商品目录', 1),
    ('STOREFRONT', 'priceRefresh', 1, '价格刷新', '刷新区域价格缓存', 1),
    ('STOREFRONT', 'cachePrime', 1, '页面预热', '预热核心商品页面缓存', 1),
    ('STOREFRONT', 'abandonedCart', 1, '购物车提醒', '准备放弃购物车提醒', 1),
    ('ANALYTICS', 'hourlyRollup', 1, '小时聚合', '聚合网站访问指标', 1),
    ('ANALYTICS', 'dailyExport', 1, '日报导出', '导出每日分析报表', 1)
)
INSERT INTO registered_actions (
  target_id, name, version, label, description, idempotent,
  example_payload_json, created_at, updated_at
)
SELECT
  target_id, name, version, label, description, idempotent, '{}',
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
  id, target_id, registration_key, name, description, action, cron_expression,
  enabled, declared_enabled, operator_paused, next_offset_minutes,
  retry_policy_json
) AS (
  VALUES
    ('demo-content-sync', 'DATA', 'demo-content-sync', '内容同步', '同步文章、标签与搜索索引', 'contentSync', '*/5 * * * *', 1, 1, 0, 5, '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}'),
    ('demo-inventory-refresh', 'DATA', 'demo-inventory-refresh', '库存刷新', '刷新商品库存缓存', 'inventoryRefresh', '*/10 * * * *', 1, 1, 0, 10, '{"maxAttempts":2,"delaysSeconds":[60],"retryOnUnknown":true}'),
    ('demo-daily-digest', 'DATA', 'demo-daily-digest', '每日摘要', '每天生成业务摘要', 'dailyDigest', '0 9 * * *', 1, 1, 0, 180, '{"maxAttempts":2,"delaysSeconds":[300],"retryOnUnknown":false}'),
    ('demo-cache-cleanup', 'DATA', 'demo-cache-cleanup', '缓存清理', '每六小时清理过期缓存', 'cacheCleanup', '0 */6 * * *', 1, 1, 0, 240, '{"maxAttempts":3,"delaysSeconds":[60,300],"retryOnUnknown":false}'),
    ('demo-sitemap', 'DATA', 'demo-sitemap', '站点地图生成', '重新生成 sitemap.xml', 'sitemapGenerate', '0 2 * * *', 1, 1, 0, 360, '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}'),
    ('demo-newsletter', 'DATA', 'demo-newsletter', '邮件摘要', '网站声明暂时停用', 'newsletterDigest', '0 8 * * 1', 0, 0, 0, NULL, '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}'),
    ('demo-feed-import', 'DATA', 'demo-feed-import', '外部 Feed 导入', '当前配置失效，等待网站重新发布', 'feedImport', '15 * * * *', 0, 1, 0, NULL, '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}'),
    ('demo-order-reconcile', 'DATA', 'demo-order-reconcile', '订单核对', '维护期间由管理员暂停', 'orderReconcile', '*/15 * * * *', 0, 1, 1, NULL, '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}'),
    ('demo-search-index', 'SEARCH', 'demo-search-index', '搜索索引刷新', '增量刷新全文搜索索引', 'indexRefresh', '*/15 * * * *', 1, 1, 0, 12, '{"maxAttempts":2,"delaysSeconds":[90],"retryOnUnknown":false}'),
    ('demo-search-synonyms', 'SEARCH', 'demo-search-synonyms', '同义词同步', '同步搜索同义词词典', 'synonymSync', '0 */4 * * *', 1, 1, 0, 95, '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}'),
    ('demo-search-metrics', 'SEARCH', 'demo-search-metrics', '查询指标归档', '归档热门搜索词与零结果查询', 'queryMetrics', '10 * * * *', 1, 1, 0, 35, '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}'),
    ('demo-store-catalog', 'STOREFRONT', 'demo-store-catalog', '商品目录发布', '发布最新商品目录', 'catalogPublish', '*/20 * * * *', 1, 1, 0, 18, '{"maxAttempts":2,"delaysSeconds":[60],"retryOnUnknown":false}'),
    ('demo-store-prices', 'STOREFRONT', 'demo-store-prices', '区域价格刷新', '刷新区域价格与促销缓存', 'priceRefresh', '5 */2 * * *', 1, 1, 0, 75, '{"maxAttempts":2,"delaysSeconds":[120],"retryOnUnknown":false}'),
    ('demo-store-cache', 'STOREFRONT', 'demo-store-cache', '核心页面预热', '预热高流量商品页面缓存', 'cachePrime', '*/30 * * * *', 1, 1, 0, 28, '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}'),
    ('demo-store-cart', 'STOREFRONT', 'demo-store-cart', '购物车提醒', '网站声明暂时停用', 'abandonedCart', '0 */3 * * *', 0, 0, 0, NULL, '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}'),
    ('demo-analytics-rollup', 'ANALYTICS', 'demo-analytics-rollup', '小时指标聚合', '聚合网站访问与转化指标', 'hourlyRollup', '5 * * * *', 1, 1, 0, 45, '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}'),
    ('demo-analytics-export', 'ANALYTICS', 'demo-analytics-export', '分析日报导出', '导出每日分析报表', 'dailyExport', '30 3 * * *', 1, 1, 0, 420, '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}')
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
  id, name, description, target_id, action, 1,
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
    ('demo-exec-order-1', 'demo-order-reconcile', 'skipped', 'TARGET_DISABLED', 95, 0),
    ('demo-exec-search-index-1', 'demo-search-index', 'succeeded', NULL, 30, 1),
    ('demo-exec-search-index-2', 'demo-search-index', 'succeeded', NULL, 260, 1),
    ('demo-exec-search-synonyms-1', 'demo-search-synonyms', 'succeeded', NULL, 110, 1),
    ('demo-exec-search-metrics-1', 'demo-search-metrics', 'succeeded', NULL, 70, 1),
    ('demo-exec-store-catalog-1', 'demo-store-catalog', 'succeeded', NULL, 20, 1),
    ('demo-exec-store-catalog-2', 'demo-store-catalog', 'succeeded', NULL, 380, 1),
    ('demo-exec-store-prices-1', 'demo-store-prices', 'succeeded', NULL, 75, 1),
    ('demo-exec-store-cache-1', 'demo-store-cache', 'succeeded', NULL, 10, 1),
    ('demo-exec-analytics-rollup-1', 'demo-analytics-rollup', 'skipped', 'TARGET_DISABLED', 45, 0),
    ('demo-exec-analytics-export-1', 'demo-analytics-export', 'skipped', 'TARGET_DISABLED', 620, 0)
), prepared AS (
  SELECT
    f.*,
    s.target_id,
    t.manifest_revision AS target_manifest_revision,
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
  JOIN targets t ON t.id = s.target_id
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
  id, schedule_id, target_id, 'cron', occurred_at, NULL,
  'demo:' || id, schedule_revision,
  json_object(
    'scheduleId', schedule_id,
    'scheduleRevision', schedule_revision,
    'targetId', target_id,
    'action', action,
    'actionVersion', action_version,
    'targetManifestRevision', target_manifest_revision,
    'targetActionIdempotent', json('true'),
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
