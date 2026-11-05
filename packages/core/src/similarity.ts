/**
 * Port `difflib.SequenceMatcher(None, a, b).ratio()` z Pythona (autojunk=True, bez isjunk).
 * Progi podobieństwa w walidatorze bazy (0,80 / 0,85) zależą od dokładnie tego algorytmu,
 * więc trzymamy się go wiernie. Napisy są porównywane jako ciągi punktów kodowych (jak w Pythonie).
 */

type Seq = string[];

type Block = [number, number, number];

function buildB2j(b: Seq): { b2j: Map<string, number[]>; popular: Set<string> } {
  const b2j = new Map<string, number[]>();
  b.forEach((elt, i) => {
    const list = b2j.get(elt);
    if (list) list.push(i);
    else b2j.set(elt, [i]);
  });
  const popular = new Set<string>();
  const n = b.length;
  if (n >= 200) {
    const ntest = Math.floor(n / 100) + 1;
    for (const [elt, idxs] of b2j) {
      if (idxs.length > ntest) popular.add(elt);
    }
    for (const elt of popular) b2j.delete(elt);
  }
  return { b2j, popular };
}

function findLongestMatch(
  a: Seq,
  b: Seq,
  b2j: Map<string, number[]>,
  alo: number,
  ahi: number,
  blo: number,
  bhi: number,
): Block {
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;
  let j2len = new Map<number, number>();
  for (let i = alo; i < ahi; i++) {
    const newj2len = new Map<number, number>();
    const js = b2j.get(a[i]!) ?? [];
    for (const j of js) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) ?? 0) + 1;
      newj2len.set(j, k);
      if (k > bestsize) {
        besti = i - k + 1;
        bestj = j - k + 1;
        bestsize = k;
      }
    }
    j2len = newj2len;
  }
  // Rozszerzenie dopasowania o elementy „popularne” (usunięte z b2j); junk (isjunk) nie występuje.
  while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
    besti--;
    bestj--;
    bestsize++;
  }
  while (
    besti + bestsize < ahi &&
    bestj + bestsize < bhi &&
    a[besti + bestsize] === b[bestj + bestsize]
  ) {
    bestsize++;
  }
  return [besti, bestj, bestsize];
}

function matchedChars(a: Seq, b: Seq): number {
  const { b2j } = buildB2j(b);
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  let total = 0;
  while (queue.length > 0) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = findLongestMatch(a, b, b2j, alo, ahi, blo, bhi);
    if (k > 0) {
      total += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return total;
}

/** `SequenceMatcher(None, a, b).ratio()` */
export function ratio(a: string, b: string): number {
  const sa = Array.from(a);
  const sb = Array.from(b);
  const length = sa.length + sb.length;
  if (length === 0) return 1;
  return (2 * matchedChars(sa, sb)) / length;
}

/**
 * Czy `ratio(a, b) >= threshold`? Najpierw tani, dokładny test górnego ograniczenia
 * (ratio ≤ 2·min(|a|,|b|)/(|a|+|b|)), który odrzuca większość par bez pełnego porównania.
 */
export function ratioAtLeast(a: string, b: string, threshold: number): boolean {
  const la = Array.from(a).length;
  const lb = Array.from(b).length;
  const length = la + lb;
  if (length === 0) return true;
  if ((2 * Math.min(la, lb)) / length < threshold) return false;
  return ratio(a, b) >= threshold;
}
