PRAGMA foreign_keys = ON;

-- One read projection owns dispatch eligibility for list filters, detail views,
-- and aggregate counts. Keep the individual factors so the API can explain
-- every reason an otherwise active Managed Schedule is blocked.
CREATE VIEW managed_schedule_effective_state AS
SELECT
  s.id AS schedule_id,
  s.enabled AS schedule_enabled,
  s.declared_enabled,
  s.operator_paused,
  t.enabled AS target_enabled,
  p.dispatch_paused,
  CASE
    WHEN s.enabled = 1
      AND s.declared_enabled = 1
      AND s.operator_paused = 0
      AND t.enabled = 1
      AND p.dispatch_paused = 0
    THEN 1
    ELSE 0
  END AS effective_enabled
FROM schedules s
JOIN targets t ON t.id = s.target_id
JOIN platform_state p ON p.id = 1
WHERE s.managed_by_registration = 1 AND s.retired_at IS NULL;
