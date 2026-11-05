-- Etap 1: fundament. Tabele domenowe dochodzą w kolejnych etapach (osobne migracje).
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,   -- JSON
  updated_at TEXT NOT NULL
) STRICT;
