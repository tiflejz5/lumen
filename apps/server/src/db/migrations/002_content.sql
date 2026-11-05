-- Etap 2: baza tematów, import, katalog tytułów, stan użytkownika i temat dnia.
-- Dane użytkownika (topic_user_state, daily_assignments) są w osobnych tabelach i nigdy nie są
-- modyfikowane przez import.

-- Metadane wydania: taksonomia (JSON), base_version, schema_version, taxonomy_version.
CREATE TABLE content_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE sources (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,            -- pełny rekord źródła (JSON)
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE topics (
  id                     TEXT PRIMARY KEY,
  slug                   TEXT NOT NULL UNIQUE,
  title                  TEXT NOT NULL,
  category               TEXT NOT NULL,
  subcategory            TEXT NOT NULL,
  difficulty_level       TEXT NOT NULL CHECK (difficulty_level IN ('beginner', 'intermediate', 'advanced')),
  topic_type             TEXT NOT NULL CHECK (topic_type IN ('timeless', 'current')),
  status                 TEXT NOT NULL CHECK (status IN ('active', 'deprecated')),
  revision               INTEGER NOT NULL,
  content_hash           TEXT NOT NULL,   -- skrót treści bez bloku freshness
  last_verified_at       TEXT NOT NULL,
  review_interval_months INTEGER,
  is_example             INTEGER NOT NULL DEFAULT 0,
  data                   TEXT NOT NULL,   -- pełny rekord tematu (JSON)
  imported_at            TEXT NOT NULL,
  updated_at             TEXT NOT NULL
) STRICT;
CREATE INDEX idx_topics_category ON topics (category);
CREATE INDEX idx_topics_status ON topics (status);

-- Historia treści: każda zatwierdzona wersja zostaje.
CREATE TABLE topic_versions (
  topic_id     TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  revision     INTEGER NOT NULL,
  data         TEXT NOT NULL,
  import_id    TEXT NOT NULL,
  imported_at  TEXT NOT NULL,
  PRIMARY KEY (topic_id, content_hash)
) STRICT;

CREATE TABLE topic_relations (
  from_id TEXT NOT NULL,
  to_id   TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('prerequisites', 'related', 'next')),
  PRIMARY KEY (from_id, to_id, kind)
) STRICT;
CREATE INDEX idx_relations_to ON topic_relations (to_id);

CREATE TABLE imports (
  id             TEXT PRIMARY KEY,
  created_at     TEXT NOT NULL,
  mode           TEXT NOT NULL CHECK (mode IN ('release', 'single')),
  base_version   TEXT,
  schema_version TEXT,
  summary        TEXT NOT NULL,         -- JSON: liczniki
  report         TEXT NOT NULL,         -- JSON: szczegóły per temat
  snapshot       TEXT                   -- nazwa kopii wykonanej przed importem
) STRICT;

-- Katalog zaplanowanych tytułów (nie są jeszcze pełnymi tematami).
CREATE TABLE catalog_entries (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  category        TEXT NOT NULL,
  subcategory     TEXT NOT NULL,
  difficulty      TEXT NOT NULL,
  topic_type      TEXT NOT NULL,
  current_subtype TEXT,
  question_type   TEXT,
  mainstream      INTEGER,
  region          TEXT,
  catalog_version TEXT NOT NULL,
  imported_at     TEXT NOT NULL
) STRICT;

-- Stan tematu u użytkownika. Brak wiersza = temat nowy.
CREATE TABLE topic_user_state (
  topic_id        TEXT PRIMARY KEY REFERENCES topics (id),
  status          TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'skipped', 'postponed', 'known', 'not_interesting')),
  postponed_until TEXT,
  deepen          INTEGER NOT NULL DEFAULT 0,
  status_date     TEXT,
  updated_at      TEXT NOT NULL
) STRICT;

-- Temat dnia jest przypisany do konkretnej daty nauki i się nie zmienia po ponownym otwarciu aplikacji.
CREATE TABLE daily_assignments (
  date        TEXT PRIMARY KEY,
  topic_id    TEXT NOT NULL REFERENCES topics (id),
  category    TEXT NOT NULL,
  explanation TEXT NOT NULL,            -- JSON: składniki wyniku losowania
  assigned_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_daily_topic ON daily_assignments (topic_id);
