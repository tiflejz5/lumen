import { describe, expect, it } from 'vitest';
import { extractLinks, matchesQuery, splitLinks, termKey } from '../src/knowledge-api.ts';

describe('baza wiedzy – czyste funkcje', () => {
  it('termKey ignoruje wielkość liter, spacje i polskie znaki', () => {
    expect(termKey('  Procent  Składany ')).toBe(termKey('procent skladany'));
  });

  it('extractLinks zwraca unikalne powiązania w kolejności', () => {
    expect(
      extractLinks('Zob. [[Inflacja]] oraz [[ Stopa procentowa ]] i znów [[Inflacja]].'),
    ).toEqual(['Inflacja', 'Stopa procentowa']);
    expect(extractLinks('[[]] [[a\nb]] brak')).toEqual([]);
  });

  it('splitLinks rozdziela tekst i powiązania', () => {
    expect(splitLinks('a [[B]] c')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'link', text: 'B' },
      { kind: 'text', text: ' c' },
    ]);
    expect(splitLinks('bez linków')).toEqual([{ kind: 'text', text: 'bez linków' }]);
  });

  it('matchesQuery wymaga wszystkich słów i toleruje ogonki', () => {
    expect(matchesQuery('Oszczędzanie na emeryturę', 'emeryture oszczedzanie')).toBe(true);
    expect(matchesQuery('Oszczędzanie', 'inflacja')).toBe(false);
    expect(matchesQuery('cokolwiek', '   ')).toBe(false);
  });
});
