PRAGMA foreign_keys = ON;

CREATE TABLE targets (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  manifest_revision TEXT NOT NULL,
  last_check_at INTEGER,
  last_check_status TEXT CHECK (
    last_check_status IN ('compatible', 'incompatible', 'unreachable')
  ),
  last_check_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL REFERENCES targets(id),
  action TEXT NOT NULL,
  action_version INTEGER NOT NULL CHECK (action_version >= 1),
  cron_expression TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  archived_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  retry_policy_json TEXT NOT NULL CHECK (json_valid(retry_policy_json)),
  timeout_ms INTEGER NOT NULL DEFAULT 30000
    CHECK (timeout_ms BETWEEN 1000 AND 30000),
  misfire_policy TEXT NOT NULL DEFAULT 'coalesce'
    CHECK (misfire_policy IN ('coalesce', 'skip')),
  misfire_grace_seconds INTEGER NOT NULL DEFAULT 300
    CHECK (misfire_grace_seconds BETWEEN 0 AND 86400),
  next_run_at INTEGER,
  last_materialized_for INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (enabled = 0 OR archived_at IS NOT NULL OR next_run_at IS NOT NULL)
);

CREATE INDEX idx_schedules_due
  ON schedules(enabled, next_run_at, id)
  WHERE archived_at IS NULL;

CREATE TABLE executions (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id),
  target_id TEXT NOT NULL REFERENCES targets(id),
  source TEXT NOT NULL CHECK (source IN ('cron', 'manual', 'rerun')),
  scheduled_for INTEGER,
  parent_execution_id TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  schedule_revision INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'running', 'retry_wait', 'succeeded',
    'failed', 'unknown', 'skipped', 'cancelled'
  )),
  reason_code TEXT,
  coalesced_until INTEGER,
  available_at INTEGER NOT NULL,
  next_attempt_reason TEXT NOT NULL DEFAULT 'initial'
    CHECK (next_attempt_reason IN ('initial', 'automatic_retry', 'operator_retry')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  attempt_limit INTEGER NOT NULL CHECK (attempt_limit BETWEEN 1 AND 10),
  max_auto_attempts INTEGER NOT NULL CHECK (max_auto_attempts BETWEEN 1 AND 5),
  lease_token TEXT,
  lease_expires_at INTEGER,
  retry_deadline_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  last_error_json TEXT CHECK (last_error_json IS NULL OR json_valid(last_error_json)),
  operator_resolved_at INTEGER,
  operator_resolution_note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (source <> 'cron' OR scheduled_for IS NOT NULL),
  CHECK (attempt_count <= attempt_limit),
  CHECK (
    (status = 'running' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (status <> 'running' AND lease_token IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE UNIQUE INDEX uq_execution_cron_occurrence
  ON executions(schedule_id, scheduled_for)
  WHERE source = 'cron';

CREATE UNIQUE INDEX uq_execution_active_schedule
  ON executions(schedule_id)
  WHERE status IN ('pending', 'running', 'retry_wait', 'unknown');

CREATE INDEX idx_execution_ready
  ON executions(status, available_at, created_at, id)
  WHERE status IN ('pending', 'retry_wait');
CREATE INDEX idx_execution_expired_lease
  ON executions(lease_expires_at, id)
  WHERE status = 'running';
CREATE INDEX idx_execution_schedule_history
  ON executions(schedule_id, created_at DESC, id DESC);
CREATE INDEX idx_execution_recent
  ON executions(created_at DESC, id DESC);
CREATE INDEX idx_execution_status_history
  ON executions(status, created_at DESC, id DESC);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number >= 1),
  reason TEXT NOT NULL CHECK (reason IN ('initial', 'automatic_retry', 'operator_retry')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'unknown')),
  lease_token TEXT NOT NULL UNIQUE,
  started_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  finished_at INTEGER,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  target_build_id TEXT,
  UNIQUE(execution_id, number)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  changes_json TEXT NOT NULL CHECK (json_valid(changes_json)),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_events(created_at DESC, id DESC);

CREATE TABLE api_idempotency (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(scope, key)
);
CREATE INDEX idx_api_idempotency_expiry ON api_idempotency(expires_at);

CREATE TABLE platform_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  dispatch_paused INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_paused IN (0, 1)),
  last_tick_id TEXT,
  last_tick_scheduled_at INTEGER,
  last_tick_started_at INTEGER,
  last_tick_finished_at INTEGER,
  last_successful_tick_at INTEGER,
  last_tick_outcome TEXT,
  last_tick_error TEXT,
  build_version TEXT,
  updated_at INTEGER NOT NULL
);
INSERT INTO platform_state(id, updated_at) VALUES (1, 0);
