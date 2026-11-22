-- Countdown timer database (SQLite)
-- Created automatically by install.php. Dates are stored as local time text ('2026-11-22 14:30:00'),
-- written by PHP (see db_time() in includes/functions.php).

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  last_login_at TEXT NULL,
  created_at    TEXT NOT NULL
);

-- Key/value settings. The timer itself lives in 'timer_state' (JSON, see includes/timer.php).
CREATE TABLE IF NOT EXISTS settings (
  name  TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY,
  ip_hash    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY,
  admin_id   INTEGER NULL,
  action     TEXT NOT NULL,
  details    TEXT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_log_created ON activity_log (created_at);

-- Screens showing screen.php (last_seen is refreshed every 5 seconds while they are connected)
CREATE TABLE IF NOT EXISTS screens (
  id         TEXT PRIMARY KEY,
  name       TEXT NULL,
  size       TEXT NULL,
  user_agent TEXT NULL,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS screens_seen ON screens (last_seen);
