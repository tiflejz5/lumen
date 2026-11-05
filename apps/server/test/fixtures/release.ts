import { createHash } from 'node:crypto';

/**
 * Syntetyczne wydania bazy do testów. Treści są neutralne i wymyślone na potrzeby testów
 * (nie pochodzą z żadnej prawdziwej paczki użytkownika).
 */

const CATEGORIES = [
  { id: 'finance', prefix: 'fin', subs: ['investing', 'economics'] },
  { id: 'science_tech', prefix: 'nau', subs: ['artificial_intelligence', 'physics'] },
  { id: 'health_sport', prefix: 'zdr', subs: ['physiology', 'nutrition'] },
  { id: 'history_society', prefix: 'his', subs: ['world_history', 'society'] },
  { id: 'psychology', prefix: 'psy', subs: ['cognition', 'wellbeing'] },
  { id: 'general', prefix: 'ogo', subs: ['language', 'culture'] },
] as const;

const NOUNS: [string, string][] = [
  ['termos', 'termos'],
  ['wiatrak', 'wiatrak'],
  ['kompas', 'kompas'],
  ['zegar wahadłowy', 'zegar-wahadlowy'],
  ['lodówka', 'lodowka'],
  ['peryskop', 'peryskop'],
  ['barometr', 'barometr'],
  ['dźwignia', 'dzwignia'],
  ['mikroskop', 'mikroskop'],
  ['akumulator', 'akumulator'],
  ['spadochron', 'spadochron'],
  ['drukarka 3D', 'drukarka-3d'],
  ['sejsmograf', 'sejsmograf'],
  ['siewnik', 'siewnik'],
  ['latarnia morska', 'latarnia-morska'],
  ['klepsydra', 'klepsydra'],
];

export type Json = Record<string, unknown>;

export function makeTaxonomy(): Json {
  return {
    taxonomy_version: '1.0.0',
    categories: CATEGORIES.map((c) => ({
      id: c.id,
      id_prefix: c.prefix,
      label: `Kategoria ${c.id}`,
      subcategories: c.subs.map((s) => ({ id: s, label: `Podkategoria ${s}` })),
    })),
    enums: {},
  };
}

export function makeSources(): Json {
  const base = {
    publisher: 'Instytut Testowy',
    source_type: 'expert_org',
    origin: 'primary',
    language: 'pl',
    description: 'Syntetyczne źródło używane wyłącznie w testach automatycznych aplikacji.',
    limitations: 'Źródło testowe – nie zawiera prawdziwych informacji.',
    url_status: 'verified',
    verified_at: '2026-01-10',
  };
  return {
    schema_version: '1.0.0',
    sources: ['a', 'b', 'c'].map((k) => ({
      id: `src-test-${k}`,
      name: `Źródło testowe ${k.toUpperCase()}`,
      url: `https://example.org/${k}`,
      ...base,
    })),
  };
}

export type TopicOptions = {
  /** numer porządkowy → rzeczownik, ID i kategoria */
  n: number;
  revision?: number;
  level?: 'beginner' | 'intermediate' | 'advanced';
  topicType?: 'timeless' | 'current';
  status?: 'active' | 'deprecated';
  lastVerifiedAt?: string;
  relations?: Partial<{ prerequisites: string[]; related: string[]; next: string[] }>;
  /** nadpisanie pojedynczych pól rdzenia (np. title) */
  core?: Json;
};

export function makeTopic(options: TopicOptions): Json {
  const { n } = options;
  const [noun, slug] = NOUNS[(n - 1) % NOUNS.length]!;
  const cat = CATEGORIES[(n - 1) % CATEGORIES.length]!;
  const seq = Math.floor((n - 1) / CATEGORIES.length) + 1;
  const id = `${cat.prefix}-${String(seq).padStart(4, '0')}`;
  const revision = options.revision ?? 1;
  const level = options.level ?? 'beginner';
  const scores = {
    beginner: [1, 1, 1, 1, 1],
    intermediate: [2, 2, 2, 2, 2],
    advanced: [3, 3, 3, 3, 3],
  }[level];
  const topicType = options.topicType ?? 'timeless';
  const current = topicType === 'current';
  const verified = options.lastVerifiedAt ?? '2026-01-10';
  const text = (s: string) => `${s} (${noun})`;

  const core: Json = {
    title: `Jak działa ${noun} i dlaczego ma to znaczenie w praktyce?`,
    category: cat.id,
    subcategory: cat.subs[0],
    difficulty: {
      level,
      scores: Object.fromEntries(
        ['prior_knowledge', 'complexity', 'abstraction', 'research_difficulty', 'concept_load'].map(
          (k, i) => [k, scores[i]],
        ),
      ),
    },
    topic_type: topicType,
    ...(current ? { current_subtype: 'structural' } : {}),
    summary: `Poznasz podstawową zasadę działania obiektu „${noun}” i sprawdzisz, od czego zależy jego zachowanie w typowych warunkach.`,
    why_it_matters: `Zrozumienie tego mechanizmu pozwala samodzielnie oceniać informacje na temat obiektu „${noun}” i odróżniać fakty od uproszczeń.`,
    main_question: `Od jakich trzech czynników zależy działanie obiektu „${noun}” i jak można to samodzielnie sprawdzić?`,
    research_questions: [
      `Jaka zasada fizyczna lub logiczna leży u podstaw działania obiektu „${noun}”?`,
      `Z jakich części składa się „${noun}” i jaką rolę pełni każda z nich?`,
      `W jakich warunkach „${noun}” przestaje działać zgodnie z oczekiwaniami i dlaczego?`,
      `Jak producenci lub badacze weryfikują sprawność obiektu „${noun}”?`,
    ],
    keywords: [noun, 'mechanizm', 'weryfikacja'],
    search_queries: [
      { query: `zasada działania ${noun}`, lang: 'pl', purpose: 'Znaleźć ogólny opis mechanizmu.' },
      {
        query: `${noun} budowa i części`,
        lang: 'pl',
        purpose: 'Poznać elementy składowe i ich funkcje.',
      },
    ],
    suggested_sources: [
      {
        source_id: 'src-test-a',
        why: 'Przystępne omówienie podstaw.',
        what_to_find: 'Opis zasady działania i typowych zastosowań.',
      },
      {
        source_id: 'src-test-b',
        why: 'Dane techniczne z jawną metodologią.',
        what_to_find: 'Parametry i ograniczenia w praktyce.',
      },
    ],
    verification_tips: [
      'Sprawdź, czy opis pochodzi od producenta, czy od niezależnego autora, i porównaj co najmniej dwa ujęcia.',
      'Zwróć uwagę, czy źródło podaje warunki, w jakich mechanizm działa, a nie tylko ogólne hasła.',
    ],
    final_task:
      'Zapisz w 3–4 zdaniach odpowiedź na pytanie główne i dodaj zdanie o tym, czego nie udało Ci się ustalić.',
    estimated_minutes: { research: 10, quiz: 2, summary: 3 },
    ...(options.core ?? {}),
  };

  return {
    id,
    slug: `${slug}-test`,
    revision,
    status: options.status ?? 'active',
    core,
    extended: {
      key_concepts: [
        {
          term: 'Zasada działania',
          definition: text(
            'Podstawowy mechanizm, który decyduje o tym, jak urządzenie realizuje swoją funkcję',
          ),
        },
        {
          term: 'Warunki brzegowe',
          definition: text(
            'Okoliczności, w których mechanizm działa zgodnie z założeniami, a poza którymi zawodzi',
          ),
        },
      ],
      examples: [
        text('Typowy przykład użycia w warunkach domowych'),
        text('Przykład z zastosowania przemysłowego'),
      ],
      background: `Obiekt „${noun}” jest znany od dawna i doczekał się wielu odmian. Jego rozwój wiązał się z poprawą materiałów oraz lepszym rozumieniem zjawisk, na których się opiera.`,
      misconceptions: [
        {
          claim: `Obiekt „${noun}” działa zawsze tak samo, niezależnie od warunków.`,
          correction:
            'Działanie zależy od warunków otoczenia i jakości wykonania, dlatego warto znać granice stosowalności.',
        },
      ],
      deeper_questions: [
        `Jak zmieniłoby się działanie obiektu „${noun}” przy innym materiale?`,
        `Jakie są granice dokładności obiektu „${noun}”?`,
      ],
      challenge: `Zaprojektuj prosty eksperyment, który pozwoli porównać dwa warianty obiektu „${noun}” i wskaż, jaki wynik obaliłby Twoją hipotezę.`,
      brief: `Obiekt „${noun}” działa dzięki prostej zasadzie, którą można opisać kilkoma zdaniami. Najważniejsze jest zrozumienie, co jest przyczyną, a co skutkiem, oraz jakie założenia muszą być spełnione. W praktyce wyniki zależą od jakości wykonania i warunków otoczenia, dlatego porównuje się je z wartościami referencyjnymi. Opracowanie ma charakter testowy i nie zawiera prawdziwych informacji o żadnym urządzeniu.`,
      takeaways: [
        'Mechanizm da się opisać prostą zasadą.',
        'Warunki otoczenia wpływają na wynik.',
        'Wnioski warto weryfikować w więcej niż jednym źródle.',
      ],
      knowledge_limits:
        'Opracowanie jest syntetyczne i służy wyłącznie testom, więc nie można go traktować jako źródła wiedzy.',
      claims: [
        {
          text: `Działanie obiektu „${noun}” opiera się na jednej, dobrze opisanej zasadzie.`,
          claim_type: 'fact',
          source_ids: ['src-test-a'],
        },
        {
          text: 'Dokładność zależy od jakości wykonania.',
          claim_type: 'interpretation',
          source_ids: ['src-test-b'],
        },
      ],
    },
    quiz: [
      {
        id: 'q1',
        type: 'single_choice',
        skill: 'application',
        difficulty: 'beginner',
        prompt: `Który czynnik ma największy wpływ na działanie obiektu „${noun}” w opisanym scenariuszu testowym?`,
        options: ['Warunki otoczenia', 'Kolor obudowy', 'Nazwa producenta', 'Pora dnia'],
        correct_option: 0,
        explanation:
          'W scenariuszu testowym decydują warunki otoczenia; pozostałe czynniki nie mają wpływu.',
      },
      {
        id: 'q2',
        type: 'single_choice',
        skill: 'inference',
        difficulty: 'beginner',
        prompt: `Co można wnioskować, gdy obiekt „${noun}” nie działa zgodnie z oczekiwaniami?`,
        options: [
          'Zawsze jest uszkodzony',
          'Mógł wyjść poza warunki brzegowe',
          'Prawa fizyki przestały obowiązywać',
          'Nie da się tego sprawdzić',
        ],
        correct_option: 1,
        explanation:
          'Najpierw sprawdza się, czy zostały spełnione założenia, a dopiero potem szuka usterki.',
      },
    ],
    speaking_task: {
      format: 'explain_novice',
      prompt: `Wyjaśnij osobie początkującej, jak działa „${noun}”, używając jednego przykładu z codzienności.`,
      duration_seconds: 120,
    },
    relations: {
      prerequisites: [],
      related: [],
      next: [],
      paths: [],
      ...(options.relations ?? {}),
    },
    freshness: {
      created_at: '2026-01-10',
      last_verified_at: verified,
      valid_as_of: verified,
      requires_periodic_update: current,
      review_interval_months: current ? 12 : null,
      status: 'current',
      ...(current
        ? {
            time_sensitive_items: [
              `Parametry obiektu „${noun}” mogą się zmieniać z nowymi modelami.`,
            ],
          }
        : {}),
    },
    meta: {
      concept_tags: [slug, 'mechanizm-dzialania', `${slug}-przyklad`],
      question_type: 'mechanism',
      mainstream: true,
      regions: ['global'],
    },
    audit: { grade: 'A', audited_at: '2026-01-10', issues: [], uncertainties: [] },
    changelog: Array.from({ length: revision }, (_, i) => ({
      revision: i + 1,
      date: '2026-01-10',
      change: i === 0 ? 'Pierwsza wersja.' : `Zmiana treści ${i + 1}.`,
    })),
  };
}

export function makePack(packId: string, topics: Json[], extra: Json = {}): Json {
  return {
    pack_id: packId,
    schema_version: '1.0.0',
    created_at: '2026-01-10',
    description: 'Paczka testowa',
    topics,
    ...extra,
  };
}

export type Release = { files: Record<string, Buffer> };

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export function makeRelease(
  packs: Json[],
  options: {
    baseVersion?: string;
    sources?: Json;
    taxonomy?: Json;
    schemaVersion?: string;
    tamper?: (files: Record<string, Buffer>) => void;
  } = {},
): Release {
  const files: Record<string, Buffer> = {
    'data/taxonomy.json': Buffer.from(JSON.stringify(options.taxonomy ?? makeTaxonomy(), null, 2)),
    'data/sources.json': Buffer.from(JSON.stringify(options.sources ?? makeSources(), null, 2)),
  };
  for (const pack of packs)
    files[`data/packs/${pack.pack_id as string}.json`] = Buffer.from(JSON.stringify(pack, null, 2));
  const entries = Object.entries(files).map(([path, bytes]) => {
    const role = path.endsWith('taxonomy.json')
      ? 'taxonomy'
      : path.endsWith('sources.json')
        ? 'sources'
        : 'pack';
    const pack =
      role === 'pack'
        ? (JSON.parse(bytes.toString()) as { topics: unknown[]; is_example?: boolean })
        : null;
    return {
      path,
      role,
      sha256: sha256(bytes),
      ...(pack
        ? { topic_count: pack.topics.length, ...(pack.is_example ? { is_example: true } : {}) }
        : {}),
    };
  });
  const all = packs.flatMap(
    (p) =>
      p.topics as {
        core: { category: string; difficulty: { level: string }; topic_type: string };
      }[],
  );
  const count = (f: (t: (typeof all)[number]) => string) => {
    const out: Record<string, number> = {};
    for (const t of all) out[f(t)] = (out[f(t)] ?? 0) + 1;
    return out;
  };
  const manifest = {
    base_name: 'Baza testowa',
    base_version: options.baseVersion ?? '0.1.0',
    schema_version: options.schemaVersion ?? '1.0.0',
    taxonomy_version: '1.0.0',
    released_at: '2026-01-10',
    files: entries,
    stats: {
      total_topics: all.length,
      by_category: count((t) => t.core.category),
      by_difficulty: count((t) => t.core.difficulty.level),
      by_topic_type: count((t) => t.core.topic_type),
    },
  };
  files['manifest.json'] = Buffer.from(JSON.stringify(manifest, null, 2));
  options.tamper?.(files);
  return { files };
}

/** Wydanie z `count` tematami w jednej paczce. */
export function simpleRelease(count = 6, options: Parameters<typeof makeRelease>[1] = {}): Release {
  return makeRelease(
    [
      makePack(
        'pack-001',
        Array.from({ length: count }, (_, i) => makeTopic({ n: i + 1 })),
      ),
    ],
    options,
  );
}
