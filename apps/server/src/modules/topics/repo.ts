import type { Taxonomy, TopicListItem } from '@lumen/core';
import type { Db } from '../../db/connection.ts';

export type LocalTopic = {
  id: string;
  title: string;
  revision: number;
  contentHash: string;
  lastVerifiedAt: string;
  status: 'active' | 'deprecated';
  isExample: boolean;
};

export function toTaxonomy(raw: unknown): Taxonomy | null {
  const t = raw as { taxonomy_version?: unknown; categories?: unknown };
  if (
    !t ||
    typeof t !== 'object' ||
    typeof t.taxonomy_version !== 'string' ||
    !Array.isArray(t.categories)
  )
    return null;
  const categories: Taxonomy['categories'] = {};
  for (const c of t.categories as {
    id?: unknown;
    id_prefix?: unknown;
    subcategories?: unknown;
  }[]) {
    if (
      typeof c?.id !== 'string' ||
      typeof c.id_prefix !== 'string' ||
      !Array.isArray(c.subcategories)
    )
      return null;
    categories[c.id] = {
      prefix: c.id_prefix,
      subs: new Set((c.subcategories as { id?: string }[]).map((s) => String(s.id))),
    };
  }
  return { version: t.taxonomy_version, categories };
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM content_meta WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO content_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function getTaxonomyRaw(db: Db): unknown {
  const text = getMeta(db, 'taxonomy');
  return text ? JSON.parse(text) : null;
}

export function getTaxonomy(db: Db): Taxonomy | null {
  return toTaxonomy(getTaxonomyRaw(db));
}

export function getLocalTopics(db: Db): Map<string, LocalTopic> {
  const rows = db
    .prepare(
      'SELECT id, title, revision, content_hash, last_verified_at, status, is_example FROM topics',
    )
    .all() as {
    id: string;
    title: string;
    revision: number;
    content_hash: string;
    last_verified_at: string;
    status: 'active' | 'deprecated';
    is_example: number;
  }[];
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        title: r.title,
        revision: r.revision,
        contentHash: r.content_hash,
        lastVerifiedAt: r.last_verified_at,
        status: r.status,
        isExample: r.is_example === 1,
      },
    ]),
  );
}

export function getTopicData(db: Db, id: string): Record<string, unknown> | null {
  const row = db.prepare('SELECT data FROM topics WHERE id = ?').get(id) as
    { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Record<string, unknown>) : null;
}

export function getSourceIds(db: Db): Set<string> {
  return new Set((db.prepare('SELECT id FROM sources').all() as { id: string }[]).map((r) => r.id));
}

export function getCatalogIds(db: Db): Set<string> {
  return new Set(
    (db.prepare('SELECT id FROM catalog_entries').all() as { id: string }[]).map((r) => r.id),
  );
}

export function getSources(db: Db, ids: string[]): Record<string, unknown>[] {
  if (ids.length === 0) return [];
  const rows = db
    .prepare(`SELECT data FROM sources WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as { data: string }[];
  const byId = new Map(
    rows.map((r) => [
      (JSON.parse(r.data) as { id: string }).id,
      JSON.parse(r.data) as Record<string, unknown>,
    ]),
  );
  return ids.map((id) => byId.get(id)).filter((s): s is Record<string, unknown> => !!s);
}

export type TopicFilter = {
  query?: string;
  category?: string;
  level?: string;
  topicType?: string;
  status?: string;
  userStatus?: string;
  limit: number;
  offset: number;
};

/** Czy minął termin przeglądu treści (last_verified_at + interwał < dziś). */
export function needsReview(
  lastVerifiedAt: string,
  intervalMonths: number | null,
  today: string,
): boolean {
  if (!intervalMonths) return false;
  const [y, m, d] = lastVerifiedAt.split('-').map(Number) as [number, number, number];
  const due = Math.round(Date.UTC(y, m - 1, d) / 86_400_000) + Math.round(30.44 * intervalMonths);
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  return due < Math.round(Date.UTC(ty, tm - 1, td) / 86_400_000);
}

/** Normalizacja do wyszukiwania: małe litery i polskie znaki diakrytyczne (w tym ł, którego NFD nie rozkłada). */
export function foldText(text: string): string {
  return text.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function listTopics(
  db: Db,
  filter: TopicFilter,
  today: string,
  includeExamples: boolean,
): { total: number; items: TopicListItem[] } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (!includeExamples) where.push('t.is_example = 0');
  const add = (clause: string, value: string) => {
    where.push(clause);
    params.push(value);
  };
  if (filter.category) add('t.category = ?', filter.category);
  if (filter.level) add('t.difficulty_level = ?', filter.level);
  if (filter.topicType) add('t.topic_type = ?', filter.topicType);
  if (filter.status) add('t.status = ?', filter.status);
  if (filter.userStatus === 'new') where.push('s.status IS NULL');
  else if (filter.userStatus) add('s.status = ?', filter.userStatus);
  const sql = `FROM topics t LEFT JOIN topic_user_state s ON s.topic_id = t.id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.category, t.subcategory, t.difficulty_level, t.topic_type, t.status, t.revision, t.is_example, t.last_verified_at, t.review_interval_months, s.status AS user_status ${sql} ORDER BY t.id`,
    )
    .all(...params) as {
    id: string;
    title: string;
    category: string;
    subcategory: string;
    difficulty_level: string;
    topic_type: string;
    status: string;
    revision: number;
    is_example: number;
    last_verified_at: string;
    review_interval_months: number | null;
    user_status: string | null;
  }[];
  const q = filter.query ? foldText(filter.query.trim()) : '';
  const matched = q ? rows.filter((r) => foldText(`${r.title} ${r.id}`).includes(q)) : rows;
  const items = matched.slice(filter.offset, filter.offset + filter.limit).map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    subcategory: r.subcategory,
    level: r.difficulty_level,
    topicType: r.topic_type,
    status: r.status,
    revision: r.revision,
    isExample: r.is_example === 1,
    needsReview: needsReview(r.last_verified_at, r.review_interval_months, today),
    userStatus: r.user_status,
  }));
  return { total: matched.length, items };
}
