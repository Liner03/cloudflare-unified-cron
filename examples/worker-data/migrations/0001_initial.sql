CREATE TABLE idempotent_results (
  idempotency_key TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at INTEGER NOT NULL
);
