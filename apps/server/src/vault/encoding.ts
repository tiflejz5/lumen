/** Base32 w wariancie Crockforda (bez I, L, O, U) – wygodny do ręcznego przepisywania. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Usuwa spacje i myślniki, ujednolica wielkość liter i typowe pomyłki (O→0, I/L→1). */
export function normalizeBase32(text: string): string {
  return text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

/** Dekoduje dokładnie `byteLength` bajtów; nadmiarowe bity wypełnienia muszą być zerowe. */
export function base32Decode(text: string, byteLength: number): Uint8Array | null {
  const clean = normalizeBase32(text);
  const expectedChars = Math.ceil((byteLength * 8) / 5);
  if (clean.length !== expectedChars) return null;
  const out = new Uint8Array(byteLength);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      if (index >= byteLength) return null;
      out[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  if (bits > 0 && (value & ((1 << bits) - 1)) !== 0) return null;
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'));
}
