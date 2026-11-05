-- Etap 3: sesje nauki, odpowiedzi w quizie i notatki.
-- Rekordy użytkownika mają UUIDv7 i `updated_at` (przygotowanie pod synchronizację).

CREATE TABLE study_sessions (
  id                TEXT PRIMARY KEY,
  topic_id          TEXT NOT NULL REFERENCES topics (id),
  date              TEXT NOT NULL,                 -- dzień nauki, w którym sesję rozpoczęto
  is_daily          INTEGER NOT NULL DEFAULT 0,    -- 1 = temat dnia (zaliczenie dnia)
  stage             TEXT NOT NULL CHECK (stage IN ('research', 'check', 'speaking', 'done')),
  status            TEXT NOT NULL CHECK (status IN ('active', 'finished')),
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  active_seconds    INTEGER NOT NULL DEFAULT 0,    -- czas aktywnej nauki zgłaszany przez timer
  outcome           TEXT CHECK (outcome IN ('completed', 'partial')),
  interest          INTEGER CHECK (interest BETWEEN 1 AND 5),
  difficulty_rating TEXT CHECK (difficulty_rating IN ('too_easy', 'right', 'too_hard')),
  confidence        INTEGER CHECK (confidence BETWEEN 1 AND 5),
  updated_at        TEXT NOT NULL
) STRICT;
CREATE INDEX idx_sessions_topic ON study_sessions (topic_id);
CREATE INDEX idx_sessions_date ON study_sessions (date);
CREATE UNIQUE INDEX idx_sessions_one_active ON study_sessions (topic_id) WHERE status = 'active';

CREATE TABLE quiz_answers (
  session_id  TEXT NOT NULL REFERENCES study_sessions (id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  answer      TEXT NOT NULL,
  correct     INTEGER NOT NULL,
  answered_at TEXT NOT NULL,
  PRIMARY KEY (session_id, question_id)
) STRICT;

CREATE TABLE notes (
  id         TEXT PRIMARY KEY,
  topic_id   TEXT NOT NULL REFERENCES topics (id),
  session_id TEXT REFERENCES study_sessions (id),
  kind       TEXT NOT NULL CHECK (kind IN ('note', 'summary', 'speaking', 'question')),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;
CREATE INDEX idx_notes_topic ON notes (topic_id);
