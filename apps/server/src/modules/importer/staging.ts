import type { Staged } from './preview.ts';

const TTL_MS = 30 * 60 * 1000;
const MAX_STAGED = 3;

type Entry = { staged: Staged; addedAt: number };

/**
 * Podgląd importu czeka w pamięci na decyzję użytkownika. Nic nie trafia na dysk, a blokada bazy
 * czyści magazyn, więc treści z niezatwierdzonego importu nie przeżywają sesji.
 */
export class ImportStaging {
  private readonly items = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  put(staged: Staged): void {
    this.sweep();
    while (this.items.size >= MAX_STAGED) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.items.delete(oldest);
    }
    this.items.set(staged.preview.token, { staged, addedAt: this.now() });
  }

  get(token: string): Staged | null {
    this.sweep();
    return this.items.get(token)?.staged ?? null;
  }

  delete(token: string): void {
    this.items.delete(token);
  }

  clear(): void {
    this.items.clear();
  }

  private sweep(): void {
    const limit = this.now() - TTL_MS;
    for (const [token, entry] of this.items) {
      if (entry.addedAt < limit) this.items.delete(token);
    }
  }
}
