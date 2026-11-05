import { ratio, ratioAtLeast } from './similarity.ts';

/**
 * Reguły walidacji poziomu 2 (port `tools/validate.py` z pakietu bazy, schemat 1.0.0).
 * Poziom 1 (schemat JSON) wykonuje po stronie serwera Ajv na schematach autora.
 * Komunikaty są celowo identyczne z walidatorem Pythona – testy różnicowe porównują oba wyniki.
 */

export const SCHEMA_MAJOR = 1;
export const TITLE_SIM_THRESHOLD = 0.8;
export const QUESTION_SIM_THRESHOLD = 0.85;
export const TAG_JACCARD_THRESHOLD = 0.6;
export const MAX_SESSION_MINUTES = 20;

export type IssueLevel = 'error' | 'warning' | 'info';
export type Issue = { level: IssueLevel; where: string; message: string };

export type Taxonomy = {
  version: string;
  categories: Record<string, { prefix: string; subs: Set<string> }>;
};

/** Pola tematu używane przez reguły (reszta rekordu jest zweryfikowana schematem). */
export type TopicRecord = {
  id: string;
  slug: string;
  revision: number;
  status: 'active' | 'deprecated';
  superseded_by?: string;
  core: {
    category: string;
    subcategory: string;
    title: string;
    topic_type: 'timeless' | 'current';
    main_question: string;
    research_questions: string[];
    difficulty: { level: string; scores: Record<string, number> };
    estimated_minutes: Record<string, number>;
    search_queries: { lang: string; query: string }[];
    suggested_sources: { source_id: string }[];
  };
  extended: {
    claims: { claim_type: string; source_ids: string[]; note?: string; as_of?: string }[];
  };
  quiz?: {
    id: string;
    type: string;
    options?: string[];
    correct_option?: number;
  }[];
  relations: { prerequisites: string[]; related: string[]; next: string[] };
  freshness: {
    created_at: string;
    last_verified_at: string;
    valid_as_of: string;
    requires_periodic_update: boolean;
    review_interval_months: number | null;
    status: string;
    time_sensitive_items?: string[];
  };
  meta: { concept_tags: string[]; question_type: string };
  changelog: { revision: number }[];
};

export function levelFromSum(total: number): 'beginner' | 'intermediate' | 'advanced' {
  if (total <= 7) return 'beginner';
  if (total <= 11) return 'intermediate';
  return 'advanced';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Data RRRR-MM-DD jako liczba dni od epoki; null, gdy napis nie jest poprawną datą. */
export function parseDate(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d)
    return null;
  return Math.round(t / 86_400_000);
}

function isoFromDays(days: number): string {
  return new Date(days * 86_400_000).toISOString().slice(0, 10);
}

export function checkTopic(
  t: TopicRecord,
  where: string,
  taxonomy: Taxonomy,
  sourceIds: Set<string>,
  today: string,
): Issue[] {
  const issues: Issue[] = [];
  const error = (message: string) => issues.push({ level: 'error', where, message });
  const warn = (message: string) => issues.push({ level: 'warning', where, message });
  const note = (message: string) => issues.push({ level: 'info', where, message });
  const { core, extended: ext, freshness: fr } = t;
  const todayDays = parseDate(today)!;

  // Kategoria / podkategoria / prefiks ID
  const cat = taxonomy.categories[core.category];
  if (!cat) {
    error(`nieznana kategoria ${core.category}`);
  } else {
    if (!cat.subs.has(core.subcategory)) {
      error(`podkategoria '${core.subcategory}' nie należy do kategorii '${core.category}'`);
    }
    if (!t.id.startsWith(`${cat.prefix}-`)) {
      warn(
        `prefiks ID nie odpowiada kategorii '${core.category}' (dopuszczalne tylko po zmianie kategorii)`,
      );
    }
  }

  // Trudność zgodna z sumą ocen
  const total = Object.values(core.difficulty.scores).reduce((a, b) => a + b, 0);
  const expected = levelFromSum(total);
  if (core.difficulty.level !== expected) {
    error(
      `poziom '${core.difficulty.level}' niezgodny z sumą ocen ${total} (oczekiwano '${expected}')`,
    );
  }

  // Czas sesji
  const minutes = Object.values(core.estimated_minutes).reduce((a, b) => a + b, 0);
  if (minutes > MAX_SESSION_MINUTES) {
    error(`szacowany czas ${minutes} min przekracza ${MAX_SESSION_MINUTES} min`);
  }

  // Zapytania: angielskie tylko jako uzupełnienie
  const en = core.search_queries.filter((q) => q.lang === 'en').length;
  const pl = core.search_queries.filter((q) => q.lang === 'pl').length;
  if (en > 1) warn('więcej niż jedno zapytanie po angielsku');
  if (pl < 1) error('brak zapytania po polsku');

  // Pytania badawcze nie mogą powtarzać pytania głównego
  const mainQ = core.main_question.toLowerCase();
  for (const rq of core.research_questions) {
    if (ratio(rq.toLowerCase(), mainQ) > QUESTION_SIM_THRESHOLD) {
      warn('pytanie badawcze niemal identyczne z pytaniem głównym');
    }
  }

  // Źródła
  const used = core.suggested_sources.map((s) => s.source_id);
  if (used.length !== new Set(used).size) error('powtórzone źródło w suggested_sources');
  for (const sid of used) {
    if (!sourceIds.has(sid)) error(`źródło '${sid}' nie istnieje w data/sources.json`);
  }
  ext.claims.forEach((cl, i) => {
    for (const sid of cl.source_ids) {
      if (!sourceIds.has(sid)) error(`claims[${i}]: źródło '${sid}' nie istnieje w rejestrze`);
    }
    if (cl.claim_type === 'fact' && cl.source_ids.length === 0 && !cl.note) {
      warn(`claims[${i}]: fakt bez źródła i bez notatki wyjaśniającej`);
    }
    if (cl.claim_type === 'prediction' && !cl.as_of) {
      error(`claims[${i}]: przewidywanie musi mieć datę as_of`);
    }
  });

  // Typ aktualności
  if (core.topic_type === 'current' && !fr.requires_periodic_update) {
    error('temat aktualny musi mieć requires_periodic_update = true');
  }
  if (fr.requires_periodic_update && fr.review_interval_months === null) {
    error('requires_periodic_update = true wymaga review_interval_months');
  }
  if (!fr.requires_periodic_update && fr.review_interval_months !== null) {
    error('review_interval_months musi być null, gdy temat nie wymaga aktualizacji');
  }
  if (
    fr.requires_periodic_update &&
    !(fr.time_sensitive_items && fr.time_sensitive_items.length > 0)
  ) {
    warn('temat wymaga aktualizacji, ale nie wskazano, które informacje się starzeją');
  }

  // Daty
  const created = parseDate(fr.created_at);
  const verified = parseDate(fr.last_verified_at);
  const valid = parseDate(fr.valid_as_of);
  if (created !== null && verified !== null && verified < created) {
    error('last_verified_at wcześniejsze niż created_at');
  }
  for (const [name, d] of [
    ['created_at', created],
    ['last_verified_at', verified],
    ['valid_as_of', valid],
  ] as const) {
    if (d !== null && d > todayDays) error(`${name} w przyszłości`);
  }
  if (verified !== null && fr.review_interval_months) {
    const due = verified + Math.round(30.44 * fr.review_interval_months);
    if (due < todayDays && fr.status === 'current') {
      warn(`termin przeglądu minął ${isoFromDays(due)}, a status to 'current'`);
    }
  }

  // Quiz
  const quiz = t.quiz ?? [];
  const qids = quiz.map((q) => q.id);
  if (qids.length !== new Set(qids).size) error('powtórzone ID pytań quizu');
  for (const q of quiz) {
    if (q.type === 'single_choice') {
      const options = q.options ?? [];
      if ((q.correct_option ?? 0) >= options.length)
        error(`quiz ${q.id}: correct_option poza zakresem`);
      if (new Set(options).size !== options.length) error(`quiz ${q.id}: powtórzone odpowiedzi`);
    }
  }

  // Rewizje
  const revs = t.changelog.map((c) => c.revision);
  const sorted = [...revs].sort((a, b) => a - b);
  if (revs.some((r, i) => r !== sorted[i]) || revs.length !== new Set(revs).size) {
    error('changelog musi mieć rosnące, unikalne numery rewizji');
  }
  if (revs[revs.length - 1] !== t.revision) {
    error(`ostatni wpis changelog (${revs[revs.length - 1]}) ≠ revision (${t.revision})`);
  }

  // Status
  if (t.status === 'deprecated' && !t.superseded_by) note('temat wycofany bez następcy');
  if (t.superseded_by === t.id) error('superseded_by wskazuje na samego siebie');

  return issues;
}

/**
 * Kontrole krzyżowe całego zbioru tematów: relacje, cykle w wymaganiach wstępnych, duplikaty.
 * `known` obejmuje tematy zbioru oraz zarezerwowane ID z katalogu tytułów.
 */
export function checkCross(topics: Map<string, TopicRecord>, catalogIds: Set<string>): Issue[] {
  const issues: Issue[] = [];
  const error = (where: string, message: string) => issues.push({ level: 'error', where, message });
  const warn = (where: string, message: string) =>
    issues.push({ level: 'warning', where, message });
  const known = new Set<string>([...topics.keys(), ...catalogIds]);
  const graph = new Map<string, string[]>();

  for (const [tid, t] of topics) {
    const rel = t.relations;
    for (const kind of ['prerequisites', 'related', 'next'] as const) {
      for (const ref of rel[kind]) {
        if (ref === tid) error(tid, `relations.${kind} wskazuje na samego siebie`);
        else if (!known.has(ref)) error(tid, `relations.${kind}: nieznany temat '${ref}'`);
      }
    }
    const overlap = rel.prerequisites.filter((x) => rel.next.includes(x));
    if (overlap.length > 0) {
      error(
        tid,
        `ten sam temat jest jednocześnie wymaganiem i kontynuacją: [${[...new Set(overlap)]
          .sort()
          .map((x) => `'${x}'`)
          .join(', ')}]`,
      );
    }
    graph.set(tid, [...(graph.get(tid) ?? []), ...rel.prerequisites.filter((r) => topics.has(r))]);
    if (t.superseded_by && !known.has(t.superseded_by)) {
      error(tid, `superseded_by: nieznany temat '${t.superseded_by}'`);
    }
  }

  // Cykle w wymaganiach wstępnych
  const state = new Map<string, number>();
  const visit = (node: string, stack: string[]): void => {
    state.set(node, 1);
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === 1)
        error(node, `cykl w prerequisites: ${[...stack, next].join(' → ')}`);
      else if (state.get(next) === undefined) visit(next, [...stack, next]);
    }
    state.set(node, 2);
  };
  for (const node of [...graph.keys()]) {
    if (!state.has(node)) visit(node, [node]);
  }

  // Podobieństwa (potencjalne duplikaty) – tylko tematy aktywne
  const items = [...topics.values()].filter((t) => t.status === 'active');
  const lower = items.map((t) => ({
    title: t.core.title.toLowerCase(),
    main: t.core.main_question.trim().toLowerCase(),
    rqs: t.core.research_questions.map((q) => ({ original: q, lower: q.toLowerCase() })),
    tags: new Set(t.meta.concept_tags),
  }));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      const la = lower[i]!;
      const lb = lower[j]!;
      const pair = `${a.id}/${b.id}`;
      if (ratioAtLeast(la.title, lb.title, TITLE_SIM_THRESHOLD)) {
        warn(pair, `bardzo podobne tytuły (podobieństwo ${ratio(la.title, lb.title).toFixed(2)})`);
      }
      const inter = [...la.tags].filter((x) => lb.tags.has(x)).length;
      const union = new Set([...la.tags, ...lb.tags]).size;
      const jaccard = inter / union;
      if (jaccard >= TAG_JACCARD_THRESHOLD) {
        warn(pair, `duże pokrycie tagów pojęciowych (${jaccard.toFixed(2)}) – możliwy duplikat`);
      }
      if (la.main === lb.main) error(pair, 'identyczne pytanie główne');
      for (const qa of la.rqs) {
        for (const qb of lb.rqs) {
          if (ratioAtLeast(qa.lower, qb.lower, QUESTION_SIM_THRESHOLD)) {
            // Walidator autora wypisuje oryginalny tekst (nie zmniejszony) – zachowujemy to.
            warn(
              pair,
              `powtarzające się pytanie badawcze: „${Array.from(qa.original).slice(0, 60).join('')}…”`,
            );
          }
        }
      }
    }
  }
  return issues;
}

export type Stats = {
  total_topics: number;
  by_category: Record<string, number>;
  by_difficulty: Record<string, number>;
  by_topic_type: Record<string, number>;
};

export function topicStats(topics: Iterable<TopicRecord>): Stats {
  const active = [...topics].filter((t) => t.status === 'active');
  const count = (f: (t: TopicRecord) => string) => {
    const out: Record<string, number> = {};
    for (const t of active) out[f(t)] = (out[f(t)] ?? 0) + 1;
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  };
  return {
    total_topics: active.length,
    by_category: count((t) => t.core.category),
    by_difficulty: count((t) => t.core.difficulty.level),
    by_topic_type: count((t) => t.core.topic_type),
  };
}
