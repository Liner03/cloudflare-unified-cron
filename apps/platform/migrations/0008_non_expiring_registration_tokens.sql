PRAGMA foreign_keys = ON;

ALTER TABLE registration_tokens
  ADD COLUMN no_expire INTEGER NOT NULL DEFAULT 0
  CHECK (no_expire IN (0, 1));
