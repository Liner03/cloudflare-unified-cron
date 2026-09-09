PRAGMA foreign_keys = ON;

CREATE TABLE registration_revisions (
  target_id TEXT NOT NULL REFERENCES targets(id),
  registration_revision TEXT NOT NULL,
  document_hash TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  token_id TEXT NOT NULL REFERENCES registration_tokens(id),
  PRIMARY KEY(target_id, registration_revision)
);

INSERT INTO registration_revisions (
  target_id, registration_revision, document_hash, first_seen_at, token_id
)
SELECT target_id, registration_revision, document_hash, registered_at, token_id
FROM registrations;

ALTER TABLE registration_tokens
  ADD COLUMN rotated_from_id TEXT REFERENCES registration_tokens(id);
ALTER TABLE registration_tokens
  ADD COLUMN replaced_by_id TEXT REFERENCES registration_tokens(id);

CREATE UNIQUE INDEX uq_registration_token_rotation
  ON registration_tokens(rotated_from_id)
  WHERE rotated_from_id IS NOT NULL;

CREATE TRIGGER enforce_managed_schedule_limit_on_insert
BEFORE INSERT ON schedules
WHEN NEW.managed_by_registration = 1
  AND NEW.retired_at IS NULL
  AND (
    SELECT COUNT(*) FROM schedules
    WHERE managed_by_registration = 1 AND retired_at IS NULL
  ) >= 50
BEGIN
  SELECT RAISE(ABORT, 'MANAGED_SCHEDULE_LIMIT_REACHED');
END;

CREATE TRIGGER enforce_managed_schedule_limit_on_reactivation
BEFORE UPDATE OF managed_by_registration, retired_at ON schedules
WHEN NEW.managed_by_registration = 1
  AND NEW.retired_at IS NULL
  AND (OLD.managed_by_registration = 0 OR OLD.retired_at IS NOT NULL)
  AND (
    SELECT COUNT(*) FROM schedules
    WHERE managed_by_registration = 1 AND retired_at IS NULL
  ) >= 50
BEGIN
  SELECT RAISE(ABORT, 'MANAGED_SCHEDULE_LIMIT_REACHED');
END;
