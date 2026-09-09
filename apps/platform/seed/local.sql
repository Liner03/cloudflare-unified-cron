INSERT INTO targets (
  id, label, enabled, manifest_revision, created_at, updated_at
) VALUES (
  'DATA', 'Data Worker', 1, 'data-v1', unixepoch('subsec') * 1000, unixepoch('subsec') * 1000
)
ON CONFLICT(id) DO UPDATE SET
  label = excluded.label,
  manifest_revision = excluded.manifest_revision,
  updated_at = excluded.updated_at;

INSERT INTO schedules (
  id, name, description, target_id, action, action_version,
  cron_expression, timezone, enabled, revision, payload_json,
  retry_policy_json, timeout_ms, misfire_policy, misfire_grace_seconds,
  next_run_at, created_at, updated_at
) VALUES (
  'example-health-check', '示例健康检查', '本地暂停示例计划', 'DATA',
  'healthCheck', 1, '*/5 * * * *', 'UTC', 0, 1, '{}',
  '{"maxAttempts":1,"delaysSeconds":[],"retryOnUnknown":false}',
  30000, 'coalesce', 300, NULL,
  unixepoch('subsec') * 1000, unixepoch('subsec') * 1000
)
ON CONFLICT(id) DO NOTHING;
