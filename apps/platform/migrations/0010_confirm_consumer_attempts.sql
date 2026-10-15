-- A reservation can survive a lost D1 acknowledgement before RPC ever starts.
-- Only a returned result or caught invocation error confirms that it was used.
ALTER TABLE trigger_consumer_attempts ADD COLUMN invoked INTEGER NOT NULL DEFAULT 0 CHECK(invoked IN (0,1));
UPDATE trigger_deliveries SET consumer_attempts=NULL WHERE EXISTS(SELECT 1 FROM trigger_consumer_attempts WHERE delivery_id=trigger_deliveries.id);
