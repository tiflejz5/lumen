import { describe, expect, it } from 'vitest';
import {
  BADGES,
  REVIEW_LADDER,
  currentStreak,
  evaluateBadges,
  nextReview,
  streakInfo,
  type BadgeInput,
} from '../src/progress.ts';

const days = (...d: string[]) => new Set(d.map((x) => `2026-11-${x}`));

describe('harmonogram powtórek', () => {
  it('dobrze przesuwa o etap, łatwo o dwa, trudno zostaje, nie pamiętam wraca na początek', () => {
    expect(nextReview(0, 'good', '2026-11-05')).toEqual({ stage: 1, dueDate: '2026-11-08' });
    expect(nextReview(1, 'easy', '2026-11-05')).toEqual({ stage: 3, dueDate: '2026-11-21' });
    expect(nextReview(2, 'hard', '2026-11-05')).toEqual({ stage: 2, dueDate: '2026-11-12' });
    expect(nextReview(4, 'again', '2026-11-05')).toEqual({ stage: 0, dueDate: '2026-11-06' });
  });

  it('nie wychodzi poza ostatni etap i zawsze wyznacza przyszłą datę', () => {
    const last = REVIEW_LADDER.length - 1;
    expect(nextReview(last, 'easy', '2026-11-05').stage).toBe(last);
    for (const stage of REVIEW_LADDER.keys())
      for (const r of ['again', 'hard', 'good', 'easy'] as const)
        expect(nextReview(stage, r, '2026-11-05').dueDate > '2026-11-05').toBe(true);
  });
});

describe('łagodny streak', () => {
  it('liczy kolejne dni; brak aktywności dziś nie przerywa serii', () => {
    expect(currentStreak(days('03', '04', '05'), '2026-11-05')).toBe(3);
    expect(currentStreak(days('02', '03', '04'), '2026-11-05')).toBe(3);
  });

  it('wybacza pojedynczy dzień wolny w tygodniu', () => {
    expect(currentStreak(days('01', '02', '04', '05'), '2026-11-05')).toBe(4);
  });

  it('dwa dni wolne z rzędu przerywają serię', () => {
    expect(currentStreak(days('01', '02', '05'), '2026-11-05')).toBe(1);
    expect(currentStreak(days('01', '02'), '2026-11-05')).toBe(0);
  });

  it('drugi wolny dzień w ciągu 7 dni nie jest wybaczany, po tygodniu znów tak', () => {
    // brak 03 i 05 (odstęp 2 dni) – drugi wolny dzień przerywa
    expect(currentStreak(days('01', '02', '04', '06'), '2026-11-06')).toBe(2);
    expect(
      currentStreak(
        new Set([
          '2026-11-01',
          '2026-11-03',
          '2026-11-04',
          '2026-11-05',
          '2026-11-06',
          '2026-11-07',
          '2026-11-08',
          '2026-11-09',
          '2026-11-11',
        ]),
        '2026-11-11',
      ),
    ).toBe(9);
  });

  it('brak aktywności daje 0, a najdłuższa seria pamięta wcześniejsze serie', () => {
    expect(currentStreak(new Set(), '2026-11-05')).toBe(0);
    const info = streakInfo(days('01', '02', '03', '04', '05', '06', '09'), '2026-11-09');
    expect(info.longest).toBe(6);
    expect(info.current).toBe(1);
  });
});

const empty: BadgeInput = {
  completedTopics: 0,
  sessions: 0,
  activeSeconds: 0,
  longestStreak: 0,
  categoriesTouched: 0,
  totalCategories: 6,
  reviews: 0,
  knowledgeEntries: 0,
  perfectQuizzes: 0,
};

describe('odznaki', () => {
  it('identyfikatory są unikalne, a na starcie nic nie jest zdobyte', () => {
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
    expect(evaluateBadges(empty).every((b) => !b.earned)).toBe(true);
  });

  it('przyznaje odznaki po spełnieniu progów', () => {
    const earned = (input: BadgeInput) =>
      evaluateBadges(input)
        .filter((b) => b.earned)
        .map((b) => b.id);
    expect(earned({ ...empty, completedTopics: 1 })).toEqual(['first-session']);
    expect(earned({ ...empty, longestStreak: 7 })).toEqual(['streak-7']);
    expect(earned({ ...empty, activeSeconds: 5 * 3600 })).toEqual(['hours-5']);
    expect(earned({ ...empty, categoriesTouched: 6 })).toEqual(['all-categories']);
  });
});
