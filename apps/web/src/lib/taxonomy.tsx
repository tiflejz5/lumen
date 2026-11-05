import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TaxonomyDto } from '@lumen/core';
import { api } from './api';

/** Polskie etykiety używane, gdy taksonomia z bazy ich nie zawiera. */
const FALLBACK: Record<string, Record<string, string>> = {
  difficulty: {
    beginner: 'Początkujący',
    intermediate: 'Średniozaawansowany',
    advanced: 'Zaawansowany',
  },
  topic_type: { timeless: 'Ponadczasowy', current: 'Aktualny' },
  url_status: {
    verified: 'Adres sprawdzony',
    unverified: 'Adres niesprawdzony – szukaj po nazwie',
    institution_only: 'Wskazanie instytucji bez konkretnego adresu',
  },
  audit_grade: {
    A: 'Gotowy, bez zastrzeżeń',
    B: 'Gotowy, drobne uwagi',
    C: 'Dopuszczony warunkowo',
  },
};

export const USER_STATUS_LABEL: Record<string, string> = {
  in_progress: 'W toku',
  completed: 'Ukończony',
  skipped: 'Pominięty',
  postponed: 'Odłożony',
  known: 'Znany',
  not_interesting: 'Nieinteresujący',
};

type Labels = {
  categories: { id: string; label: string }[];
  category: (id: string) => string;
  subcategory: (id: string) => string;
  enumLabel: (group: string, id: string) => string;
};

const Ctx = createContext<Labels | null>(null);

export function TaxonomyProvider({ children }: { children: ReactNode }) {
  const [taxonomy, setTaxonomy] = useState<TaxonomyDto | null>(null);

  useEffect(() => {
    api<{ taxonomy: TaxonomyDto | null }>('GET', '/api/taxonomy').then(
      (r) => setTaxonomy(r.taxonomy),
      () => setTaxonomy(null),
    );
  }, []);

  const value = useMemo<Labels>(() => {
    const cats = taxonomy?.categories ?? [];
    const subs = new Map(cats.flatMap((c) => c.subcategories.map((s) => [s.id, s.label] as const)));
    return {
      categories: cats.map((c) => ({ id: c.id, label: c.label })),
      category: (id) => cats.find((c) => c.id === id)?.label ?? id,
      subcategory: (id) => subs.get(id) ?? id,
      enumLabel: (group, id) => taxonomy?.enums?.[group]?.[id] ?? FALLBACK[group]?.[id] ?? id,
    };
  }, [taxonomy]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLabels(): Labels {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLabels poza TaxonomyProvider');
  return ctx;
}
