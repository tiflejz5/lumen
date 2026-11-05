import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ratio, ratioAtLeast, seededRandom } from '../src/index.ts';

const python = spawnSync('python', ['--version'], { encoding: 'utf8' });
const hasPython = python.status === 0;

describe('ratio – znane wartości z difflib', () => {
  it('zgadza się z wartościami referencyjnymi', () => {
    expect(ratio('', '')).toBe(1);
    expect(ratio('abc', 'abc')).toBe(1);
    expect(ratio('abc', 'xyz')).toBe(0);
    expect(ratio('abcd', 'bcde')).toBeCloseTo(0.75, 10);
    expect(ratio('private', 'private')).toBe(1);
    expect(ratio('kot', '')).toBe(0);
  });

  it('obsługuje polskie znaki jako pojedyncze punkty kodowe', () => {
    expect(ratio('żółć', 'żółć')).toBe(1);
    expect(ratio('zażółć', 'zazolc')).toBeLessThan(1);
  });

  it('ratioAtLeast jest zgodne z ratio (tani test górnej granicy nie zmienia wyniku)', () => {
    const rnd = seededRandom('ratioAtLeast');
    const alphabet = 'abcdeęłó ';
    const text = (n: number) =>
      Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
    for (let i = 0; i < 500; i++) {
      const a = text(Math.floor(rnd() * 40));
      const b = text(Math.floor(rnd() * 40));
      for (const th of [0.5, 0.8, 0.85]) {
        expect(ratioAtLeast(a, b, th), `${a}|${b}|${th}`).toBe(ratio(a, b) >= th);
      }
    }
  });
});

describe.skipIf(!hasPython)(
  'ratio – test różnicowy względem Pythona (difflib.SequenceMatcher)',
  () => {
    function pairs(): [string, string][] {
      const rnd = seededRandom('diff-pairs');
      const alphabet = 'aąbcćdeęfghijklłmnńoópqrsśtuvwxyzźż ,.-';
      const text = (n: number) =>
        Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
      const out: [string, string][] = [];
      for (let i = 0; i < 400; i++)
        out.push([text(Math.floor(rnd() * 70)), text(Math.floor(rnd() * 70))]);
      // blisko spokrewnione napisy (typowe duplikaty tytułów)
      for (let i = 0; i < 150; i++) {
        const base = text(20 + Math.floor(rnd() * 80));
        const cut = Math.floor(rnd() * base.length);
        out.push([
          base,
          base.slice(0, cut) +
            text(Math.floor(rnd() * 6)) +
            base.slice(cut + Math.floor(rnd() * 5)),
        ]);
      }
      // długie napisy (≥ 200 znaków) uruchamiają heurystykę autojunk
      for (let i = 0; i < 60; i++) {
        const base = text(220 + Math.floor(rnd() * 200));
        out.push([base, text(30) + base.slice(Math.floor(rnd() * 80))]);
        out.push([text(250), text(260)]);
      }
      return out;
    }

    it('daje identyczne wyniki dla ok. 800 par (w tym długich)', () => {
      const input = pairs();
      const script = `
import sys, json, difflib
pairs = json.load(sys.stdin)
print(json.dumps([difflib.SequenceMatcher(None, a, b).ratio() for a, b in pairs]))
`;
      const res = spawnSync('python', ['-X', 'utf8', '-c', script], {
        input: JSON.stringify(input),
        encoding: 'utf8',
        maxBuffer: 50_000_000,
      });
      expect(res.status, res.stderr).toBe(0);
      const expected = JSON.parse(res.stdout) as number[];
      expect(expected).toHaveLength(input.length);
      const mismatches = input
        .map(([a, b], i) => ({ i, ts: ratio(a, b), py: expected[i]! }))
        .filter((r) => Math.abs(r.ts - r.py) > 1e-12);
      expect(mismatches.slice(0, 5)).toEqual([]);
    });
  },
);
