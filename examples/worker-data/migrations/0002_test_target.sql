CREATE TABLE scenario_queue (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL CHECK (mode IN (
    'success',
    'permanent_failure',
    'retryable_then_success',
    'throw_before_effect',
    'timeout_after_effect',
    'slow_success',
    'malformed_result',
    'identity_mismatch',
    'duplicate_idempotency',
    'non_idempotent_failure'
  )),
  delay_ms INTEGER NOT NULL DEFAULT 0 CHECK (delay_ms BETWEEN 0 AND 30000),
  created_at INTEGER NOT NULL
);

CREATE TABLE test_side_effects (
  idempotency_key TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE rpc_receipts (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  side_effect_count INTEGER NOT NULL CHECK (side_effect_count >= 0)
);

CREATE INDEX idx_rpc_receipts_execution
  ON rpc_receipts(execution_id, started_at, id);
