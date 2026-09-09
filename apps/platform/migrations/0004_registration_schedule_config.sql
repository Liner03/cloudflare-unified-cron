PRAGMA foreign_keys = ON;

DROP TRIGGER enforce_managed_schedule_limit_on_insert;

-- An AFTER trigger lets SQLite resolve an UPSERT conflict before enforcing the
-- global limit. A valid update at the 50-schedule ceiling therefore succeeds,
-- while a real insert that would create schedule 51 still aborts atomically.
CREATE TRIGGER enforce_managed_schedule_limit_on_insert
AFTER INSERT ON schedules
WHEN NEW.managed_by_registration = 1
  AND NEW.retired_at IS NULL
  AND (
    SELECT COUNT(*) FROM schedules
    WHERE managed_by_registration = 1 AND retired_at IS NULL
  ) > 50
BEGIN
  SELECT RAISE(ABORT, 'MANAGED_SCHEDULE_LIMIT_REACHED');
END;

ALTER TABLE schedules ADD COLUMN registration_config_hash TEXT;
