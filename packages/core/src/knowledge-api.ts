import { normalizeAnswer } from './session-api.ts';

/** Typy API osobistej bazy wiedzy i czyste funkcje powiązań [[termin]]. */

export type KnowledgeEntry = {
  id: string;
  term: string;
  definition: string;
  topicId: string | null;
  topicTitle: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeDetail = KnowledgeEntry & {
  /** surowy tekst z [[…]] -> id istniejącego pojęcia albo null (jeszcze nie ma takiego pojęcia) */
  resolved: Record<string, string | null>;
  /** pojęcia, których definicje odwołują się do tego pojęcia */
  backlinks: { id: string; term: string }[];
};

export type SearchResults = {
  query: string;
  entries: KnowledgeEntry[];
  notes: {
    id: string;
    topicId: string;
    topicTitle: string;
    kind: string;
    body: string;
    createdAt: string;
  }[];
};

export const TERM_MAX = 80;
export const DEFINITION_MAX = 4000;

/** Klucz porównawczy terminu. */
export function termKey(term: string): string {
  return normalizeAnswer(term);
}

const WIKILINK = /\[\[([^\[\]\n]{1,80})\]\]/g;

/** Unikalne teksty powiązań [[…]] w kolejności pierwszego wystąpienia. */
export function extractLinks(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(WIKILINK)) {
    const raw = m[1]!.trim();
    if (raw && !seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }
  return out;
}

export type TextSegment = { kind: 'text'; text: string } | { kind: 'link'; text: string };

/** Dzieli tekst na zwykłe fragmenty i powiązania (do wyświetlenia jako linki). */
export function splitLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(WIKILINK)) {
    const index = m.index ?? 0;
    if (index > last) segments.push({ kind: 'text', text: text.slice(last, index) });
    segments.push({ kind: 'link', text: m[1]!.trim() });
    last = index + m[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

/** Czy tekst zawiera podane zapytanie (bez wielkości liter i znaków diakrytycznych, wszystkie słowa). */
export function matchesQuery(text: string, query: string): boolean {
  const words = normalizeAnswer(query).split(' ').filter(Boolean);
  if (words.length === 0) return false;
  const haystack = normalizeAnswer(text);
  return words.every((w) => haystack.includes(w));
}
