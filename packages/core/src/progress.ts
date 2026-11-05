import { addDays, daysBetween } from './learning-day.ts';

/** Powtórki w odstępach, łagodny streak i odznaki – czysta logika współdzielona przez serwer i interfejs. */

// ── powtórki ───────────────────────────────────────────────────────────────────────────────────

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';
export const REVIEW_RATINGS: readonly ReviewRating[] = ['again', 'hard', 'good', 'easy'];

/** Odstępy (w dniach) kolejnych etapów powtórek. */
export const REVIEW_LADDER = [1, 3, 7, 16, 35, 75, 150] as const;

export type ReviewSchedule = { stage: number; dueDate: string };

/**
 * Następny termin powtórki. „Nie pamiętam” cofa do pierwszego etapu, „trudno” zostaje na tym samym etapie,
 * „dobrze” przechodzi o jeden etap dalej, „łatwo” o dwa. Po ostatnim etapie odstęp zostaje maksymalny.
 */
export function nextReview(stage: number, rating: ReviewRating, today: string): ReviewSchedule {
  const max = REVIEW_LADDER.length - 1;
  const next =
    rating === 'again'
      ? 0
      : rating === 'hard'
        ? stage
        : Math.min(max, stage + (rating === 'easy' ? 2 : 1));
  const clamped = Math.max(0, Math.min(max, next));
  // „Trudno” na etapie 0 nie powinno oznaczać powtórki jeszcze tego samego dnia.
  return { stage: clamped, dueDate: addDays(today, REVIEW_LADDER[clamped]!) };
}

// ── streak (łagodny) ───────────────────────────────────────────────────────────────────────────

export type StreakInfo = { current: number; longest: number; forgivenToday: boolean };

/**
 * Bieżąca seria liczona wstecz od `today`. Brak aktywności dziś nie przerywa serii (dzień jeszcze trwa).
 * Pojedynczy dzień wolny jest wybaczany, jeśli w ciągu poprzednich 6 dni nie wybaczono innego;
 * dwa dni wolne z rzędu kończą serię. Do długości serii liczą się tylko dni z aktywnością.
 */
export function currentStreak(activeDates: ReadonlySet<string>, today: string): number {
  let day = activeDates.has(today) ? today : addDays(today, -1);
  let count = 0;
  let lastForgiven: string | null = null;
  const earliest = [...activeDates].sort()[0];
  if (!earliest) return 0;
  while (day >= earliest) {
    if (activeDates.has(day)) {
      count++;
    } else {
      const canForgive = lastForgiven === null || daysBetween(day, lastForgiven) >= 7;
      if (!canForgive || !activeDates.has(addDays(day, -1))) break;
      lastForgiven = day;
    }
    day = addDays(day, -1);
  }
  return count;
}

export function streakInfo(activeDates: ReadonlySet<string>, today: string): StreakInfo {
  const current = currentStreak(activeDates, today);
  let longest = current;
  for (const d of activeDates) longest = Math.max(longest, currentStreak(activeDates, d));
  const yesterdayMissed = !activeDates.has(addDays(today, -1)) && !activeDates.has(today);
  return { current, longest, forgivenToday: current > 0 && yesterdayMissed };
}

// ── odznaki ────────────────────────────────────────────────────────────────────────────────────

export type BadgeInput = {
  completedTopics: number;
  sessions: number;
  activeSeconds: number;
  longestStreak: number;
  categoriesTouched: number;
  totalCategories: number;
  reviews: number;
  knowledgeEntries: number;
  perfectQuizzes: number;
};

export type BadgeDef = {
  id: string;
  title: string;
  description: string;
  /** postęp 0–1 do wyświetlenia, wartość >= 1 oznacza zdobycie */
  progress: (s: BadgeInput) => { value: number; goal: number };
};

const atLeast =
  (pick: (s: BadgeInput) => number, goal: number) =>
  (s: BadgeInput): { value: number; goal: number } => ({ value: Math.min(pick(s), goal), goal });

export const BADGES: readonly BadgeDef[] = [
  {
    id: 'first-session',
    title: 'Pierwszy krok',
    description: 'Ukończ pierwszą sesję nauki.',
    progress: atLeast((s) => s.completedTopics, 1),
  },
  {
    id: 'topics-10',
    title: 'Dziesięć tematów',
    description: 'Ukończ 10 tematów.',
    progress: atLeast((s) => s.completedTopics, 10),
  },
  {
    id: 'topics-50',
    title: 'Pięćdziesiąt tematów',
    description: 'Ukończ 50 tematów.',
    progress: atLeast((s) => s.completedTopics, 50),
  },
  {
    id: 'streak-7',
    title: 'Tydzień regularności',
    description: 'Seria 7 dni nauki (jeden dzień wolny w tygodniu jej nie przerywa).',
    progress: atLeast((s) => s.longestStreak, 7),
  },
  {
    id: 'streak-30',
    title: 'Miesiąc regularności',
    description: 'Seria 30 dni nauki.',
    progress: atLeast((s) => s.longestStreak, 30),
  },
  {
    id: 'hours-5',
    title: 'Pięć godzin nauki',
    description: 'Łącznie 5 godzin aktywnej nauki.',
    progress: atLeast((s) => Math.floor(s.activeSeconds / 60), 300),
  },
  {
    id: 'all-categories',
    title: 'Wszechstronność',
    description: 'Ukończ temat w każdej kategorii.',
    progress: (s) => ({
      value: Math.min(s.categoriesTouched, Math.max(1, s.totalCategories)),
      goal: Math.max(1, s.totalCategories),
    }),
  },
  {
    id: 'reviews-10',
    title: 'Pamięć w treningu',
    description: 'Wykonaj 10 powtórek.',
    progress: atLeast((s) => s.reviews, 10),
  },
  {
    id: 'knowledge-10',
    title: 'Własna encyklopedia',
    description: 'Zapisz 10 pojęć w bazie wiedzy.',
    progress: atLeast((s) => s.knowledgeEntries, 10),
  },
  {
    id: 'perfect-quiz-5',
    title: 'Celne sprawdzenie',
    description: 'Odpowiedz bezbłędnie na wszystkie pytania quizu w 5 sesjach.',
    progress: atLeast((s) => s.perfectQuizzes, 5),
  },
];

export type BadgeStatus = {
  id: string;
  title: string;
  description: string;
  value: number;
  goal: number;
  unlockedAt: string | null;
};

export function evaluateBadges(input: BadgeInput): { id: string; earned: boolean }[] {
  return BADGES.map((b) => {
    const p = b.progress(input);
    return { id: b.id, earned: p.value >= p.goal };
  });
}

// ── typy API ───────────────────────────────────────────────────────────────────────────────────

export type ReviewListItem = {
  topicId: string;
  title: string;
  category: string;
  stage: number;
  dueDate: string;
  overdueDays: number;
};

export type ReviewOverview = {
  date: string;
  due: ReviewListItem[];
  upcoming: ReviewListItem[];
};

export type ReviewCard = {
  topicId: string;
  title: string;
  mainQuestion: string;
  researchQuestions: string[];
};

export type ReviewAnswer = {
  brief: string;
  takeaways: string[];
  keyConcepts: { term: string; definition: string }[];
};

export type DayActivity = { date: string; minutes: number; sessions: number; reviews: number };

export type CategoryProgress = {
  category: string;
  completed: number;
  available: number;
  avgInterest: number | null;
  avgConfidence: number | null;
};

export type StatsOverview = {
  date: string;
  streak: StreakInfo;
  totals: {
    completedTopics: number;
    sessions: number;
    activeMinutes: number;
    reviews: number;
    knowledgeEntries: number;
    notes: number;
  };
  quizAccuracy: number | null;
  reviewsDue: number;
  last30: DayActivity[];
  categories: CategoryProgress[];
  /** kategorie z najniższą średnią pewnością – kandydaci do pogłębienia */
  weakest: string[];
};
