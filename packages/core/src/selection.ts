import { daysBetween } from './learning-day.ts';

/**
 * Wybór tematu: reguły twarde (wykluczenia) + wagi miękkie + losowanie ważone z ziarnem.
 * To algorytm regułowy, nie AI: każdy składnik wyniku da się pokazać użytkownikowi („Dlaczego ten temat?”).
 */

export type Level = 'beginner' | 'intermediate' | 'advanced';
export type UserTopicStatus =
  'in_progress' | 'completed' | 'skipped' | 'postponed' | 'known' | 'not_interesting';

export type SelectionTopic = {
  id: string;
  category: string;
  level: Level;
  topicType: 'timeless' | 'current';
  prerequisites: string[];
  related: string[];
  next: string[];
  /** termin przeglądu minął – treść może być nieaktualna */
  needsReview: boolean;
  isExample: boolean;
};

export type UserTopicState = {
  status: UserTopicStatus;
  /** dla „postponed”: do kiedy odłożony (RRRR-MM-DD) */
  postponedUntil?: string;
  /** data ostatniej zmiany statusu */
  statusDate?: string;
};

export type DailyRecord = { date: string; topicId: string; category: string };

export type SelectionHistory = {
  states: Map<string, UserTopicState>;
  /** tematy oznaczone „do pogłębienia” */
  deepenIds: Set<string>;
  /** wszystkie wcześniej przypisane tematy dnia (główny temat zawsze ma być nowy) */
  assignedBefore: Set<string>;
  /** dotychczasowe tematy dnia, dowolna kolejność */
  daily: DailyRecord[];
  /** średnia ocena zainteresowania (1–5) per kategoria; brak = nieznana */
  categoryInterest: Record<string, number>;
  /** ile razy w ostatnim czasie oznaczono „za łatwy” / „za trudny” */
  tooEasy: number;
  tooHard: number;
};

export type SelectionConfig = {
  /** minimalna przerwa po pominięciu tematu (dni) */
  skippedCooldownDays: number;
  /** największa liczba kolejnych dni z tą samą kategorią */
  maxSameCategoryInRow: number;
  /** okno do liczenia równowagi kategorii (dni) */
  balanceWindowDays: number;
  /** czy losować także tematy przykładowe */
  includeExamples: boolean;
  /** wszystkie kategorie bazy (do liczenia udziału docelowego) */
  categories: string[];
};

export const DEFAULT_SELECTION_CONFIG: Omit<SelectionConfig, 'categories'> = {
  skippedCooldownDays: 60,
  maxSameCategoryInRow: 2,
  balanceWindowDays: 30,
  includeExamples: false,
};

export type Factor = { key: string; label: string; value: number; detail: string };

export type Explanation = {
  candidates: number;
  /** reguła rotacji kategorii musiała zostać poluzowana (brak innych kandydatów) */
  rotationRelaxed: boolean;
  factors: Factor[];
  weight: number;
};

export type SelectionResult = { topicId: string; explanation: Explanation } | null;

export type ExclusionReason =
  | 'example'
  | 'not_active'
  | 'assigned_before'
  | 'status'
  | 'postponed'
  | 'skipped_recently'
  | 'rotation';

const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];

/** Deterministyczny generator pseudolosowy (mulberry32) z ziarna tekstowego. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^ (h >>> 16)) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Candidate = { topic: SelectionTopic; factors: Factor[]; weight: number };

type Context = {
  topics: Map<string, SelectionTopic>;
  history: SelectionHistory;
  config: SelectionConfig;
  today: string;
  /** tematy, które mają być pominięte w tym losowaniu (np. temat dnia przy dodatkowym losowaniu) */
  excludeIds: Set<string>;
};

/** Zwraca powód wykluczenia albo null, gdy temat może być kandydatem (bez reguły rotacji). */
export function hardExclusion(
  topic: SelectionTopic,
  ctx: Context,
  extraDraw: boolean,
): ExclusionReason | null {
  const { history, config, today } = ctx;
  if (topic.isExample && !config.includeExamples) return 'example';
  if (ctx.excludeIds.has(topic.id)) return 'assigned_before';
  if (!extraDraw && history.assignedBefore.has(topic.id)) return 'assigned_before';
  const state = history.states.get(topic.id);
  if (state) {
    if (
      state.status === 'completed' ||
      state.status === 'known' ||
      state.status === 'not_interesting'
    )
      return 'status';
    if (state.status === 'in_progress') return 'status';
    if (state.status === 'postponed' && state.postponedUntil && state.postponedUntil > today)
      return 'postponed';
    if (
      state.status === 'skipped' &&
      state.statusDate &&
      daysBetween(state.statusDate, today) < config.skippedCooldownDays
    ) {
      return 'skipped_recently';
    }
  }
  return null;
}

function levelIndex(level: Level): number {
  return LEVELS.indexOf(level);
}

/** Docelowy poziom: domyślnie średni, przesuwany ocenami „za łatwy” / „za trudny”. */
export function targetLevelIndex(tooEasy: number, tooHard: number): number {
  const shift = Math.max(-1, Math.min(1, Math.round((tooEasy - tooHard) / 3)));
  return 1 + shift;
}

function scoreCandidate(
  topic: SelectionTopic,
  ctx: Context,
  dailyInWindow: DailyRecord[],
): Candidate {
  const { history, config } = ctx;
  const factors: Factor[] = [];
  let weight = 1;
  const push = (key: string, label: string, value: number, detail: string) => {
    factors.push({ key, label, value: Math.round(value * 100) / 100, detail });
    weight *= value;
  };

  // 1. Równowaga kategorii w ostatnich dniach.
  const total = dailyInWindow.length;
  const share =
    total === 0 ? 0 : dailyInWindow.filter((d) => d.category === topic.category).length / total;
  const target = 1 / Math.max(1, config.categories.length);
  const deficit = (target - share) / target;
  const balance = Math.max(0.25, Math.min(3, deficit >= 0 ? 1 + 2 * deficit : 1 + 0.5 * deficit));
  push(
    'balance',
    'Równowaga kategorii',
    balance,
    total === 0
      ? 'brak historii – wszystkie kategorie równe'
      : `ta kategoria to ${Math.round(share * 100)}% ostatnich tematów (cel ${Math.round(target * 100)}%)`,
  );

  // 2. Dopasowanie trudności.
  const targetIdx = targetLevelIndex(history.tooEasy, history.tooHard);
  const distance = Math.abs(levelIndex(topic.level) - targetIdx);
  push(
    'difficulty',
    'Dopasowanie trudności',
    Math.exp(-0.7 * distance),
    distance === 0 ? 'poziom zgodny z Twoimi ocenami' : `o ${distance} poziom od docelowego`,
  );

  // 3. Zainteresowanie kategorią (oceny 1–5).
  const interest = history.categoryInterest[topic.category];
  if (interest !== undefined) {
    push(
      'interest',
      'Zainteresowanie',
      0.6 + 0.8 * ((interest - 1) / 4),
      `średnia ocena kategorii: ${interest.toFixed(1)}/5`,
    );
  }

  // 4. Pogłębianie: temat powiązany z oznaczonym „do pogłębienia”.
  const deepenFrom = [...history.deepenIds].filter((id) => {
    const src = ctx.topics.get(id);
    return src ? src.next.includes(topic.id) || src.related.includes(topic.id) : false;
  });
  if (deepenFrom.length > 0)
    push(
      'deepen',
      'Pogłębienie',
      2,
      `kontynuuje temat oznaczony „do pogłębienia” (${deepenFrom[0]})`,
    );

  // 5. Wymagania wstępne, których jeszcze nie zrealizowano.
  const unmet = topic.prerequisites.filter((id) => {
    if (!ctx.topics.has(id)) return false; // tylko w katalogu – nie wiemy, nie karzemy
    const st = history.states.get(id)?.status;
    return st !== 'completed' && st !== 'known';
  });
  if (unmet.length > 0)
    push(
      'prerequisites',
      'Wymagania wstępne',
      Math.max(0.15, 0.5 ** unmet.length),
      `niezrealizowane: ${unmet.join(', ')}`,
    );

  // 6. Treść wymagająca weryfikacji.
  if (topic.needsReview) push('freshness', 'Aktualność', 0.5, 'termin przeglądu treści minął');

  return { topic, factors, weight };
}

export type SelectOptions = {
  topics: SelectionTopic[];
  history: SelectionHistory;
  config: SelectionConfig;
  today: string;
  random: () => number;
  /** dodatkowe losowanie: pomija regułę „nigdy wcześniej przypisany”, ale nie temat dnia */
  extraDraw?: boolean;
  excludeIds?: Iterable<string>;
};

export function selectTopic(options: SelectOptions): SelectionResult {
  const { topics, history, config, today, random } = options;
  const extraDraw = options.extraDraw ?? false;
  const ctx: Context = {
    topics: new Map(topics.map((t) => [t.id, t])),
    history,
    config,
    today,
    excludeIds: new Set(options.excludeIds ?? []),
  };

  const eligible = topics.filter((t) => hardExclusion(t, ctx, extraDraw) === null);
  if (eligible.length === 0) return null;

  // Rotacja kategorii: ta sama kategoria najwyżej N dni z rzędu (liczone wstecz od najnowszego dnia).
  const recent = [...history.daily].sort((a, b) => b.date.localeCompare(a.date));
  let blockedCategory: string | null = null;
  const n = config.maxSameCategoryInRow;
  if (recent.length >= n && recent.slice(0, n).every((d) => d.category === recent[0]!.category)) {
    blockedCategory = recent[0]!.category;
  }
  let pool = blockedCategory ? eligible.filter((t) => t.category !== blockedCategory) : eligible;
  let rotationRelaxed = false;
  if (pool.length === 0) {
    pool = eligible;
    rotationRelaxed = blockedCategory !== null;
  }

  const dailyInWindow = history.daily.filter((d) => {
    const age = daysBetween(d.date, today);
    return age > 0 && age <= config.balanceWindowDays;
  });

  const candidates = pool.map((t) => scoreCandidate(t, ctx, dailyInWindow));
  const sum = candidates.reduce((s, c) => s + c.weight, 0);
  let pick = random() * sum;
  let chosen = candidates[candidates.length - 1]!;
  for (const c of candidates) {
    pick -= c.weight;
    if (pick < 0) {
      chosen = c;
      break;
    }
  }
  return {
    topicId: chosen.topic.id,
    explanation: {
      candidates: candidates.length,
      rotationRelaxed,
      factors: chosen.factors,
      weight: Math.round(chosen.weight * 100) / 100,
    },
  };
}
