import {
  BADGES,
  evaluateBadges,
  nextReview,
  streakInfo,
  uuidv7,
  addDays,
  daysBetween,
  type BadgeInput,
  type BadgeStatus,
  type CategoryProgress,
  type DayActivity,
  type ReviewAnswer,
  type ReviewCard,
  type ReviewListItem,
  type ReviewOverview,
  type ReviewRating,
  type StatsOverview,
} from '@lumen/core';
import type { Db } from '../../db/connection.ts';
import { currentDate, type DailyContext } from '../daily/daily.ts';
import { StudyError } from '../sessions/sessions.ts';
import { getTaxonomyRaw } from '../topics/repo.ts';

/** Zakłada (lub resetuje) harmonogram powtórek po ukończeniu tematu. Wywoływane w transakcji sesji. */
export function scheduleFirstReview(db: Db, topicId: string, today: string, nowIso: string): void {
  db.prepare(
    `INSERT INTO review_items (topic_id, stage, due_date, created_at, updated_at)
     VALUES (?, 0, ?, ?, ?)
     ON CONFLICT(topic_id) DO UPDATE SET stage = 0, due_date = excluded.due_date, updated_at = excluded.updated_at`,
  ).run(topicId, addDays(today, 1), nowIso, nowIso);
}

type ReviewRow = {
  topic_id: string;
  stage: number;
  due_date: string;
  title: string;
  category: string;
};

const toItem = (r: ReviewRow, today: string): ReviewListItem => ({
  topicId: r.topic_id,
  title: r.title,
  category: r.category,
  stage: r.stage,
  dueDate: r.due_date,
  overdueDays: Math.max(0, daysBetween(r.due_date, today)),
});

export function getReviewOverview(ctx: DailyContext): ReviewOverview {
  const today = currentDate(ctx);
  const rows = ctx.db
    .prepare(
      `SELECT r.topic_id, r.stage, r.due_date, t.title, t.category FROM review_items r
       JOIN topics t ON t.id = r.topic_id ORDER BY r.due_date, r.topic_id`,
    )
    .all() as ReviewRow[];
  return {
    date: today,
    due: rows.filter((r) => r.due_date <= today).map((r) => toItem(r, today)),
    upcoming: rows
      .filter((r) => r.due_date > today)
      .slice(0, 20)
      .map((r) => toItem(r, today)),
  };
}

function requireItem(db: Db, topicId: string): void {
  if (!db.prepare('SELECT 1 FROM review_items WHERE topic_id = ?').get(topicId))
    throw new StudyError('not_found', 'Ten temat nie ma zaplanowanej powtórki.', 404);
}

type CardData = {
  core: { main_question: string; research_questions: string[] };
  extended: {
    brief: string;
    takeaways: string[];
    key_concepts: { term: string; definition: string }[];
  };
};

function topicData(db: Db, topicId: string): { title: string; data: CardData } {
  const row = db.prepare('SELECT title, data FROM topics WHERE id = ?').get(topicId) as
    { title: string; data: string } | undefined;
  if (!row) throw new StudyError('not_found', 'Nie znaleziono tematu.', 404);
  return { title: row.title, data: JSON.parse(row.data) as CardData };
}

export function getReviewCard(db: Db, topicId: string): ReviewCard {
  requireItem(db, topicId);
  const { title, data } = topicData(db, topicId);
  return {
    topicId,
    title,
    mainQuestion: data.core.main_question,
    researchQuestions: data.core.research_questions,
  };
}

export function getReviewAnswer(db: Db, topicId: string): ReviewAnswer {
  requireItem(db, topicId);
  const { data } = topicData(db, topicId);
  return {
    brief: data.extended.brief,
    takeaways: data.extended.takeaways,
    keyConcepts: data.extended.key_concepts,
  };
}

export function rateReview(
  ctx: DailyContext,
  topicId: string,
  rating: ReviewRating,
): ReviewListItem {
  const { db } = ctx;
  const today = currentDate(ctx);
  const item = db
    .prepare('SELECT stage, due_date FROM review_items WHERE topic_id = ?')
    .get(topicId) as { stage: number; due_date: string } | undefined;
  if (!item) throw new StudyError('not_found', 'Ten temat nie ma zaplanowanej powtórki.', 404);
  if (item.due_date > today)
    throw new StudyError('not_due', 'Ta powtórka nie jest jeszcze na dziś.', 409);
  const next = nextReview(item.stage, rating, today);
  const nowIso = ctx.now.toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE review_items SET stage = ?, due_date = ?, reps = reps + 1,
         lapses = lapses + ?, last_reviewed = ?, updated_at = ? WHERE topic_id = ?`,
    ).run(next.stage, next.dueDate, rating === 'again' ? 1 : 0, today, nowIso, topicId);
    db.prepare(
      `INSERT INTO review_log (id, topic_id, date, rating, stage_before, stage_after, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(uuidv7(ctx.now.getTime()), topicId, today, rating, item.stage, next.stage, nowIso);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const row = db
    .prepare(
      `SELECT r.topic_id, r.stage, r.due_date, t.title, t.category FROM review_items r
       JOIN topics t ON t.id = r.topic_id WHERE r.topic_id = ?`,
    )
    .get(topicId) as ReviewRow;
  return toItem(row, today);
}

// ── statystyki ─────────────────────────────────────────────────────────────────────────────────

const count = (db: Db, sql: string, ...params: string[]) =>
  (db.prepare(sql).get(...params) as { c: number }).c;

function activeDates(db: Db): Set<string> {
  const rows = db
    .prepare(
      `SELECT date FROM study_sessions WHERE status = 'finished'
       UNION SELECT date FROM review_log`,
    )
    .all() as { date: string }[];
  return new Set(rows.map((r) => r.date));
}

function categoryIds(db: Db): string[] {
  const raw = getTaxonomyRaw(db) as { categories?: { id: string }[] } | null;
  const fromTaxonomy = raw?.categories?.map((c) => c.id) ?? [];
  if (fromTaxonomy.length > 0) return fromTaxonomy;
  return (
    db.prepare('SELECT DISTINCT category FROM topics ORDER BY category').all() as {
      category: string;
    }[]
  ).map((r) => r.category);
}

function categoryProgress(db: Db, demo: boolean): CategoryProgress[] {
  const examples = demo ? '' : 'AND t.is_example = 0';
  return categoryIds(db).map((category) => {
    const completed = count(
      db,
      `SELECT count(*) AS c FROM topic_user_state u JOIN topics t ON t.id = u.topic_id
       WHERE u.status = 'completed' AND t.category = ? ${examples}`,
      category,
    );
    const available = count(
      db,
      `SELECT count(*) AS c FROM topics t WHERE t.status = 'active' AND t.category = ? ${examples}`,
      category,
    );
    const avg = db
      .prepare(
        `SELECT avg(s.interest) AS i, avg(s.confidence) AS c FROM study_sessions s
         JOIN topics t ON t.id = s.topic_id WHERE s.status = 'finished' AND t.category = ?`,
      )
      .get(category) as { i: number | null; c: number | null };
    return { category, completed, available, avgInterest: avg.i, avgConfidence: avg.c };
  });
}

function badgeInput(db: Db, demo: boolean): BadgeInput {
  const examples = demo ? '' : 'AND t.is_example = 0';
  const cats = categoryProgress(db, demo);
  const perfect = count(
    db,
    `SELECT count(*) AS c FROM (
       SELECT a.session_id FROM quiz_answers a GROUP BY a.session_id HAVING min(a.correct) = 1
     )`,
  );
  return {
    completedTopics: count(
      db,
      `SELECT count(*) AS c FROM topic_user_state u JOIN topics t ON t.id = u.topic_id
       WHERE u.status = 'completed' ${examples}`,
    ),
    sessions: count(db, "SELECT count(*) AS c FROM study_sessions WHERE status = 'finished'"),
    activeSeconds: count(
      db,
      "SELECT coalesce(sum(active_seconds), 0) AS c FROM study_sessions WHERE status = 'finished'",
    ),
    longestStreak: 0, // uzupełniane przez wywołującego
    categoriesTouched: cats.filter((c) => c.completed > 0).length,
    totalCategories: cats.length,
    reviews: count(db, 'SELECT count(*) AS c FROM review_log'),
    knowledgeEntries: count(
      db,
      'SELECT count(*) AS c FROM knowledge_entries WHERE deleted_at IS NULL',
    ),
    perfectQuizzes: perfect,
  };
}

export function getStats(ctx: DailyContext): StatsOverview {
  const { db } = ctx;
  const today = currentDate(ctx);
  const dates = activeDates(db);
  const streak = streakInfo(dates, today);
  const cats = categoryProgress(db, ctx.demoMode);
  const input = badgeInput(db, ctx.demoMode);

  const since = addDays(today, -29);
  const sessions = db
    .prepare(
      `SELECT date, count(*) AS n, coalesce(sum(active_seconds), 0) AS secs FROM study_sessions
       WHERE status = 'finished' AND date >= ? GROUP BY date`,
    )
    .all(since) as { date: string; n: number; secs: number }[];
  const reviews = db
    .prepare('SELECT date, count(*) AS n FROM review_log WHERE date >= ? GROUP BY date')
    .all(since) as { date: string; n: number }[];
  const last30: DayActivity[] = Array.from({ length: 30 }, (_, i) => {
    const date = addDays(since, i);
    const s = sessions.find((x) => x.date === date);
    return {
      date,
      minutes: Math.round((s?.secs ?? 0) / 60),
      sessions: s?.n ?? 0,
      reviews: reviews.find((x) => x.date === date)?.n ?? 0,
    };
  });

  const answers = db
    .prepare('SELECT count(*) AS n, coalesce(sum(correct), 0) AS ok FROM quiz_answers')
    .get() as { n: number; ok: number };

  const weakest = cats
    .filter((c) => c.avgConfidence !== null)
    .sort((a, b) => a.avgConfidence! - b.avgConfidence!)
    .filter((c) => c.avgConfidence! < 3.5)
    .slice(0, 2)
    .map((c) => c.category);

  return {
    date: today,
    streak,
    totals: {
      completedTopics: input.completedTopics,
      sessions: input.sessions,
      activeMinutes: Math.round(input.activeSeconds / 60),
      reviews: input.reviews,
      knowledgeEntries: input.knowledgeEntries,
      notes: count(db, 'SELECT count(*) AS c FROM notes WHERE deleted_at IS NULL'),
    },
    quizAccuracy: answers.n > 0 ? answers.ok / answers.n : null,
    reviewsDue: count(db, 'SELECT count(*) AS c FROM review_items WHERE due_date <= ?', today),
    last30,
    categories: cats,
    weakest,
  };
}

/** Wylicza odznaki, zapisuje nowo zdobyte (z datą) i zwraca pełną listę ze stanem postępu. */
export function getAchievements(ctx: DailyContext): BadgeStatus[] {
  const { db } = ctx;
  const today = currentDate(ctx);
  const input = badgeInput(db, ctx.demoMode);
  input.longestStreak = streakInfo(activeDates(db), today).longest;
  const earnedNow = new Set(
    evaluateBadges(input)
      .filter((b) => b.earned)
      .map((b) => b.id),
  );
  const stored = new Map(
    (
      db.prepare('SELECT id, unlocked_at FROM badges').all() as {
        id: string;
        unlocked_at: string;
      }[]
    ).map((b) => [b.id, b.unlocked_at]),
  );
  for (const id of earnedNow) {
    if (!stored.has(id)) {
      const at = ctx.now.toISOString();
      db.prepare('INSERT INTO badges (id, unlocked_at) VALUES (?, ?)').run(id, at);
      stored.set(id, at);
    }
  }
  // Zdobyta odznaka zostaje, nawet jeśli dane się zmienią (np. usunięto notatki).
  return BADGES.map((b) => {
    const p = b.progress(input);
    const unlockedAt = stored.get(b.id) ?? null;
    return {
      id: b.id,
      title: b.title,
      description: b.description,
      value: unlockedAt ? p.goal : p.value,
      goal: p.goal,
      unlockedAt,
    };
  });
}
