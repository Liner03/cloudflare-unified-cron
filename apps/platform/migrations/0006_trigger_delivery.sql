CREATE TABLE scheduler_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 1,
  max_schedules INTEGER NOT NULL DEFAULT 100 CHECK (max_schedules BETWEEN 1 AND 1000),
  materialize_budget INTEGER NOT NULL DEFAULT 100 CHECK (materialize_budget BETWEEN 1 AND 1000),
  delivery_budget INTEGER NOT NULL DEFAULT 100 CHECK (delivery_budget BETWEEN 1 AND 1000),
  rpc_budget INTEGER NOT NULL DEFAULT 10 CHECK (rpc_budget BETWEEN 1 AND 20),
  concurrency INTEGER NOT NULL DEFAULT 5 CHECK (concurrency BETWEEN 1 AND 10),
  per_target_batch INTEGER NOT NULL DEFAULT 10 CHECK (per_target_batch BETWEEN 1 AND 100)
);
INSERT INTO scheduler_settings (id) VALUES (1);

DROP TRIGGER enforce_managed_schedule_limit_on_insert;
DROP TRIGGER enforce_managed_schedule_limit_on_reactivation;
CREATE TRIGGER enforce_managed_schedule_limit_on_insert
AFTER INSERT ON schedules
WHEN NEW.managed_by_registration = 1 AND NEW.retired_at IS NULL
 AND (SELECT COUNT(*) FROM schedules WHERE managed_by_registration = 1 AND retired_at IS NULL)
   > (SELECT max_schedules FROM scheduler_settings WHERE id = 1)
BEGIN SELECT RAISE(ABORT, 'MANAGED_SCHEDULE_LIMIT_REACHED'); END;
CREATE TRIGGER enforce_managed_schedule_limit_on_reactivation
AFTER UPDATE OF managed_by_registration, retired_at ON schedules
WHEN NEW.managed_by_registration = 1 AND NEW.retired_at IS NULL
 AND (OLD.managed_by_registration = 0 OR OLD.retired_at IS NOT NULL)
 AND (SELECT COUNT(*) FROM schedules WHERE managed_by_registration = 1 AND retired_at IS NULL)
   > (SELECT max_schedules FROM scheduler_settings WHERE id = 1)
BEGIN SELECT RAISE(ABORT, 'MANAGED_SCHEDULE_LIMIT_REACHED'); END;

-- Separate delivery truth from legacy RPC Execution truth. Queued != succeeded.
CREATE TABLE trigger_deliveries (
 id TEXT PRIMARY KEY,
 schedule_id TEXT NOT NULL REFERENCES schedules(id),
 target_id TEXT NOT NULL REFERENCES targets(id),
 scheduled_for INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
 status TEXT NOT NULL CHECK (status IN ('pending','sending','unknown','queued','skipped','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0,
 available_at INTEGER NOT NULL,
 lease_token TEXT,
 lease_expires_at INTEGER,
 receipt_hash TEXT NOT NULL,
 queued_at INTEGER,
 last_error TEXT,
 result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
 result_at INTEGER,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(schedule_id, scheduled_for)
);
CREATE INDEX idx_delivery_ready ON trigger_deliveries(status, available_at);
CREATE INDEX idx_delivery_history ON trigger_deliveries(created_at DESC, id DESC);
CREATE INDEX idx_delivery_schedule ON trigger_deliveries(schedule_id, created_at DESC);
