// Generuje launcher/lumen.ico (PNG 256×256 w kontenerze ICO) bez żadnych zależności.
// Uruchom ponownie tylko przy zmianie logo: node launcher/make-icon.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SIZE = 256;
const SS = 4; // supersampling dla gładkich krawędzi
const SURFACE = [0x15, 0x17, 0x1a];
const ACCENT = [0x4c, 0xc9, 0xb0];

function coverage(x, y) {
  // zwraca [r,g,b,a] dla punktu w przestrzeni 0..64 jak w favicon.svg
  const inRound = (() => {
    const r = 15;
    const dx = Math.max(r - x, 0, x - (64 - r));
    const dy = Math.max(r - y, 0, y - (64 - r));
    return x >= 0 && x <= 64 && y >= 0 && y <= 64 && dx * dx + dy * dy <= r * r;
  })();
  if (!inRound) return null;
  const d = Math.hypot(x - 32, y - 32);
  if (d <= 5 || (d >= 14 && d <= 18)) return ACCENT;
  return SURFACE;
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let py = 0; py < SIZE; py++) {
  raw[py * (SIZE * 4 + 1)] = 0; // filtr: brak
  for (let px = 0; px < SIZE; px++) {
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = coverage(
          ((px + (sx + 0.5) / SS) / SIZE) * 64,
          ((py + (sy + 0.5) / SS) / SIZE) * 64,
        );
        if (c) {
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
    }
    const n = SS * SS;
    const o = py * (SIZE * 4 + 1) + 1 + px * 4;
    raw[o] = a ? Math.round(r / a) : 0;
    raw[o + 1] = a ? Math.round(g / a) : 0;
    raw[o + 2] = a ? Math.round(b / a) : 0;
    raw[o + 3] = Math.round((a / n) * 255);
  }
}

function crc32(buf) {
  let c,
    crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6; // 8 bit, RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0;
entry[1] = 0; // 0 oznacza 256
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);
const out = fileURLToPath(new URL('./lumen.ico', import.meta.url));
writeFileSync(out, Buffer.concat([header, entry, png]));
console.log(`Zapisano ${out} (${png.length} B PNG)`);
