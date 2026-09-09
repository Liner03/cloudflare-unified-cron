PRAGMA foreign_keys = ON;

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE admin_login_limits (
  key_hash TEXT PRIMARY KEY,
  failed_attempts INTEGER NOT NULL CHECK (failed_attempts >= 0),
  window_started_at INTEGER NOT NULL,
  blocked_until INTEGER
);
CREATE INDEX idx_admin_login_limits_expiry
  ON admin_login_limits(blocked_until);

CREATE TABLE registration_tokens (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES targets(id),
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL DEFAULT 'registration:write'
    CHECK (scope = 'registration:write'),
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_registration_tokens_target
  ON registration_tokens(target_id, created_at DESC);
CREATE INDEX idx_registration_tokens_expiry
  ON registration_tokens(expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE registrations (
  target_id TEXT PRIMARY KEY REFERENCES targets(id),
  registration_revision TEXT NOT NULL,
  document_hash TEXT NOT NULL,
  worker_label TEXT NOT NULL,
  registered_at INTEGER NOT NULL,
  token_id TEXT NOT NULL REFERENCES registration_tokens(id)
);

CREATE TABLE registered_actions (
  target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  idempotent INTEGER NOT NULL CHECK (idempotent IN (0, 1)),
  example_payload_json TEXT CHECK (
    example_payload_json IS NULL OR json_valid(example_payload_json)
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(target_id, name, version)
);

ALTER TABLE schedules ADD COLUMN registration_key TEXT;
ALTER TABLE schedules ADD COLUMN managed_by_registration INTEGER NOT NULL DEFAULT 0
  CHECK (managed_by_registration IN (0, 1));
ALTER TABLE schedules ADD COLUMN declared_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (declared_enabled IN (0, 1));
ALTER TABLE schedules ADD COLUMN operator_paused INTEGER NOT NULL DEFAULT 0
  CHECK (operator_paused IN (0, 1));
ALTER TABLE schedules ADD COLUMN retired_at INTEGER;

CREATE UNIQUE INDEX uq_schedule_registration_key
  ON schedules(target_id, registration_key)
  WHERE managed_by_registration = 1;

CREATE INDEX idx_schedules_registration
  ON schedules(target_id, managed_by_registration, retired_at);
