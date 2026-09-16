-- Apply once after 001_competitions.sql and 002_auth_security.sql.
CREATE INDEX IF NOT EXISTS ds_competitions_owner ON ds_competitions(owner,id);
CREATE TABLE IF NOT EXISTS ds_data_accounts (
  account_hash TEXT PRIMARY KEY,
  epoch INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'active',
  job_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ds_private_records (
  key_hash TEXT PRIMARY KEY,
  key_name TEXT,
  family TEXT NOT NULL,
  owner_hash TEXT NOT NULL DEFAULT '',
  owner_epoch INTEGER NOT NULL DEFAULT 0,
  body TEXT,
  mask TEXT NOT NULL DEFAULT '{}',
  deleted INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  last_op TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ds_private_records_names ON ds_private_records(key_name);
CREATE TABLE IF NOT EXISTS ds_private_chunks (
  key_hash TEXT NOT NULL REFERENCES ds_private_records(key_hash),
  part INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY(key_hash,part)
);
CREATE TABLE IF NOT EXISTS ds_private_parties (
  key_hash TEXT NOT NULL REFERENCES ds_private_records(key_hash),
  account_hash TEXT NOT NULL,
  PRIMARY KEY(key_hash, account_hash)
);
CREATE INDEX IF NOT EXISTS ds_private_parties_account ON ds_private_parties(account_hash,key_hash);
CREATE TABLE IF NOT EXISTS ds_private_import_cursors (
  account_hash TEXT NOT NULL,
  family TEXT NOT NULL,
  cursor TEXT NOT NULL DEFAULT '',
  work TEXT NOT NULL DEFAULT '{}',
  complete INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(account_hash,family)
);
CREATE TABLE IF NOT EXISTS ds_account_deletions (
  id TEXT PRIMARY KEY,
  account_hash TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  phase INTEGER NOT NULL DEFAULT 0,
  cursor TEXT NOT NULL DEFAULT '',
  work TEXT NOT NULL DEFAULT '{}',
  epoch INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ds_account_deletions_account ON ds_account_deletions(account_hash);
ALTER TABLE ds_competition_sessions ADD COLUMN account_epoch INTEGER NOT NULL DEFAULT 0;

-- Separate purpose: these codes/receipts never authorize login or private reads.
CREATE TABLE IF NOT EXISTS ds_deletion_challenges (
  account_hash TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  account_epoch INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  ready INTEGER NOT NULL DEFAULT 0,
  receipt_hash TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ds_deletion_challenges_expiry ON ds_deletion_challenges(expires);
