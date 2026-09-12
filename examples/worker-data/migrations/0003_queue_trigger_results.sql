CREATE TABLE queue_trigger_results (
 idempotency_key TEXT PRIMARY KEY,
 payload_hash TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at INTEGER NOT NULL
);
CREATE TABLE queue_trigger_effects (
 idempotency_key TEXT PRIMARY KEY REFERENCES queue_trigger_results(idempotency_key),
 created_at INTEGER NOT NULL
);
