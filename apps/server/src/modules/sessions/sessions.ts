import {
  SESSION_STAGES,
  gradeShortAnswer,
  uuidv7,
  type DayStatus,
  type DifficultyRating,
  type NoteKind,
  type NoteView,
  type QuizQuestionView,
  type SessionListItem,
  type SessionStage,
  type SessionView,
} from '@lumen/core';
import type { Db } from '../../db/connection.ts';
import { currentDate, type DailyContext } from '../daily/daily.ts';

export class StudyError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'StudyError';
    this.code = code;
    this.status = status;
  }
}

type SessionRow = {
  id: string;
  topic_id: string;
  date: string;
  is_daily: number;
  stage: SessionStage;
  status: 'active' | 'finished';
  started_at: string;
  finished_at: string | null;
  active_seconds: number;
  outcome: 'completed' | 'partial' | null;
  interest: number | null;
  difficulty_rating: DifficultyRating | null;
  confidence: number | null;
};

type QuizItem = {
  id: string;
  type: 'single_choice' | 'short_answer';
  prompt: string;
  options?: string[];
  correct_option?: number;
  accepted_answers?: string[];
  explanation: string;
};

type TopicData = {
  quiz: QuizItem[];
  speaking_task: { format: string; prompt: string; duration_seconds: number };
  extended: {
    brief: string;
    takeaways: string[];
    key_concepts: { term: string; definition: string }[];
    misconceptions: { claim: string; correction: string }[];
    deeper_questions: string[];
    challenge: string;
    knowledge_limits: string;
  };
};

const stageIndex = (s: SessionStage) => SESSION_STAGES.indexOf(s);

function loadTopic(db: Db, id: string): { title: string; data: TopicData } | null {
  const row = db.prepare('SELECT title, data FROM topics WHERE id = ?').get(id) as
    { title: string; data: string } | undefined;
  return row ? { title: row.title, data: JSON.parse(row.data) as TopicData } : null;
}

function getRow(db: Db, id: string): SessionRow {
  const row = db.prepare('SELECT * FROM study_sessions WHERE id = ?').get(id) as
    SessionRow | undefined;
  if (!row) throw new StudyError('not_found', 'Nie znaleziono sesji nauki.', 404);
  return row;
}

function correctAnswerText(q: QuizItem): string {
  return q.type === 'single_choice'
    ? (q.options?.[q.correct_option ?? 0] ?? '')
    : (q.accepted_answers?.[0] ?? '');
}

const elapsedSeconds = (ctx: DailyContext, startedAt: string) =>
  Math.max(0, Math.floor((ctx.now.getTime() - Date.parse(startedAt)) / 1000));

export function listNotes(
  db: Db,
  filter: { topicId?: string; sessionId?: string } = {},
): NoteView[] {
  const where = ['n.deleted_at IS NULL'];
  const params: string[] = [];
  if (filter.topicId) {
    where.push('n.topic_id = ?');
    params.push(filter.topicId);
  }
  if (filter.sessionId) {
    where.push('n.session_id = ?');
    params.push(filter.sessionId);
  }
  const rows = db
    .prepare(
      `SELECT n.*, t.title AS topic_title FROM notes n JOIN topics t ON t.id = n.topic_id
       WHERE ${where.join(' AND ')} ORDER BY n.created_at DESC, n.id DESC LIMIT 500`,
    )
    .all(...params) as {
    id: string;
    topic_id: string;
    topic_title: string;
    session_id: string | null;
    kind: NoteKind;
    body: string;
    created_at: string;
    updated_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    topicId: r.topic_id,
    topicTitle: r.topic_title,
    sessionId: r.session_id,
    kind: r.kind,
    body: r.body,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getSessionView(db: Db, id: string): SessionView {
  const s = getRow(db, id);
  const topic = loadTopic(db, s.topic_id);
  if (!topic) throw new StudyError('not_found', 'Temat sesji nie istnieje.', 404);
  const idx = stageIndex(s.stage);
  const answers = new Map(
    (
      db
        .prepare('SELECT question_id, answer, correct FROM quiz_answers WHERE session_id = ?')
        .all(id) as { question_id: string; answer: string; correct: number }[]
    ).map((a) => [a.question_id, a]),
  );
  const quiz: QuizQuestionView[] | null =
    idx >= stageIndex('check')
      ? topic.data.quiz.map((q) => {
          const a = answers.get(q.id);
          return {
            id: q.id,
            type: q.type,
            prompt: q.prompt,
            ...(q.options ? { options: q.options } : {}),
            ...(a
              ? {
                  result: {
                    answer: a.answer,
                    correct: a.correct === 1,
                    explanation: q.explanation,
                    correctAnswer: correctAnswerText(q),
                  },
                }
              : {}),
          };
        })
      : null;
  const e = topic.data.extended;
  return {
    id: s.id,
    topicId: s.topic_id,
    title: topic.title,
    date: s.date,
    isDaily: s.is_daily === 1,
    stage: s.stage,
    status: s.status,
    startedAt: s.started_at,
    finishedAt: s.finished_at,
    activeSeconds: s.active_seconds,
    outcome: s.outcome,
    ratings: { interest: s.interest, difficulty: s.difficulty_rating, confidence: s.confidence },
    quiz,
    speaking:
      idx >= stageIndex('speaking')
        ? {
            format: topic.data.speaking_task.format,
            prompt: topic.data.speaking_task.prompt,
            durationSeconds: topic.data.speaking_task.duration_seconds,
          }
        : null,
    extended:
      idx >= stageIndex('speaking')
        ? {
            brief: e.brief,
            takeaways: e.takeaways,
            keyConcepts: e.key_concepts,
            misconceptions: e.misconceptions,
            deeperQuestions: e.deeper_questions,
            challenge: e.challenge,
            knowledgeLimits: e.knowledge_limits,
          }
        : null,
    notes: listNotes(db, { sessionId: id }),
  };
}

/** Rozpoczyna sesję tematu albo wznawia aktywną. Temat przechodzi w stan „w toku”. */
export function startSession(ctx: DailyContext, topicId: string): SessionView {
  const { db } = ctx;
  const today = currentDate(ctx);
  const topic = db.prepare('SELECT status FROM topics WHERE id = ?').get(topicId);
  if (!topic) throw new StudyError('not_found', 'Nie znaleziono tematu.', 404);
  const active = db
    .prepare("SELECT id FROM study_sessions WHERE topic_id = ? AND status = 'active'")
    .get(topicId) as { id: string } | undefined;
  if (active) return getSessionView(db, active.id);

  const daily = db.prepare('SELECT topic_id FROM daily_assignments WHERE date = ?').get(today) as
    { topic_id: string } | undefined;
  const now = ctx.now.toISOString();
  const id = uuidv7(ctx.now.getTime());
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO study_sessions (id, topic_id, date, is_daily, stage, status, started_at, updated_at)
       VALUES (?, ?, ?, ?, 'research', 'active', ?, ?)`,
    ).run(id, topicId, today, daily?.topic_id === topicId ? 1 : 0, now, now);
    const state = db
      .prepare('SELECT status FROM topic_user_state WHERE topic_id = ?')
      .get(topicId) as { status: string } | undefined;
    if (state?.status !== 'completed') {
      db.prepare(
        `INSERT INTO topic_user_state (topic_id, status, postponed_until, deepen, status_date, updated_at)
         VALUES (?, 'in_progress', NULL, 0, ?, ?)
         ON CONFLICT(topic_id) DO UPDATE SET status = 'in_progress', postponed_until = NULL,
           status_date = excluded.status_date, updated_at = excluded.updated_at`,
      ).run(topicId, today, now);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getSessionView(db, id);
}

function requireActive(row: SessionRow): void {
  if (row.status !== 'active')
    throw new StudyError('session_finished', 'Ta sesja jest już zakończona.', 409);
}

/** Zapisuje postęp: etap (tylko do przodu) i czas aktywnej nauki (nie większy niż czas od startu). */
export function updateSession(
  ctx: DailyContext,
  id: string,
  patch: { stage?: SessionStage; activeSeconds?: number },
): SessionView {
  const { db } = ctx;
  const row = getRow(db, id);
  requireActive(row);
  let stage = row.stage;
  if (patch.stage) {
    if (stageIndex(patch.stage) < stageIndex(row.stage) || patch.stage === 'done')
      throw new StudyError('bad_stage', 'Etapu sesji nie można cofnąć ani pominąć zakończenia.');
    stage = patch.stage;
  }
  const seconds = Math.min(
    Math.max(row.active_seconds, patch.activeSeconds ?? 0),
    elapsedSeconds(ctx, row.started_at) + 5,
  );
  db.prepare(
    'UPDATE study_sessions SET stage = ?, active_seconds = ?, updated_at = ? WHERE id = ?',
  ).run(stage, seconds, ctx.now.toISOString(), id);
  return getSessionView(db, id);
}

export function answerQuestion(
  ctx: DailyContext,
  id: string,
  questionId: string,
  answer: string,
): SessionView {
  const { db } = ctx;
  const row = getRow(db, id);
  requireActive(row);
  if (stageIndex(row.stage) < stageIndex('check'))
    throw new StudyError('too_early', 'Quiz jest dostępny od etapu „sprawdzenie”.', 409);
  const topic = loadTopic(db, row.topic_id)!;
  const q = topic.data.quiz.find((x) => x.id === questionId);
  if (!q) throw new StudyError('not_found', 'Nie ma takiego pytania.', 404);
  const exists = db
    .prepare('SELECT 1 FROM quiz_answers WHERE session_id = ? AND question_id = ?')
    .get(id, questionId);
  if (exists) throw new StudyError('already_answered', 'Na to pytanie już odpowiedziano.', 409);
  let correct: boolean;
  let stored = answer;
  if (q.type === 'single_choice') {
    const index = Number(answer);
    if (!Number.isInteger(index) || index < 0 || index >= (q.options?.length ?? 0))
      throw new StudyError('bad_answer', 'Wybierz jedną z dostępnych odpowiedzi.');
    correct = index === q.correct_option;
    stored = q.options![index]!;
  } else {
    correct = gradeShortAnswer(answer, q.accepted_answers ?? []);
  }
  db.prepare(
    'INSERT INTO quiz_answers (session_id, question_id, answer, correct, answered_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, questionId, stored, correct ? 1 : 0, ctx.now.toISOString());
  return getSessionView(db, id);
}

export type FinishInput = {
  outcome: 'completed' | 'partial';
  activeSeconds?: number;
  interest?: number;
  difficulty?: DifficultyRating;
  confidence?: number;
  summary?: string;
  speaking?: string;
  deepen?: boolean;
};

export function finishSession(ctx: DailyContext, id: string, input: FinishInput): SessionView {
  const { db } = ctx;
  const row = getRow(db, id);
  requireActive(row);
  const now = ctx.now.toISOString();
  const seconds = Math.min(
    Math.max(row.active_seconds, input.activeSeconds ?? 0),
    elapsedSeconds(ctx, row.started_at) + 5,
  );
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE study_sessions SET status = 'finished', stage = 'done', finished_at = ?, active_seconds = ?,
         outcome = ?, interest = ?, difficulty_rating = ?, confidence = ?, updated_at = ? WHERE id = ?`,
    ).run(
      now,
      seconds,
      input.outcome,
      input.interest ?? null,
      input.difficulty ?? null,
      input.confidence ?? null,
      now,
      id,
    );
    const addNote = (kind: NoteKind, body: string | undefined) => {
      const text = body?.trim();
      if (!text) return;
      db.prepare(
        'INSERT INTO notes (id, topic_id, session_id, kind, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(uuidv7(ctx.now.getTime()), row.topic_id, id, kind, text, now, now);
    };
    addNote('summary', input.summary);
    addNote('speaking', input.speaking);
    if (input.outcome === 'completed') {
      db.prepare(
        `INSERT INTO topic_user_state (topic_id, status, postponed_until, deepen, status_date, updated_at)
         VALUES (?, 'completed', NULL, ?, ?, ?)
         ON CONFLICT(topic_id) DO UPDATE SET status = 'completed', postponed_until = NULL,
           deepen = excluded.deepen, status_date = excluded.status_date, updated_at = excluded.updated_at`,
      ).run(row.topic_id, input.deepen ? 1 : 0, row.date, now);
    } else if (input.deepen !== undefined) {
      db.prepare('UPDATE topic_user_state SET deepen = ?, updated_at = ? WHERE topic_id = ?').run(
        input.deepen ? 1 : 0,
        now,
        row.topic_id,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getSessionView(db, id);
}

export function getDayStatus(ctx: DailyContext): DayStatus {
  const date = currentDate(ctx);
  const done = ctx.db
    .prepare(
      "SELECT 1 FROM study_sessions WHERE date = ? AND is_daily = 1 AND status = 'finished' AND outcome = 'completed'",
    )
    .get(date);
  const active = ctx.db
    .prepare(
      `SELECT s.id, s.topic_id, s.stage, t.title FROM study_sessions s JOIN topics t ON t.id = s.topic_id
       WHERE s.status = 'active' ORDER BY s.started_at DESC LIMIT 1`,
    )
    .get() as { id: string; topic_id: string; stage: SessionStage; title: string } | undefined;
  return {
    date,
    dailyDone: !!done,
    activeSession: active
      ? { id: active.id, topicId: active.topic_id, title: active.title, stage: active.stage }
      : null,
  };
}

export function listSessions(
  db: Db,
  filter: { status?: 'active' | 'finished'; limit: number },
): SessionListItem[] {
  const rows = db
    .prepare(
      `SELECT s.*, t.title, t.category FROM study_sessions s JOIN topics t ON t.id = s.topic_id
       ${filter.status ? 'WHERE s.status = ?' : ''} ORDER BY s.started_at DESC LIMIT ?`,
    )
    .all(...(filter.status ? [filter.status] : []), filter.limit) as (SessionRow & {
    title: string;
    category: string;
  })[];
  return rows.map((r) => ({
    id: r.id,
    topicId: r.topic_id,
    title: r.title,
    category: r.category,
    date: r.date,
    status: r.status,
    stage: r.stage,
    outcome: r.outcome,
    activeSeconds: r.active_seconds,
    isDaily: r.is_daily === 1,
    startedAt: r.started_at,
  }));
}

export function createNote(
  ctx: DailyContext,
  input: { topicId: string; sessionId?: string; kind: NoteKind; body: string },
): NoteView {
  const { db } = ctx;
  if (!db.prepare('SELECT 1 FROM topics WHERE id = ?').get(input.topicId))
    throw new StudyError('not_found', 'Nie znaleziono tematu.', 404);
  const now = ctx.now.toISOString();
  const id = uuidv7(ctx.now.getTime());
  db.prepare(
    'INSERT INTO notes (id, topic_id, session_id, kind, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, input.topicId, input.sessionId ?? null, input.kind, input.body.trim(), now, now);
  return listNotes(db, { topicId: input.topicId }).find((n) => n.id === id)!;
}

export function updateNote(ctx: DailyContext, id: string, body: string): void {
  const res = ctx.db
    .prepare('UPDATE notes SET body = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(body.trim(), ctx.now.toISOString(), id);
  if (res.changes === 0) throw new StudyError('not_found', 'Nie znaleziono notatki.', 404);
}

export function deleteNote(ctx: DailyContext, id: string): void {
  const stamp = ctx.now.toISOString();
  const res = ctx.db
    .prepare('UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(stamp, stamp, id);
  if (res.changes === 0) throw new StudyError('not_found', 'Nie znaleziono notatki.', 404);
}
