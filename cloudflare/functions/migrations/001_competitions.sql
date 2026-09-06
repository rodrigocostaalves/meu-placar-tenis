CREATE TABLE IF NOT EXISTS ds_competitions (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL,
  data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0,
  last_op TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ds_competition_members (
  competition_id TEXT NOT NULL REFERENCES ds_competitions(id), email TEXT NOT NULL,
  PRIMARY KEY (competition_id, email)
);
CREATE INDEX IF NOT EXISTS ds_members_email ON ds_competition_members(email, competition_id);
CREATE TABLE IF NOT EXISTS ds_competition_sessions (
  token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ds_sessions_expiry ON ds_competition_sessions(expires);
CREATE TABLE IF NOT EXISTS ds_competition_imports (email TEXT PRIMARY KEY, next_index INTEGER NOT NULL DEFAULT 0, complete INTEGER NOT NULL DEFAULT 0);
