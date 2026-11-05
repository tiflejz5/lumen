import { describe, expect, it } from 'vitest';
import { gradeShortAnswer, normalizeAnswer } from '../src/session-api.ts';

describe('ocenianie odpowiedzi krótkich', () => {
  it('ignoruje wielkość liter, interpunkcję, spacje i polskie znaki', () => {
    expect(normalizeAnswer('  Procent   Składany! ')).toBe('procent skladany');
    expect(gradeShortAnswer('PROCENT składany.', ['procent skladany'])).toBe(true);
    expect(gradeShortAnswer('Łódź', ['lodz'])).toBe(true);
  });
  it('odrzuca puste i błędne odpowiedzi', () => {
    expect(gradeShortAnswer('   ', ['x'])).toBe(false);
    expect(gradeShortAnswer('procent prosty', ['procent skladany'])).toBe(false);
  });
});
