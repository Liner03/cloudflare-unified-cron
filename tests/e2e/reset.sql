DELETE FROM audit_events
WHERE (
  entity_type = 'schedule'
  AND entity_id IN (SELECT id FROM schedules WHERE name LIKE 'E2E Health %')
)
OR (
  entity_type = 'execution'
  AND entity_id IN (
    SELECT e.id
    FROM executions e
    JOIN schedules s ON s.id = e.schedule_id
    WHERE s.name LIKE 'E2E Health %'
  )
);

DELETE FROM attempts
WHERE execution_id IN (
  SELECT e.id
  FROM executions e
  JOIN schedules s ON s.id = e.schedule_id
  WHERE s.name LIKE 'E2E Health %'
);

DELETE FROM executions
WHERE schedule_id IN (
  SELECT id FROM schedules WHERE name LIKE 'E2E Health %'
);

DELETE FROM schedules WHERE name LIKE 'E2E Health %';
