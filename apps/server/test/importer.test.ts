import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyImport,
  getImportReport,
  listImports,
  ImportApplyError,
} from '../src/modules/importer/apply.ts';
import { buildPreview, type ImportPreview, type Staged } from '../src/modules/importer/preview.ts';
import { ImportStaging } from '../src/modules/importer/staging.ts';
import {
  makePack,
  makeRelease,
  makeSources,
  makeTaxonomy,
  makeTopic,
  simpleRelease,
  type Json,
  type Release,
} from './fixtures/release.ts';
import { makeEnv, type TestEnv } from './helpers.ts';

const TODAY = '2026-11-05';
let env: TestEnv;

beforeEach(async () => {
  env = await makeEnv();
});
afterEach(async () => {
  await env.cleanup();
});

const toFiles = (r: Release, prefix = '') =>
  Object.entries(r.files).map(([path, bytes]) => ({ path: prefix + path, bytes }));

function preview(
  release: Release,
  options: { includeExamples?: boolean; prefix?: string } = {},
): Staged {
  return buildPreview(env.db, toFiles(release, options.prefix), {
    includeExamples: options.includeExamples ?? false,
    today: TODAY,
  });
}

async function apply(staged: Staged, ids?: string[]) {
  const selected = ids ?? staged.preview.topics.filter((t) => t.defaultSelected).map((t) => t.id);
  return applyImport({
    db: env.db,
    staged,
    selectedIds: selected,
    now: new Date('2026-11-05T10:00:00Z'),
    snapshot: async () => 'kopia-testowa.bazabak',
  });
}

const topicRows = () =>
  env.db.prepare('SELECT id, revision FROM topics ORDER BY id').all() as {
    id: string;
    revision: number;
  }[];
const scalar = (sql: string) =>
  Object.values(env.db.prepare(sql).get() as Record<string, number>)[0]!;

describe('parser wydania', () => {
  it('poprawne wydanie: brak błędów krytycznych, wszystkie tematy nowe i zaznaczone', () => {
    const { preview: p } = preview(simpleRelease(6));
    expect(p.fatal).toEqual([]);
    expect(p.mode).toBe('release');
    expect(p.baseVersion).toBe('0.1.0');
    expect(p.counts.new).toBe(6);
    expect(p.topics.every((t) => t.selectable && t.defaultSelected && t.errors.length === 0)).toBe(
      true,
    );
    expect(p.sources).toEqual({ total: 3, added: 3, changed: 0 });
    expect(p.taxonomyChanged).toBe(true);
  });

  it('rozpoznaje wydanie w podfolderze (wybór katalogu nadrzędnego)', () => {
    const { preview: p } = preview(simpleRelease(3), { prefix: 'wiedza-baza/' });
    expect(p.fatal).toEqual([]);
    expect(p.counts.new).toBe(3);
  });

  it('zatrzymuje import, gdy suma SHA-256 pliku nie zgadza się z manifestem', () => {
    const release = simpleRelease(3, {
      tamper: (files) => {
        files['data/packs/pack-001.json'] = Buffer.from(
          files['data/packs/pack-001.json']!.toString().replace('Paczka testowa', 'Zmieniona'),
        );
      },
    });
    const { preview: p } = preview(release);
    expect(p.blocked).toBe(true);
    expect(p.fatal.join(' ')).toMatch(/SHA-256.*pack-001\.json/);
    expect(p.topics).toEqual([]);
  });

  it('zatrzymuje import, gdy plik z manifestu nie został dołączony', () => {
    const release = simpleRelease(3);
    delete release.files['data/sources.json'];
    expect(preview(release).preview.fatal.join(' ')).toMatch(/Brak pliku „data\/sources\.json”/);
  });

  it('odmawia wersji głównej schematu, której aplikacja nie obsługuje', () => {
    const { preview: p } = preview(simpleRelease(3, { schemaVersion: '2.0.0' }));
    expect(p.blocked).toBe(true);
    expect(p.fatal.join(' ')).toMatch(/schematu 2\.0\.0/);
  });

  it('odrzuca niebezpieczne ścieżki plików', () => {
    for (const path of ['../manifest.json', '/etc/passwd', 'C:\\x.json', 'a//b.json']) {
      const p = buildPreview(env.db, [{ path, bytes: Buffer.from('{}') }], {
        includeExamples: false,
        today: TODAY,
      }).preview;
      expect(p.blocked, path).toBe(true);
    }
  });

  it('zgłasza uszkodzony manifest i brak plików', () => {
    expect(
      buildPreview(env.db, [{ path: 'manifest.json', bytes: Buffer.from('{nie json') }], {
        includeExamples: false,
        today: TODAY,
      }).preview.fatal[0],
    ).toMatch(/niepoprawny JSON/);
    expect(buildPreview(env.db, [], { includeExamples: false, today: TODAY }).preview.blocked).toBe(
      true,
    );
  });
});

describe('walidacja rekordów', () => {
  const release = (mutate: (topics: Json[]) => void, count = 4) => {
    const topics = Array.from({ length: count }, (_, i) => makeTopic({ n: i + 1 }));
    mutate(topics);
    return makeRelease([makePack('pack-001', topics)]);
  };
  type T = any; // eslint-disable-line @typescript-eslint/no-explicit-any

  it('odrzuca tylko nieprawidłowy rekord, pozostałe zostają do zatwierdzenia', () => {
    const { preview: p } = preview(
      release((t) => {
        delete (t[1] as T).core.title;
      }),
    );
    expect(p.counts.invalid).toBe(1);
    expect(p.counts.new).toBe(3);
    const bad = p.topics.find((t) => t.action === 'invalid')!;
    expect(bad.selectable).toBe(false);
    expect(bad.errors.join(' ')).toMatch(/schemat/);
  });

  it('wykrywa literówkę w nazwie pola (additionalProperties: false)', () => {
    const { preview: p } = preview(
      release((t) => {
        (t[0] as T).core.sumary = 'literówka';
      }),
    );
    expect(p.topics[0]!.action).toBe('invalid');
  });

  it('stosuje reguły poziomu 2: trudność niezgodna z sumą ocen', () => {
    const { preview: p } = preview(
      release((t) => {
        (t[0] as T).core.difficulty.level = 'advanced';
      }),
    );
    expect(p.topics[0]!.action).toBe('invalid');
    expect(p.topics[0]!.errors.join(' ')).toMatch(/niezgodny z sumą ocen/);
  });

  it('wykrywa powtórzone ID, slug i pytanie główne', () => {
    const { preview: p } = preview(
      release((t) => {
        (t[1] as T).id = (t[0] as T).id;
        (t[2] as T).slug = (t[3] as T).slug;
        (t[3] as T).core.main_question = (t[2] as T).core.main_question;
      }),
    );
    expect(p.topics.filter((t) => t.action === 'invalid').length).toBeGreaterThanOrEqual(2);
    expect(p.topics.flatMap((t) => t.errors).join(' ')).toMatch(/powtórzone ID tematu/);
  });

  it('wykrywa relację do nieistniejącego tematu i cykl wymagań wstępnych', () => {
    const { preview: p } = preview(
      release((t) => {
        (t[0] as T).relations.related = ['fin-9999'];
        (t[1] as T).relations.prerequisites = [(t[2] as T).id];
        (t[2] as T).relations.prerequisites = [(t[1] as T).id];
      }),
    );
    const errors = p.topics.flatMap((t) => t.errors).join(' ');
    expect(errors).toMatch(/nieznany temat 'fin-9999'/);
    expect(errors).toMatch(/cykl w prerequisites/);
  });

  it('relacja do tytułu z katalogu jest dozwolona (zarezerwowane ID)', () => {
    const topics = [makeTopic({ n: 1 })];
    (topics[0] as T).relations.next = ['fin-0500'];
    const rel = makeRelease([makePack('pack-001', topics)]);
    expect(preview(rel).preview.topics[0]!.errors.join(' ')).toMatch(/fin-0500/);
    rel.files['catalog.json'] = Buffer.from(
      JSON.stringify({
        catalog_version: '0.1.0',
        entries: [
          {
            id: 'fin-0500',
            title: 'Zaplanowany',
            category: 'finance',
            subcategory: 'investing',
            difficulty: 'beginner',
            topic_type: 'timeless',
          },
        ],
      }),
    );
    const { preview: p } = preview(rel);
    expect(p.topics[0]!.errors).toEqual([]);
    expect(p.catalog).toEqual({ version: '0.1.0', total: 1, added: 1 });
  });

  it('zgłasza nieistniejące źródło', () => {
    const { preview: p } = preview(
      release((t) => {
        (t[0] as T).core.suggested_sources[0].source_id = 'src-nie-ma';
      }),
    );
    expect(p.topics[0]!.errors.join(' ')).toMatch(/nie istnieje w data\/sources\.json/);
  });

  it('uszkodzony JSON paczki nie blokuje innych paczek', () => {
    const r = makeRelease([
      makePack('pack-001', [makeTopic({ n: 1 })]),
      makePack('pack-002', [makeTopic({ n: 2 })]),
    ]);
    // plik zmieniony razem z sumą w manifeście, by symulować błąd treści, a nie zmianę po wydaniu
    const broken = Buffer.from('{ "pack_id": "pack-002", ');
    r.files['data/packs/pack-002.json'] = broken;
    const manifest = JSON.parse(r.files['manifest.json']!.toString());
    manifest.files.find((f: { path: string }) => f.path.endsWith('pack-002.json')).sha256 =
      createHash('sha256').update(broken).digest('hex');
    r.files['manifest.json'] = Buffer.from(JSON.stringify(manifest));
    const { preview: p } = preview(r);
    expect(p.fatal).toEqual([]);
    expect(p.counts.new).toBe(1);
    expect(p.packs.find((x) => x.file === 'pack-002.json')!.errors[0]).toMatch(/niepoprawny JSON/);
  });
});

describe('klasyfikacja względem bazy lokalnej', () => {
  async function importAll(count = 4) {
    const staged = preview(simpleRelease(count));
    await apply(staged);
  }
  const releaseOf = (build: (n: number) => Json, count = 4) =>
    makeRelease([
      makePack(
        'pack-001',
        Array.from({ length: count }, (_, i) => build(i + 1)),
      ),
    ]);

  it('ponowny import tego samego wydania: wszystko bez zmian', async () => {
    await importAll();
    const { preview: p } = preview(simpleRelease(4));
    expect(p.counts.unchanged).toBe(4);
    expect(p.counts.new).toBe(0);
  });

  it('wyższa rewizja = aktualizacja, domyślnie NIE zaznaczona; pokazuje zmienione sekcje i opis zmiany', async () => {
    await importAll();
    const { preview: p } = preview(
      releaseOf((n) =>
        n === 1
          ? makeTopic({
              n,
              revision: 2,
              core: {
                summary:
                  'Zupełnie nowy opis tematu, który jest dostatecznie długi, by spełnić wymagania schematu.',
              },
            })
          : makeTopic({ n }),
      ),
    );
    const t = p.topics.find((x) => x.action === 'update')!;
    expect(t).toBeDefined();
    expect(t.defaultSelected).toBe(false);
    expect(t.selectable).toBe(true);
    expect(t.localRevision).toBe(1);
    expect(t.changedSections).toContain('core.summary');
    expect(t.changeNote).toMatch(/Zmiana treści 2/);
  });

  it('ta sama rewizja, inna treść = konflikt wersji', async () => {
    await importAll();
    const { preview: p } = preview(
      releaseOf((n) =>
        n === 2
          ? makeTopic({
              n,
              core: {
                final_task: 'Zmieniona treść zadania końcowego bez podniesienia numeru rewizji.',
              },
            })
          : makeTopic({ n }),
      ),
    );
    expect(p.topics.filter((t) => t.action === 'conflict').map((t) => t.id)).toHaveLength(1);
    expect(p.counts.conflict).toBe(1);
  });

  it('niższa rewizja = pomijana jako starsza', async () => {
    await importAll(2);
    const staged = preview(releaseOf((n) => makeTopic({ n, revision: 2 }), 2));
    await apply(
      staged,
      staged.preview.topics.map((t) => t.id),
    );
    const { preview: p } = preview(simpleRelease(2));
    expect(p.counts.older).toBe(2);
    expect(p.topics.every((t) => !t.selectable)).toBe(true);
  });

  it('nowsza weryfikacja bez zmiany treści = odświeżenie (tylko blok freshness)', async () => {
    await importAll();
    const { preview: p } = preview(
      releaseOf((n) => makeTopic({ n, lastVerifiedAt: '2026-06-01' })),
    );
    expect(p.counts.refresh).toBe(4);
    expect(p.topics[0]!.changedSections.every((s) => s.startsWith('freshness'))).toBe(true);
    expect(p.topics[0]!.defaultSelected).toBe(false);
  });

  it('wykrywa temat lokalny nieobecny w nowym wydaniu, ale go nie usuwa', async () => {
    await importAll(4);
    const staged = preview(simpleRelease(2));
    expect(staged.preview.missingLocal).toHaveLength(2);
    await apply(staged, []);
    expect(topicRows()).toHaveLength(4);
  });

  it('slug zajęty przez inny zapisany temat jest błędem już w podglądzie', async () => {
    await importAll(2);
    const topics = [makeTopic({ n: 1 }), makeTopic({ n: 7 })];
    (topics[1] as { slug: string }).slug = (makeTopic({ n: 1 }) as { slug: string }).slug;
    const { preview: p } = preview(makeRelease([makePack('pack-009', topics)]));
    expect(p.topics.find((t) => t.action === 'invalid')!.errors.join(' ')).toMatch(
      /slug .* jest już używany/,
    );
  });
});

describe('zatwierdzanie i zapis', () => {
  it('zapisuje zaznaczone tematy, źródła, taksonomię, relacje i historię wersji', async () => {
    const topics = [makeTopic({ n: 1 }), makeTopic({ n: 2 })];
    (topics[0] as any).relations.related = [(topics[1] as any).id]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const staged = preview(makeRelease([makePack('pack-001', topics)]));
    const report = await apply(staged);
    expect(report.summary).toMatchObject({
      imported: 2,
      inserted: 2,
      sourcesWritten: 3,
      rejected: 0,
    });
    expect(topicRows()).toHaveLength(2);
    expect(scalar('SELECT count(*) FROM sources')).toBe(3);
    expect(scalar('SELECT count(*) FROM topic_versions')).toBe(2);
    expect(scalar("SELECT count(*) FROM topic_relations WHERE kind = 'related'")).toBe(1);
    expect(
      JSON.parse(
        (
          env.db.prepare("SELECT value FROM content_meta WHERE key = 'taxonomy'").get() as {
            value: string;
          }
        ).value,
      ).taxonomy_version,
    ).toBe('1.0.0');
    expect(
      (
        env.db.prepare("SELECT value FROM content_meta WHERE key = 'base_version'").get() as {
          value: string;
        }
      ).value,
    ).toBe('0.1.0');
  });

  it('pomija niezaznaczone zmiany istniejących tematów (zgoda użytkownika jest wymagana)', async () => {
    await apply(preview(simpleRelease(3)));
    const staged = preview(
      makeRelease([
        makePack(
          'pack-001',
          [1, 2, 3].map((n) => makeTopic({ n, revision: 2 })),
        ),
      ]),
    );
    const report = await apply(staged, []);
    expect(report.summary.notSelected).toBe(3);
    expect(topicRows().every((r) => r.revision === 1)).toBe(true);
  });

  it('zatwierdzona aktualizacja zastępuje treść i zachowuje poprzednią wersję w historii', async () => {
    await apply(preview(simpleRelease(2)));
    const staged = preview(
      makeRelease([
        makePack(
          'pack-001',
          [1, 2].map((n) => makeTopic({ n, revision: 2 })),
        ),
      ]),
    );
    const id = staged.preview.topics[0]!.id;
    const report = await apply(staged, [id]);
    expect(report.summary).toMatchObject({ updated: 1, notSelected: 1 });
    expect(topicRows().find((r) => r.id === id)!.revision).toBe(2);
    expect(scalar(`SELECT count(*) FROM topic_versions WHERE topic_id = '${id}'`)).toBe(2);
  });

  it('NIE zmienia danych użytkownika (stan tematów i temat dnia)', async () => {
    await apply(preview(simpleRelease(3)));
    const first = topicRows()[0]!.id;
    env.db
      .prepare(
        "INSERT INTO topic_user_state (topic_id, status, deepen, status_date, updated_at) VALUES (?, 'completed', 1, '2026-11-01', 'x')",
      )
      .run(first);
    env.db
      .prepare(
        "INSERT INTO daily_assignments (date, topic_id, category, explanation, assigned_at) VALUES ('2026-11-01', ?, 'finance', '{}', 'x')",
      )
      .run(first);
    const before = JSON.stringify([
      env.db.prepare('SELECT * FROM topic_user_state').all(),
      env.db.prepare('SELECT * FROM daily_assignments').all(),
    ]);
    const staged = preview(
      makeRelease([
        makePack(
          'pack-001',
          [1, 2, 3].map((n) => makeTopic({ n, revision: 3 })),
        ),
      ]),
    );
    await apply(
      staged,
      staged.preview.topics.map((t) => t.id),
    );
    const after = JSON.stringify([
      env.db.prepare('SELECT * FROM topic_user_state').all(),
      env.db.prepare('SELECT * FROM daily_assignments').all(),
    ]);
    expect(after).toBe(before);
  });

  it('odmawia zaimportowania tematu nieprawidłowego lub spoza podglądu', async () => {
    const topics = [makeTopic({ n: 1 }), makeTopic({ n: 2 })];
    delete (topics[1] as any).core.title; // eslint-disable-line @typescript-eslint/no-explicit-any
    const staged = preview(makeRelease([makePack('pack-001', topics)]));
    await expect(apply(staged, [staged.preview.topics[1]!.id])).rejects.toBeInstanceOf(
      ImportApplyError,
    );
    await expect(apply(staged, ['fin-4242'])).rejects.toMatchObject({ code: 'bad_selection' });
    expect(topicRows()).toHaveLength(0);
  });

  it('odmawia zapisu importu zablokowanego błędem krytycznym', async () => {
    const staged = preview(simpleRelease(2, { schemaVersion: '9.0.0' }));
    await expect(apply(staged, [])).rejects.toMatchObject({ code: 'blocked' });
  });

  it('błąd w trakcie zapisu wycofuje całą transakcję (łącznie ze źródłami i taksonomią)', async () => {
    const staged = preview(simpleRelease(3));
    // wymuszamy błąd ograniczenia CHECK w bazie na trzecim temacie
    (staged.release.topics[2]!.record as unknown as { status: string }).status = 'zepsuty';
    await expect(
      apply(
        staged,
        staged.preview.topics.map((t) => t.id),
      ),
    ).rejects.toThrow();
    expect(topicRows()).toHaveLength(0);
    expect(scalar('SELECT count(*) FROM sources')).toBe(0);
    expect(scalar('SELECT count(*) FROM imports')).toBe(0);
    expect(scalar("SELECT count(*) FROM content_meta WHERE key = 'taxonomy'")).toBe(0);
  });

  it('zapisuje raport importu i wywołuje kopię zapasową przed zapisem', async () => {
    const snapshot = vi.fn(async () => 'kopia.bazabak');
    const staged = preview(simpleRelease(2));
    const report = await applyImport({
      db: env.db,
      staged,
      selectedIds: staged.preview.topics.map((t) => t.id),
      now: new Date(),
      snapshot,
    });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(report.snapshot).toBe('kopia.bazabak');
    expect(listImports(env.db)).toHaveLength(1);
    expect(getImportReport(env.db, report.id)!.items).toHaveLength(2);
    expect(getImportReport(env.db, report.id)!.snapshot).toBe('kopia.bazabak');
  });
});

describe('paczki przykładowe', () => {
  const example = () =>
    makeRelease([makePack('pack-000', [makeTopic({ n: 1 })], { is_example: true })]);

  it('są domyślnie pomijane', () => {
    const { preview: p } = preview(example());
    expect(p.packs[0]!.skipped).toBe(true);
    expect(p.topics).toEqual([]);
    expect(p.blocked).toBe(true);
    expect(p.fatal.join(' ')).toMatch(/są przykładowe/);
  });

  it('po zaznaczeniu opcji są importowane i oznaczone jako przykładowe', async () => {
    const staged = preview(example(), { includeExamples: true });
    await apply(staged);
    expect(scalar('SELECT is_example FROM topics')).toBe(1);
  });

  it('prawdziwy temat zastępuje przykładowy o tym samym ID, a przykładowy nie nadpisuje prawdziwego', async () => {
    await apply(preview(example(), { includeExamples: true }));
    const real = preview(simpleRelease(1));
    const t = real.preview.topics[0]!;
    expect(t.action).toBe('update');
    expect(t.replacesExample).toBe(true);
    await apply(real, [t.id]);
    expect(scalar('SELECT is_example FROM topics')).toBe(0);
    const again = preview(example(), { includeExamples: true });
    expect(again.preview.topics[0]!.action).toBe('example_skipped');
    expect(again.preview.topics[0]!.selectable).toBe(false);
  });
});

describe('import pojedynczych plików', () => {
  it('pojedyncza paczka korzysta z taksonomii i źródeł zapisanych wcześniej', async () => {
    await apply(preview(simpleRelease(2)));
    const pack = makePack('pack-002', [makeTopic({ n: 9 })]);
    const { preview: p } = buildPreview(
      env.db,
      [{ path: 'pack-002.json', bytes: Buffer.from(JSON.stringify(pack)) }],
      { includeExamples: false, today: TODAY },
    );
    expect(p.mode).toBe('single');
    expect(p.fatal).toEqual([]);
    expect(p.counts.new).toBe(1);
    expect(p.notes.join(' ')).toMatch(/bez manifestu/);
  });

  it('bez wcześniejszej taksonomii pojedyncza paczka jest blokowana z jasnym komunikatem', () => {
    const pack = makePack('pack-002', [makeTopic({ n: 9 })]);
    const { preview: p } = buildPreview(
      env.db,
      [{ path: 'pack-002.json', bytes: Buffer.from(JSON.stringify(pack)) }],
      { includeExamples: false, today: TODAY },
    );
    expect(p.fatal.join(' ')).toMatch(/Brak taksonomii/);
  });

  it('sam katalog tytułów można zaimportować osobno', async () => {
    const entries = [
      {
        id: 'fin-0001',
        title: 'Zaplanowany temat',
        category: 'finance',
        subcategory: 'investing',
        difficulty: 'beginner',
        topic_type: 'timeless',
      },
    ];
    const staged = buildPreview(
      env.db,
      [
        {
          path: 'catalog.json',
          bytes: Buffer.from(JSON.stringify({ catalog_version: '0.1.0', entries })),
        },
      ],
      { includeExamples: false, today: TODAY },
    );
    expect(staged.preview.fatal).toEqual([]);
    expect(staged.preview.catalog).toEqual({ version: '0.1.0', total: 1, added: 1 });
    await apply(staged, []);
    expect(scalar('SELECT count(*) FROM catalog_entries')).toBe(1);
  });
});

describe('magazyn podglądów', () => {
  it('podgląd wygasa po 30 minutach i jest czyszczony', () => {
    let now = 1_000_000;
    const staging = new ImportStaging(() => now);
    const staged = preview(simpleRelease(1));
    staging.put(staged);
    expect(staging.get(staged.preview.token)).toBe(staged);
    now += 31 * 60_000;
    expect(staging.get(staged.preview.token)).toBeNull();
  });

  it('trzyma najwyżej kilka podglądów i czyści się przy blokadzie', () => {
    const staging = new ImportStaging();
    const tokens = Array.from({ length: 5 }, () => {
      const s = preview(simpleRelease(1));
      staging.put(s);
      return s.preview.token;
    });
    expect(staging.get(tokens[0]!)).toBeNull();
    expect(staging.get(tokens[4]!)).not.toBeNull();
    staging.clear();
    expect(staging.get(tokens[4]!)).toBeNull();
  });
});

describe('podgląd jest zgodny z typem ImportPreview', () => {
  it('zawiera wszystkie pola potrzebne interfejsowi', () => {
    const p: ImportPreview = preview(simpleRelease(1)).preview;
    for (const key of [
      'token',
      'mode',
      'fatal',
      'notes',
      'warnings',
      'packs',
      'topics',
      'counts',
      'sources',
      'catalog',
      'taxonomyChanged',
      'missingLocal',
      'blocked',
    ]) {
      expect(p).toHaveProperty(key);
    }
    expect(makeSources()).toBeDefined();
    expect(makeTaxonomy()).toBeDefined();
  });
});
