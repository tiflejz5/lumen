import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SELECTION_CONFIG,
  addDays,
  classifyTopic,
  daysBetween,
  learningDate,
  seededRandom,
  selectTopic,
  targetLevelIndex,
  topicContentPayload,
  type DailyRecord,
  type Level,
  type SelectionHistory,
  type SelectionTopic,
  type UserTopicState,
} from '../src/index.ts';

const CATEGORIES = [
  'finance',
  'science_tech',
  'health_sport',
  'history_society',
  'psychology',
  'general',
];
const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];
const config = { ...DEFAULT_SELECTION_CONFIG, categories: CATEGORIES };

function topic(i: number, over: Partial<SelectionTopic> = {}): SelectionTopic {
  return {
    id: `t-${String(i).padStart(4, '0')}`,
    category: CATEGORIES[i % CATEGORIES.length]!,
    level: LEVELS[i % 3]!,
    topicType: 'timeless',
    prerequisites: [],
    related: [],
    next: [],
    needsReview: false,
    isExample: false,
    ...over,
  };
}
const many = (n: number) => Array.from({ length: n }, (_, i) => topic(i));

function history(over: Partial<SelectionHistory> = {}): SelectionHistory {
  return {
    states: new Map(),
    deepenIds: new Set(),
    assignedBefore: new Set(),
    daily: [],
    categoryInterest: {},
    tooEasy: 0,
    tooHard: 0,
    ...over,
  };
}
const pick = (
  topics: SelectionTopic[],
  h: SelectionHistory,
  seed: string,
  today = '2026-11-05',
  extra: Partial<Parameters<typeof selectTopic>[0]> = {},
) => selectTopic({ topics, history: h, config, today, random: seededRandom(seed), ...extra });

describe('reguły twarde', () => {
  it('nigdy nie wybiera tematu wykluczonego (właściwość, wiele losowych historii)', () => {
    const statusArb = fc.constantFrom<UserTopicState['status']>(
      'completed',
      'known',
      'not_interesting',
      'in_progress',
      'postponed',
      'skipped',
    );
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(39), statusArb), { maxLength: 60 }),
        fc.array(fc.nat(39), { maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        (states, assigned, seed) => {
          const topics = many(40);
          const map = new Map<string, UserTopicState>();
          for (const [i, status] of states) {
            map.set(topics[i]!.id, {
              status,
              ...(status === 'postponed' ? { postponedUntil: '2026-12-31' } : {}),
              statusDate: '2026-11-01',
            });
          }
          const assignedBefore = new Set(assigned.map((i) => topics[i]!.id));
          const result = pick(topics, history({ states: map, assignedBefore }), seed);
          if (!result) return;
          expect(map.get(result.topicId)).toBeUndefined();
          expect(assignedBefore.has(result.topicId)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('zwraca null, gdy nie ma kandydatów', () => {
    const topics = many(3);
    const states = new Map(topics.map((t) => [t.id, { status: 'completed' as const }]));
    expect(pick(topics, history({ states }), 'x')).toBeNull();
    expect(pick([], history(), 'x')).toBeNull();
  });

  it('odłożony temat wraca po upływie terminu', () => {
    const topics = [topic(0)];
    const states = new Map<string, UserTopicState>([
      [topics[0]!.id, { status: 'postponed', postponedUntil: '2026-11-10' }],
    ]);
    expect(pick(topics, history({ states }), 's', '2026-11-05')).toBeNull();
    expect(pick(topics, history({ states }), 's', '2026-11-10')).not.toBeNull();
  });

  it('pominięty temat wraca dopiero po okresie karencji', () => {
    const topics = [topic(0)];
    const states = new Map<string, UserTopicState>([
      [topics[0]!.id, { status: 'skipped', statusDate: '2026-11-01' }],
    ]);
    expect(pick(topics, history({ states }), 's', '2026-11-05')).toBeNull();
    expect(pick(topics, history({ states }), 's', addDays('2026-11-01', 61))).not.toBeNull();
  });

  it('tematy przykładowe są pomijane, chyba że włączono tryb demonstracyjny', () => {
    const topics = [topic(0, { isExample: true })];
    expect(pick(topics, history(), 's')).toBeNull();
    const demo = selectTopic({
      topics,
      history: history(),
      config: { ...config, includeExamples: true },
      today: '2026-11-05',
      random: seededRandom('s'),
    });
    expect(demo?.topicId).toBe(topics[0]!.id);
  });

  it('dodatkowe losowanie pomija wskazane tematy i może sięgnąć po wcześniej przypisane', () => {
    const topics = many(3);
    const assignedBefore = new Set(topics.map((t) => t.id));
    expect(pick(topics, history({ assignedBefore }), 's')).toBeNull();
    const extra = pick(topics, history({ assignedBefore }), 's', '2026-11-05', {
      extraDraw: true,
      excludeIds: [topics[0]!.id, topics[1]!.id],
    });
    expect(extra?.topicId).toBe(topics[2]!.id);
  });
});

describe('powtarzalność', () => {
  it('to samo ziarno daje ten sam wynik, różne ziarna dają różne tematy', () => {
    const topics = many(60);
    const a = pick(topics, history(), 'dzien-1');
    const b = pick(topics, history(), 'dzien-1');
    expect(a).toEqual(b);
    const picks = new Set(
      Array.from({ length: 40 }, (_, i) => pick(topics, history(), `dzien-${i}`)!.topicId),
    );
    expect(picks.size).toBeGreaterThan(15);
  });

  it('seededRandom daje liczby z [0,1) i jest deterministyczny', () => {
    const r1 = seededRandom('abc');
    const r2 = seededRandom('abc');
    for (let i = 0; i < 100; i++) {
      const v = r1();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(r2()).toBe(v);
    }
  });
});

describe('rotacja kategorii', () => {
  const daily = (cats: string[]): DailyRecord[] =>
    cats.map((category, i) => ({ date: addDays('2026-11-04', -i), topicId: `x-${i}`, category }));

  it('ta sama kategoria nie może wypaść trzeci dzień z rzędu', () => {
    const topics = many(60);
    const h = history({ daily: daily(['finance', 'finance']) });
    for (let i = 0; i < 100; i++)
      expect(topics.find((t) => t.id === pick(topics, h, `r-${i}`)!.topicId)!.category).not.toBe(
        'finance',
      );
  });

  it('dwie różne kategorie z rzędu nie blokują niczego', () => {
    const topics = many(60);
    const h = history({ daily: daily(['finance', 'psychology']) });
    const seen = new Set(
      Array.from(
        { length: 100 },
        (_, i) => topics.find((t) => t.id === pick(topics, h, `r-${i}`)!.topicId)!.category,
      ),
    );
    expect(seen.has('finance')).toBe(true);
  });

  it('gdy zostały tylko tematy zablokowanej kategorii, reguła jest poluzowana i oznaczona', () => {
    const topics = many(60).filter((t) => t.category === 'finance');
    const result = pick(topics, history({ daily: daily(['finance', 'finance']) }), 's')!;
    expect(result).not.toBeNull();
    expect(result.explanation.rotationRelaxed).toBe(true);
  });
});

describe('wagi miękkie', () => {
  it('równoważy kategorie w długiej symulacji (1000 dni, 6 kategorii)', () => {
    const topics = many(1500);
    const counts: Record<string, number> = {};
    const states = new Map<string, UserTopicState>();
    const assignedBefore = new Set<string>();
    const dailyHistory: DailyRecord[] = [];
    let date = '2026-01-01';
    for (let day = 0; day < 1000; day++) {
      const h = history({ states, assignedBefore, daily: dailyHistory });
      const res = pick(topics, h, `sim-${day}`, date)!;
      const t = topics.find((x) => x.id === res.topicId)!;
      counts[t.category] = (counts[t.category] ?? 0) + 1;
      assignedBefore.add(t.id);
      dailyHistory.push({ date, topicId: t.id, category: t.category });
      date = addDays(date, 1);
    }
    for (const c of CATEGORIES) {
      const share = (counts[c] ?? 0) / 1000;
      expect(share, `${c}: ${share}`).toBeGreaterThan(0.12);
      expect(share, `${c}: ${share}`).toBeLessThan(0.22);
    }
  });

  it('nigdy nie powtarza tematu w symulacji (główny temat zawsze nowy)', () => {
    const topics = many(200);
    const assignedBefore = new Set<string>();
    const dailyHistory: DailyRecord[] = [];
    let date = '2026-01-01';
    for (let day = 0; day < 200; day++) {
      const res = pick(topics, history({ assignedBefore, daily: dailyHistory }), `u-${day}`, date)!;
      expect(assignedBefore.has(res.topicId)).toBe(false);
      assignedBefore.add(res.topicId);
      dailyHistory.push({
        date,
        topicId: res.topicId,
        category: topics.find((t) => t.id === res.topicId)!.category,
      });
      date = addDays(date, 1);
    }
    expect(pick(topics, history({ assignedBefore }), 'koniec')).toBeNull();
  });

  it('temat powiązany z oznaczonym „do pogłębienia” jest wybierany częściej', () => {
    const topics = many(30);
    const source = topics[0]!;
    const follow = topic(99, { category: 'psychology' });
    source.next = [follow.id];
    const all = [...topics, follow];
    const withDeepen = history({ deepenIds: new Set([source.id]) });
    let boosted = 0;
    let baseline = 0;
    for (let i = 0; i < 600; i++) {
      if (pick(all, withDeepen, `d-${i}`)!.topicId === follow.id) boosted += 1;
      if (pick(all, history(), `d-${i}`)!.topicId === follow.id) baseline += 1;
    }
    expect(boosted).toBeGreaterThan(baseline * 1.4);
    // Temat źródłowy jest już przerobiony (nie jest kandydatem), ale nadal istnieje w bazie.
    const afterSession = history({
      deepenIds: new Set([source.id]),
      states: new Map([[source.id, { status: 'completed' as const }]]),
    });
    const factor = pick([source, follow], afterSession, 'x')!.explanation.factors.find(
      (f) => f.key === 'deepen',
    );
    expect(factor?.value).toBe(2);
    expect(factor?.detail).toContain(source.id);
  });

  it('niezrealizowane wymagania wstępne obniżają wagę, zrealizowane nie', () => {
    const pre = topic(1);
    const t = topic(2, { prerequisites: [pre.id] });
    const unmet = pick([pre, t].slice(1).concat(pre), history(), 's');
    expect(unmet).not.toBeNull();
    const only = selectTopic({
      topics: [pre, t],
      history: history({ states: new Map([[t.id, { status: 'completed' }]]) }),
      config,
      today: '2026-11-05',
      random: seededRandom('s'),
    })!;
    expect(only.topicId).toBe(pre.id);
    const penalty = selectTopic({
      topics: [pre, t],
      history: history({ states: new Map([[pre.id, { status: 'completed' }]]) }),
      config,
      today: '2026-11-05',
      random: seededRandom('s'),
    })!;
    expect(penalty.explanation.factors.find((f) => f.key === 'prerequisites')).toBeUndefined();
    const withPenalty = selectTopic({
      topics: [t, pre],
      history: history({ states: new Map([[pre.id, { status: 'in_progress' }]]) }),
      config,
      today: '2026-11-05',
      random: seededRandom('s'),
    })!;
    expect(withPenalty.explanation.factors.find((f) => f.key === 'prerequisites')?.value).toBe(0.5);
  });

  it('temat wymagający weryfikacji ma obniżoną wagę i jest to widoczne w uzasadnieniu', () => {
    const t = topic(0, { needsReview: true });
    const res = pick([t], history(), 's')!;
    expect(res.explanation.factors.find((f) => f.key === 'freshness')?.value).toBe(0.5);
  });

  it('oceny „za łatwy” i „za trudny” przesuwają docelowy poziom trudności', () => {
    expect(targetLevelIndex(0, 0)).toBe(1);
    expect(targetLevelIndex(6, 0)).toBe(2);
    expect(targetLevelIndex(0, 6)).toBe(0);
    const topics = many(90);
    const count = (h: SelectionHistory) => {
      let advanced = 0;
      for (let i = 0; i < 400; i++)
        if (topics.find((t) => t.id === pick(topics, h, `l-${i}`)!.topicId)!.level === 'advanced')
          advanced += 1;
      return advanced;
    };
    expect(count(history({ tooEasy: 6 }))).toBeGreaterThan(count(history({ tooHard: 6 })) * 1.5);
  });

  it('wyższe zainteresowanie kategorią zwiększa jej szanse', () => {
    const topics = many(60);
    const share = (interest: number) => {
      let n = 0;
      for (let i = 0; i < 600; i++)
        if (
          topics.find(
            (t) =>
              t.id ===
              pick(topics, history({ categoryInterest: { psychology: interest } }), `i-${i}`)!
                .topicId,
          )!.category === 'psychology'
        )
          n += 1;
      return n;
    };
    expect(share(5)).toBeGreaterThan(share(1) * 1.5);
  });

  it('iloczyn składników zgadza się z wagą w uzasadnieniu', () => {
    const topics = many(20).map((t, i) => (i === 3 ? { ...t, needsReview: true } : t));
    for (let i = 0; i < 40; i++) {
      const r = pick(topics, history({ categoryInterest: { finance: 4 } }), `p-${i}`)!;
      const product = r.explanation.factors.reduce((a, f) => a * f.value, 1);
      expect(Math.abs(product - r.explanation.weight)).toBeLessThan(0.05);
    }
  });
});

describe('dzień nauki', () => {
  it('godziny przed początkiem dnia należą do poprzedniej daty', () => {
    expect(learningDate(new Date(2026, 10, 5, 0, 30), 3)).toBe('2026-11-04');
    expect(learningDate(new Date(2026, 10, 5, 2, 59), 3)).toBe('2026-11-04');
    expect(learningDate(new Date(2026, 10, 5, 3, 0), 3)).toBe('2026-11-05');
    expect(learningDate(new Date(2026, 10, 5, 0, 30), 0)).toBe('2026-11-05');
  });
  it('addDays i daysBetween działają na granicach miesięcy i lat', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });
});

describe('klasyfikacja i skrót treści', () => {
  const info = (revision: number, contentHash: string, lastVerifiedAt = '2026-01-01') => ({
    revision,
    contentHash,
    lastVerifiedAt,
    status: 'active' as const,
  });
  it('rozróżnia wszystkie przypadki z IMPORT.md', () => {
    expect(classifyTopic(info(1, 'a'), undefined)).toBe('new');
    expect(classifyTopic(info(2, 'b'), info(1, 'a'))).toBe('update');
    expect(classifyTopic(info(1, 'a'), info(2, 'b'))).toBe('older');
    expect(classifyTopic(info(1, 'b'), info(1, 'a'))).toBe('conflict');
    expect(classifyTopic(info(1, 'a', '2026-06-01'), info(1, 'a', '2026-01-01'))).toBe('refresh');
    expect(classifyTopic(info(1, 'a', '2026-01-01'), info(1, 'a', '2026-06-01'))).toBe('unchanged');
  });
  it('skrót treści nie zależy od kolejności pól ani od bloku freshness', () => {
    const a = topicContentPayload({
      id: 'x',
      core: { b: 1, a: 2 },
      freshness: { last_verified_at: '2026-01-01' },
    });
    const b = topicContentPayload({
      freshness: { last_verified_at: '2027-01-01' },
      core: { a: 2, b: 1 },
      id: 'x',
    });
    expect(a).toBe(b);
    expect(topicContentPayload({ id: 'x', core: { a: 3, b: 1 } })).not.toBe(a);
  });
});
