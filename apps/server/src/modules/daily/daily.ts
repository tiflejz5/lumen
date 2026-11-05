import {
  DEFAULT_SELECTION_CONFIG,
  addDays,
  learningDate,
  selectTopic,
  seededRandom,
  type DailyResult,
  type Explanation,
  type TopicCard,
  type Level,
  type SelectionHistory,
  type SelectionTopic,
  type UserTopicState,
  type UserTopicStatus,
} from '@lumen/core';
import type { Db } from '../../db/connection.ts';
import { getDeviceId } from '../../db/bootstrap.ts';
import { getTaxonomyRaw, needsReview } from '../topics/repo.ts';

type TopicRow = {
  id: string;
  category: string;
  difficulty_level: Level;
  topic_type: 'timeless' | 'current';
  last_verified_at: string;
  review_interval_months: number | null;
  is_example: number;
};

export function loadCard(db: Db, id: string, today: string): TopicCard | null {
  const row = db
    .prepare(
      'SELECT id, title, category, subcategory, difficulty_level, topic_type, last_verified_at, review_interval_months, is_example, data FROM topics WHERE id = ?',
    )
    .get(id) as (TopicRow & { title: string; subcategory: string; data: string }) | undefined;
  if (!row) return null;
  const data = JSON.parse(row.data) as {
    core: { summary: string; why_it_matters: string; estimated_minutes: Record<string, number> };
  };
  const state = db.prepare('SELECT status FROM topic_user_state WHERE topic_id = ?').get(id) as
    { status: UserTopicStatus } | undefined;
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    subcategory: row.subcategory,
    level: row.difficulty_level,
    topicType: row.topic_type,
    summary: data.core.summary,
    whyItMatters: data.core.why_it_matters,
    estimatedMinutes: Object.values(data.core.estimated_minutes).reduce((a, b) => a + b, 0),
    needsReview: needsReview(row.last_verified_at, row.review_interval_months, today),
    isExample: row.is_example === 1,
    userStatus: state?.status ?? null,
  };
}

function loadSelectionTopics(db: Db, today: string): SelectionTopic[] {
  const rows = db
    .prepare(
      `SELECT id, category, difficulty_level, topic_type, last_verified_at, review_interval_months, is_example
       FROM topics WHERE status = 'active'`,
    )
    .all() as TopicRow[];
  const rel = db.prepare('SELECT from_id, to_id, kind FROM topic_relations').all() as {
    from_id: string;
    to_id: string;
    kind: 'prerequisites' | 'related' | 'next';
  }[];
  const byFrom = new Map<string, { prerequisites: string[]; related: string[]; next: string[] }>();
  for (const r of rel) {
    const e = byFrom.get(r.from_id) ?? { prerequisites: [], related: [], next: [] };
    e[r.kind].push(r.to_id);
    byFrom.set(r.from_id, e);
  }
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    level: r.difficulty_level,
    topicType: r.topic_type,
    prerequisites: byFrom.get(r.id)?.prerequisites ?? [],
    related: byFrom.get(r.id)?.related ?? [],
    next: byFrom.get(r.id)?.next ?? [],
    needsReview: needsReview(r.last_verified_at, r.review_interval_months, today),
    isExample: r.is_example === 1,
  }));
}

function loadHistory(db: Db): SelectionHistory {
  const states = new Map<string, UserTopicState>();
  const deepenIds = new Set<string>();
  for (const r of db
    .prepare('SELECT topic_id, status, postponed_until, deepen, status_date FROM topic_user_state')
    .all() as {
    topic_id: string;
    status: UserTopicStatus;
    postponed_until: string | null;
    deepen: number;
    status_date: string | null;
  }[]) {
    states.set(r.topic_id, {
      status: r.status,
      ...(r.postponed_until ? { postponedUntil: r.postponed_until } : {}),
      ...(r.status_date ? { statusDate: r.status_date } : {}),
    });
    if (r.deepen === 1) deepenIds.add(r.topic_id);
  }
  const daily = db.prepare('SELECT date, topic_id, category FROM daily_assignments').all() as {
    date: string;
    topic_id: string;
    category: string;
  }[];
  return {
    states,
    deepenIds,
    assignedBefore: new Set(daily.map((d) => d.topic_id)),
    daily: daily.map((d) => ({ date: d.date, topicId: d.topic_id, category: d.category })),
    // Oceny i flagi trudności pojawią się wraz z sesjami (Etap 3).
    categoryInterest: {},
    tooEasy: 0,
    tooHard: 0,
  };
}

function categoriesOf(db: Db, topics: SelectionTopic[]): string[] {
  const raw = getTaxonomyRaw(db) as { categories?: { id: string }[] } | null;
  const fromTaxonomy = raw?.categories?.map((c) => c.id) ?? [];
  return fromTaxonomy.length > 0 ? fromTaxonomy : [...new Set(topics.map((t) => t.category))];
}

export type { DailyResult, TopicCard };

export type DailyContext = { db: Db; now: Date; dayStartHour: number; demoMode: boolean };

export function currentDate(ctx: Pick<DailyContext, 'now' | 'dayStartHour'>): string {
  return learningDate(ctx.now, ctx.dayStartHour);
}

function draw(
  ctx: DailyContext,
  today: string,
  seed: string,
  extra: { extraDraw: boolean; excludeIds: string[] },
) {
  const topics = loadSelectionTopics(ctx.db, today);
  const history = loadHistory(ctx.db);
  const result = selectTopic({
    topics,
    history,
    config: {
      ...DEFAULT_SELECTION_CONFIG,
      includeExamples: ctx.demoMode,
      categories: categoriesOf(ctx.db, topics),
    },
    today,
    random: seededRandom(seed),
    extraDraw: extra.extraDraw,
    excludeIds: extra.excludeIds,
  });
  return { result, hasTopics: topics.some((t) => ctx.demoMode || !t.isExample) };
}

/** Temat dnia: istniejące przypisanie albo nowe losowanie (zapisane, więc stałe przez cały dzień). */
export function getDaily(ctx: DailyContext): DailyResult {
  const today = currentDate(ctx);
  const existing = ctx.db
    .prepare('SELECT topic_id, explanation FROM daily_assignments WHERE date = ?')
    .get(today) as { topic_id: string; explanation: string } | undefined;
  if (existing) {
    return {
      date: today,
      topic: loadCard(ctx.db, existing.topic_id, today),
      explanation: JSON.parse(existing.explanation) as Explanation,
      reason: null,
    };
  }
  const { result, hasTopics } = draw(ctx, today, `daily:${getDeviceId(ctx.db)}:${today}`, {
    extraDraw: false,
    excludeIds: [],
  });
  if (!result)
    return {
      date: today,
      topic: null,
      explanation: null,
      reason: hasTopics ? 'exhausted' : 'no_topics',
    };
  const card = loadCard(ctx.db, result.topicId, today)!;
  ctx.db
    .prepare(
      'INSERT INTO daily_assignments (date, topic_id, category, explanation, assigned_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      today,
      result.topicId,
      card.category,
      JSON.stringify(result.explanation),
      ctx.now.toISOString(),
    );
  return { date: today, topic: card, explanation: result.explanation, reason: null };
}

/** Dodatkowe losowanie: nie zastępuje tematu dnia i nie jest zapisywane jako postęp. */
export function drawExtra(ctx: DailyContext, nonce: string): DailyResult {
  const daily = getDaily(ctx);
  const today = daily.date;
  const { result, hasTopics } = draw(ctx, today, `extra:${getDeviceId(ctx.db)}:${today}:${nonce}`, {
    extraDraw: true,
    excludeIds: daily.topic ? [daily.topic.id] : [],
  });
  if (!result)
    return {
      date: today,
      topic: null,
      explanation: null,
      reason: hasTopics ? 'exhausted' : 'no_topics',
    };
  return {
    date: today,
    topic: loadCard(ctx.db, result.topicId, today),
    explanation: result.explanation,
    reason: null,
  };
}

export type StatePatch = {
  status: UserTopicStatus | null;
  postponeDays?: number;
  deepen?: boolean;
};

const REASSIGN_ON: ReadonlySet<UserTopicStatus> = new Set([
  'known',
  'not_interesting',
  'postponed',
  'skipped',
]);

/** Ustawia stan tematu. Gdy dotyczy dzisiejszego tematu dnia i go „odrzuca”, losowany jest inny. */
export function setTopicState(
  ctx: DailyContext,
  id: string,
  patch: StatePatch,
): { reassigned: boolean } {
  const today = currentDate(ctx);
  const now = ctx.now.toISOString();
  const current = ctx.db
    .prepare('SELECT status, deepen FROM topic_user_state WHERE topic_id = ?')
    .get(id) as { status: UserTopicStatus; deepen: number } | undefined;
  const deepen = patch.deepen === undefined ? (current?.deepen ?? 0) : patch.deepen ? 1 : 0;
  if (patch.status === null && deepen === 0) {
    ctx.db.prepare('DELETE FROM topic_user_state WHERE topic_id = ?').run(id);
  } else if (patch.status === null && !current) {
    // Flaga „do pogłębienia” ma sens dopiero po pracy nad tematem; sama nie tworzy stanu.
    return { reassigned: false };
  } else {
    const status = patch.status ?? current!.status;
    const postponedUntil = status === 'postponed' ? addDays(today, patch.postponeDays ?? 7) : null;
    ctx.db
      .prepare(
        `INSERT INTO topic_user_state (topic_id, status, postponed_until, deepen, status_date, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(topic_id) DO UPDATE SET status = excluded.status, postponed_until = excluded.postponed_until,
           deepen = excluded.deepen, status_date = excluded.status_date, updated_at = excluded.updated_at`,
      )
      .run(id, status, postponedUntil, deepen, today, now);
  }
  const daily = ctx.db
    .prepare('SELECT topic_id FROM daily_assignments WHERE date = ?')
    .get(today) as { topic_id: string } | undefined;
  if (daily?.topic_id === id && patch.status && REASSIGN_ON.has(patch.status)) {
    ctx.db.prepare('DELETE FROM daily_assignments WHERE date = ?').run(today);
    getDaily(ctx);
    return { reassigned: true };
  }
  return { reassigned: false };
}
