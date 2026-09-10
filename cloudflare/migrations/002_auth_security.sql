-- Additive only. Apply to the existing COMPETITIONS_DB; preserve previous migrations.
CREATE TABLE IF NOT EXISTS ds_auth_challenges (
  email TEXT PRIMARY KEY, id TEXT NOT NULL, code_hash TEXT NOT NULL,
  expires INTEGER NOT NULL, sent_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, ready INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ds_auth_challenges_expiry ON ds_auth_challenges(expires);
CREATE TABLE IF NOT EXISTS ds_auth_limits (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ds_auth_limits_expiry ON ds_auth_limits(expires);
