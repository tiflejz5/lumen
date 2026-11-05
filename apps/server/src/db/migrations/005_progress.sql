-- Etap 5: powtórki w odstępach i odznaki.

CREATE TABLE review_items (
  topic_id      TEXT PRIMARY KEY REFERENCES topics (id),
  stage         INTEGER NOT NULL DEFAULT 0,
  due_date      TEXT NOT NULL,                -- dzień nauki (RRRR-MM-DD)
  reps          INTEGER NOT NULL DEFAULT 0,
  lapses        INTEGER NOT NULL DEFAULT 0,
  last_reviewed TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;
CREATE INDEX idx_review_due ON review_items (due_date);

CREATE TABLE review_log (
  id           TEXT PRIMARY KEY,
  topic_id     TEXT NOT NULL REFERENCES topics (id),
  date         TEXT NOT NULL,                 -- dzień nauki wykonania
  rating       TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
  stage_before INTEGER NOT NULL,
  stage_after  INTEGER NOT NULL,
  reviewed_at  TEXT NOT NULL
) STRICT;
CREATE INDEX idx_review_log_date ON review_log (date);

CREATE TABLE badges (
  id          TEXT PRIMARY KEY,
  unlocked_at TEXT NOT NULL
) STRICT;

-- Tematy ukończone przed wprowadzeniem powtórek dostają pierwszą powtórkę dzień po ukończeniu.
INSERT INTO review_items (topic_id, stage, due_date, created_at, updated_at)
SELECT s.topic_id, 0, date(max(s.date), '+1 day'), min(s.finished_at), max(s.finished_at)
FROM study_sessions s
JOIN topic_user_state u ON u.topic_id = s.topic_id AND u.status = 'completed'
WHERE s.status = 'finished' AND s.outcome = 'completed'
GROUP BY s.topic_id;
