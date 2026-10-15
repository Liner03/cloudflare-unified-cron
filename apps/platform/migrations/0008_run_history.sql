-- Consumer attempts are business invocations, distinct from producer send attempts.
-- NULL preserves the uncertainty of historical receipts.
ALTER TABLE trigger_deliveries ADD COLUMN consumer_attempts INTEGER;
ALTER TABLE trigger_deliveries ADD COLUMN consumer_started_at INTEGER;
ALTER TABLE trigger_deliveries ADD COLUMN consumer_error TEXT;

CREATE VIEW run_history AS
SELECT e.id, e.schedule_id, e.target_id, e.source, 'rpc' AS mode,
       e.status, NULL AS delivery_status, e.attempt_count,
       e.scheduled_for, e.created_at, e.started_at, e.finished_at,
       e.available_at, e.reason_code,
       json_extract(e.result_json, '$.summary') AS summary,
       s.name AS schedule_name, t.label AS target_label
FROM executions e
LEFT JOIN schedules s ON s.id = e.schedule_id
LEFT JOIN targets t ON t.id = e.target_id
UNION ALL
SELECT d.id, d.schedule_id, d.target_id, 'cron', 'queue',
       CASE
         WHEN d.result_json IS NOT NULL THEN json_extract(d.result_json, '$.status')
         WHEN d.consumer_error IS NOT NULL THEN 'retry_wait'
         WHEN d.consumer_started_at IS NOT NULL THEN 'running'
         WHEN d.status = 'queued' THEN 'unreported'
         WHEN d.status = 'sending' THEN 'pending'
         ELSE d.status
       END,
       d.status, d.consumer_attempts, d.scheduled_for, d.created_at,
       d.consumer_started_at, d.result_at, d.available_at,
       COALESCE(d.consumer_error, d.last_error),
       json_extract(d.result_json, '$.summary'), s.name, t.label
FROM trigger_deliveries d
LEFT JOIN schedules s ON s.id = d.schedule_id
LEFT JOIN targets t ON t.id = d.target_id;
