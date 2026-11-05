import {
  extractLinks,
  matchesQuery,
  termKey,
  uuidv7,
  type KnowledgeDetail,
  type KnowledgeEntry,
  type SearchResults,
} from '@lumen/core';
import type { Db } from '../../db/connection.ts';
import type { DailyContext } from '../daily/daily.ts';
import { StudyError, listNotes } from '../sessions/sessions.ts';

type Row = {
  id: string;
  term: string;
  term_key: string;
  definition: string;
  topic_id: string | null;
  topic_title: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT = `SELECT e.*, t.title AS topic_title FROM knowledge_entries e
  LEFT JOIN topics t ON t.id = e.topic_id WHERE e.deleted_at IS NULL`;

const toEntry = (r: Row): KnowledgeEntry => ({
  id: r.id,
  term: r.term,
  definition: r.definition,
  topicId: r.topic_id,
  topicTitle: r.topic_title,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function allRows(db: Db): Row[] {
  return db.prepare(`${SELECT} ORDER BY e.term_key`).all() as Row[];
}

export function listEntries(db: Db, query?: string): KnowledgeEntry[] {
  const rows = allRows(db);
  const q = query?.trim();
  return (q ? rows.filter((r) => matchesQuery(`${r.term} ${r.definition}`, q)) : rows).map(toEntry);
}

export function getEntry(db: Db, id: string): KnowledgeDetail {
  const rows = allRows(db);
  const row = rows.find((r) => r.id === id);
  if (!row) throw new StudyError('not_found', 'Nie znaleziono pojęcia.', 404);
  const byKey = new Map(rows.map((r) => [r.term_key, r]));
  const resolved: Record<string, string | null> = {};
  for (const link of extractLinks(row.definition))
    resolved[link] = byKey.get(termKey(link))?.id ?? null;
  const backlinks = rows
    .filter(
      (r) => r.id !== id && extractLinks(r.definition).some((l) => termKey(l) === row.term_key),
    )
    .map((r) => ({ id: r.id, term: r.term }));
  return { ...toEntry(row), resolved, backlinks };
}

function validate(term: string, definition: string): { term: string; definition: string } {
  return { term: term.trim().replace(/\s+/g, ' '), definition: definition.trim() };
}

export function createEntry(
  ctx: DailyContext,
  input: { term: string; definition: string; topicId?: string },
): KnowledgeDetail {
  const { db } = ctx;
  const { term, definition } = validate(input.term, input.definition);
  const key = termKey(term);
  if (!key) throw new StudyError('bad_term', 'Podaj pojęcie (litery lub cyfry).');
  if (input.topicId && !db.prepare('SELECT 1 FROM topics WHERE id = ?').get(input.topicId))
    throw new StudyError('not_found', 'Nie znaleziono tematu.', 404);
  const dup = db
    .prepare('SELECT id FROM knowledge_entries WHERE term_key = ? AND deleted_at IS NULL')
    .get(key) as { id: string } | undefined;
  if (dup) throw new StudyError('duplicate', 'Takie pojęcie już jest w bazie wiedzy.', 409);
  const id = uuidv7(ctx.now.getTime());
  const now = ctx.now.toISOString();
  db.prepare(
    `INSERT INTO knowledge_entries (id, term, term_key, definition, topic_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, term, key, definition, input.topicId ?? null, now, now);
  return getEntry(db, id);
}

export function updateEntry(
  ctx: DailyContext,
  id: string,
  input: { term: string; definition: string },
): KnowledgeDetail {
  const { db } = ctx;
  const { term, definition } = validate(input.term, input.definition);
  const key = termKey(term);
  if (!key) throw new StudyError('bad_term', 'Podaj pojęcie (litery lub cyfry).');
  const dup = db
    .prepare(
      'SELECT id FROM knowledge_entries WHERE term_key = ? AND deleted_at IS NULL AND id <> ?',
    )
    .get(key, id);
  if (dup) throw new StudyError('duplicate', 'Takie pojęcie już jest w bazie wiedzy.', 409);
  const res = db
    .prepare(
      `UPDATE knowledge_entries SET term = ?, term_key = ?, definition = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(term, key, definition, ctx.now.toISOString(), id);
  if (res.changes === 0) throw new StudyError('not_found', 'Nie znaleziono pojęcia.', 404);
  return getEntry(db, id);
}

export function deleteEntry(ctx: DailyContext, id: string): void {
  const stamp = ctx.now.toISOString();
  const res = ctx.db
    .prepare(
      'UPDATE knowledge_entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    )
    .run(stamp, stamp, id);
  if (res.changes === 0) throw new StudyError('not_found', 'Nie znaleziono pojęcia.', 404);
}

/** Wyszukiwanie w pojęciach i notatkach (bez wielkości liter i znaków diakrytycznych). */
export function search(db: Db, query: string): SearchResults {
  const q = query.trim();
  return {
    query: q,
    entries: q ? listEntries(db, q) : [],
    notes: q
      ? listNotes(db)
          .filter((n) => matchesQuery(`${n.body} ${n.topicTitle}`, q))
          .map((n) => ({
            id: n.id,
            topicId: n.topicId,
            topicTitle: n.topicTitle,
            kind: n.kind,
            body: n.body,
            createdAt: n.createdAt,
          }))
      : [],
  };
}
