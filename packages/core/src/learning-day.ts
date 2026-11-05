/**
 * „Dzień nauki” w czasie lokalnym użytkownika. Godziny przed `dayStartHour` należą jeszcze
 * do poprzedniego dnia (sesja o 00:30 nie otwiera nowego dnia).
 */
export function learningDate(now: Date, dayStartHour: number): string {
  const shifted = new Date(now.getTime() - dayStartHour * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getFullYear()}-${p(shifted.getMonth() + 1)}-${p(shifted.getDate())}`;
}

/** Dodaje (lub odejmuje) dni do daty RRRR-MM-DD, bez wpływu strefy czasowej. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const f = from.split('-').map(Number) as [number, number, number];
  const t = to.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(t[0], t[1] - 1, t[2]) - Date.UTC(f[0], f[1] - 1, f[2])) / 86_400_000);
}
