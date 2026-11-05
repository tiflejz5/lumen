import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCross, checkTopic, type Issue, type TopicRecord } from '@lumen/core';
import { afterAll, describe, expect, it } from 'vitest';
import { toTaxonomy } from '../src/modules/topics/repo.ts';
import { makePack, makeSources, makeTaxonomy, makeTopic, type Json } from './fixtures/release.ts';

/**
 * Test zgodności: ten sam zestaw danych sprawdzam portem reguł (TypeScript) i oryginalnym
 * `tools/validate.py` autora bazy. Komunikaty i miejsca ich wystąpienia muszą się zgadzać.
 * Test jest pomijany, gdy brakuje Pythona z `jsonschema` albo walidatora (prywatny pakiet treści).
 */

const VALIDATE_PY = fileURLToPath(
  new URL('../../../wiedza-baza-0.1.0/wiedza-baza/tools/validate.py', import.meta.url),
);
const SCHEMA_DIR = fileURLToPath(new URL('../../../packages/core/schema/', import.meta.url));
const TODAY = '2026-11-05';

const python = spawnSync('python', ['-c', 'import jsonschema, referencing'], { encoding: 'utf8' });
const available = python.status === 0 && existsSync(VALIDATE_PY);

type T = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const tmpRoots: string[] = [];
afterAll(() => tmpRoots.forEach((d) => rmSync(d, { recursive: true, force: true })));

function runPython(topics: Json[]): string[] {
  const root = mkdtempSync(join(tmpdir(), 'lumen-parity-'));
  tmpRoots.push(root);
  mkdirSync(join(root, 'tools'));
  mkdirSync(join(root, 'data', 'packs'), { recursive: true });
  cpSync(VALIDATE_PY, join(root, 'tools', 'validate.py'));
  cpSync(SCHEMA_DIR, join(root, 'schema'), { recursive: true });
  writeFileSync(join(root, 'data', 'taxonomy.json'), JSON.stringify(makeTaxonomy()));
  writeFileSync(join(root, 'data', 'sources.json'), JSON.stringify(makeSources()));
  writeFileSync(
    join(root, 'data', 'packs', 'pack-001.json'),
    JSON.stringify(makePack('pack-001', topics)),
  );
  const res = spawnSync(
    'python',
    ['-X', 'utf8', join(root, 'tools', 'validate.py'), '--today', TODAY],
    { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
  );
  return res.stdout
    .split(/\r?\n/)
    .filter((l) => /^\[(BŁĄD|UWAGA|INFO)\] /.test(l))
    .filter((l) => !l.includes(': schemat: '))
    .filter((l) => !l.includes('paczka przykładowa pominięta'));
}

const LEVEL = { error: 'BŁĄD', warning: 'UWAGA', info: 'INFO' } as const;
const fmt = (i: Issue) => `[${LEVEL[i.level]}] ${i.where}: ${i.message}`;

function runTs(topics: Json[]): string[] {
  const taxonomy = toTaxonomy(makeTaxonomy())!;
  const sourceIds = new Set((makeSources().sources as { id: string }[]).map((s) => s.id));
  const map = new Map<string, TopicRecord>();
  const issues: Issue[] = [];
  for (const t of topics as unknown as TopicRecord[]) {
    map.set(t.id, t);
    issues.push(...checkTopic(t, `pack-001.json:${t.id}`, taxonomy, sourceIds, TODAY));
  }
  issues.push(...checkCross(map, new Set()));
  return issues.map(fmt);
}

function compare(topics: Json[]) {
  const py = runPython(topics).sort();
  const ts = runTs(topics).sort();
  expect(ts).toEqual(py);
  return ts;
}

const base = (count = 6): T[] => Array.from({ length: count }, (_, i) => makeTopic({ n: i + 1 }));

describe.skipIf(!available)('zgodność reguł poziomu 2 z validate.py autora bazy', () => {
  it('poprawne wydanie: te same ostrzeżenia o podobieństwie (tytuły, pytania, tagi)', () => {
    const out = compare(base());
    expect(out.some((l) => l.includes('bardzo podobne tytuły'))).toBe(true);
  });

  it('trudność, czas sesji, zapytania, źródła i twierdzenia', () => {
    const topics = base();
    topics[0].core.difficulty.level = 'advanced';
    topics[1].core.estimated_minutes = { research: 15, quiz: 5, summary: 6 };
    topics[2].core.search_queries = [
      { query: 'one query', lang: 'en', purpose: 'Test.' },
      { query: 'second query', lang: 'en', purpose: 'Test.' },
    ];
    topics[3].core.suggested_sources = [
      { source_id: 'src-test-zzz', why: 'Brak w rejestrze.', what_to_find: 'Nic.' },
      { source_id: 'src-test-zzz', why: 'Powtórzone.', what_to_find: 'Nic.' },
    ];
    topics[4].extended.claims = [
      { text: 'Twierdzenie bez źródła i bez notatki.', claim_type: 'fact', source_ids: [] },
      {
        text: 'Przewidywanie bez daty odniesienia.',
        claim_type: 'prediction',
        source_ids: ['src-test-a'],
      },
      {
        text: 'Źródło spoza rejestru.',
        claim_type: 'interpretation',
        source_ids: ['src-test-nie-ma'],
      },
    ];
    const out = compare(topics);
    expect(out.filter((l) => l.startsWith('[BŁĄD]')).length).toBeGreaterThanOrEqual(6);
  });

  it('aktualność, daty i terminy przeglądu', () => {
    const topics = base();
    topics[0] = makeTopic({ n: 1, topicType: 'current' });
    (topics[0] as T).freshness.requires_periodic_update = false;
    (topics[0] as T).freshness.review_interval_months = null;
    topics[1].freshness.requires_periodic_update = true;
    topics[1].freshness.review_interval_months = null;
    topics[2].freshness.review_interval_months = 6; // przy requires=false
    topics[3].freshness.last_verified_at = '2027-01-01';
    topics[4].freshness.created_at = '2026-03-01';
    topics[4].freshness.last_verified_at = '2026-01-10';
    topics[5] = makeTopic({ n: 6, topicType: 'current', lastVerifiedAt: '2025-01-10' });
    (topics[5] as T).freshness.review_interval_months = 3;
    const out = compare(topics);
    expect(out.some((l) => l.includes('termin przeglądu minął'))).toBe(true);
  });

  it('quiz, rewizje i status', () => {
    const topics = base();
    topics[0].quiz[0].correct_option = 3;
    topics[0].quiz[0].options = ['A', 'A', 'B', 'C'];
    topics[1].quiz[1].id = 'q1';
    topics[2].revision = 2; // changelog kończy się na 1
    topics[3].status = 'deprecated';
    topics[4].superseded_by = topics[4].id;
    compare(topics);
  });

  it('taksonomia: podkategoria i prefiks ID', () => {
    const topics = base();
    topics[0].core.subcategory = 'physics'; // należy do science_tech, nie do finance
    topics[1].id = 'nau-0099'; // kategoria health_sport/finance, prefiks cudzy
    compare(topics);
  });

  it('relacje, cykle, duplikaty pytań i pokrycie tagów', () => {
    const topics = base(8);
    topics[0].relations.related = ['fin-9999'];
    topics[1].relations.related = [topics[1].id];
    topics[2].relations.prerequisites = [topics[3].id];
    topics[2].relations.next = [topics[3].id];
    topics[4].relations.prerequisites = [topics[5].id];
    topics[5].relations.prerequisites = [topics[4].id];
    topics[6].core.main_question = topics[7].core.main_question;
    topics[6].meta.concept_tags = [...topics[7].meta.concept_tags];
    topics[0].core.research_questions[0] = topics[0].core.main_question;
    const out = compare(topics);
    expect(out.some((l) => l.includes('cykl w prerequisites'))).toBe(true);
    expect(out.some((l) => l.includes('identyczne pytanie główne'))).toBe(true);
  });
});

describe('przypadki bez Pythona (zawsze uruchamiane)', () => {
  it('poprawne wydanie nie ma błędów, tylko ostrzeżenia o podobieństwie', () => {
    const lines = runTs(base());
    expect(lines.filter((l) => l.startsWith('[BŁĄD]'))).toEqual([]);
  });
});
