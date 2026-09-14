-- The shared Queue can enqueue up to 100 messages per API call. Raise the
-- conservative development defaults so one Tick can drain a full 1,000-rule
-- schedule set in bounded 100-message claims.
UPDATE scheduler_settings
SET max_schedules = 1000,
    materialize_budget = 1000,
    delivery_budget = 1000,
    per_target_batch = 100,
    revision = revision + 1
WHERE id = 1
  AND max_schedules = 100
  AND materialize_budget = 100
  AND delivery_budget = 100
  AND per_target_batch = 10;
