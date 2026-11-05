/** UUIDv7 (RFC 9562): 48 bitów czasu w ms + losowość. Sortowalny po czasie utworzenia. */
export function uuidv7(
  now: number = Date.now(),
  random: Uint8Array = crypto.getRandomValues(new Uint8Array(10)),
): string {
  if (random.length < 10) throw new Error('uuidv7: wymagane 10 bajtów losowości');
  const b = new Uint8Array(16);
  let t = BigInt(now);
  for (let i = 5; i >= 0; i--) {
    b[i] = Number(t & 0xffn);
    t >>= 8n;
  }
  b.set(random.subarray(0, 10), 6);
  b[6] = (b[6]! & 0x0f) | 0x70; // wersja 7
  b[8] = (b[8]! & 0x3f) | 0x80; // wariant RFC 4122
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
