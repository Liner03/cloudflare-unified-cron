DELETE FROM api_idempotency;
DELETE FROM audit_events;
DELETE FROM attempts;
DELETE FROM executions;
DELETE FROM schedules;
DELETE FROM registered_actions;
DELETE FROM registration_revisions;
DELETE FROM registrations;
DELETE FROM registration_tokens;
DELETE FROM admin_sessions;
DELETE FROM admin_login_limits;
UPDATE platform_state
SET dispatch_paused = 0,
    last_tick_id = NULL,
    last_tick_scheduled_at = NULL,
    last_tick_started_at = NULL,
    last_tick_finished_at = NULL,
    last_successful_tick_at = NULL,
    last_tick_outcome = NULL,
    last_tick_error = NULL,
    updated_at = 0
WHERE id = 1;
