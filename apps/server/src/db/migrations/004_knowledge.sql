-- Etap 4: osobista baza wiedzy (pojęcia z definicjami i powiązaniami [[termin]]).
-- Powiązania nie mają osobnej tabeli: są odczytywane z treści definicji, więc nie mogą się rozjechać.

CREATE TABLE knowledge_entries (
  id         TEXT PRIMARY KEY,
  term       TEXT NOT NULL,
  term_key   TEXT NOT NULL,              -- znormalizowany termin (bez wielkości liter i znaków diakrytycznych)
  definition TEXT NOT NULL,
  topic_id   TEXT REFERENCES topics (id), -- temat, z którego pochodzi pojęcie (opcjonalnie)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;
CREATE UNIQUE INDEX idx_knowledge_term ON knowledge_entries (term_key) WHERE deleted_at IS NULL;
CREATE INDEX idx_knowledge_topic ON knowledge_entries (topic_id);
