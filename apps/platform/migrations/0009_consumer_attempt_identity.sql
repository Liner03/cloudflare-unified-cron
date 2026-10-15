-- Queue-local retry indexes cannot reconstruct business invocation counts.
-- Preserve uncertainty for receipts written before durable attempt identities.
UPDATE trigger_deliveries SET consumer_attempts = NULL;

CREATE TABLE trigger_consumer_attempts (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES trigger_deliveries(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number >= 1),
  started_at INTEGER NOT NULL,
  UNIQUE(delivery_id, number)
);
