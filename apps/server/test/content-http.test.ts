import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePaths } from '../src/config.ts';
import { buildApp, SESSION_COOKIE } from '../src/http/app.ts';
import { AppSession } from '../src/session/app-session.ts';
import {
  makePack,
  makeRelease,
  makeTopic,
  simpleRelease,
  type Release,
} from './fixtures/release.ts';
import { FAST_KDF, makeTempDir } from './helpers.ts';

const HOST = '127.0.0.1:47831';
const ORIGIN = `http://${HOST}`;
const PASSWORD = 'zielony koń skacze przez płot';

type Ctx = {
  app: FastifyInstance;
  session: AppSession;
  clock: { t: number };
  cleanup: () => Promise<void>;
};
let ctx: Ctx;
let cookie = '';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0).getTime();

beforeEach(async () => {
  const tmp = await makeTempDir('lumen-content-');
  const paths = resolvePaths(join(tmp.dir, 'data'));
  const clock = { t: at(2026, 11, 5) };
  const session = new AppSession({ paths, kdf: FAST_KDF, now: () => clock.t });
  const app = await buildApp({
    session,
    paths,
    allowedHosts: [HOST],
    now: () => new Date(clock.t),
  });
  ctx = {
    app,
    session,
    clock,
    cleanup: async () => {
      session.lock();
      await app.close();
      await tmp.cleanup();
    },
  };

  const start = await call('POST', '/api/setup/start', { password: PASSWORD }, false);
  const groups = (start.json().recoveryKey as string).split('-');
  const finish = await call(
    'POST',
    '/api/setup/finish',
    { answers: (start.json().challenge as number[]).map((n) => groups[n - 1]) },
    false,
  );
  cookie = finish.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
});
afterEach(async () => {
  await ctx.cleanup();
});

function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, authed = true) {
  const headers: Record<string, string> = { host: HOST };
  if (authed && cookie) headers.cookie = `${SESSION_COOKIE}=${cookie}`;
  if (method !== 'GET') headers.origin = ORIGIN;
  return ctx.app.inject({
    method,
    url,
    headers,
    ...(body !== undefined ? { payload: body as object } : {}),
  });
}

const payload = (release: Release, includeExamples = false) => ({
  files: Object.entries(release.files).map(([path, bytes]) => ({
    path,
    data: bytes.toString('base64'),
  })),
  includeExamples,
});

async function importRelease(
  release: Release,
  {
    includeExamples = false,
    select,
  }: {
    includeExamples?: boolean;
    select?: (t: { id: string; defaultSelected: boolean }) => boolean;
  } = {},
) {
  const preview = await call('POST', '/api/import/preview', payload(release, includeExamples));
  expect(preview.statusCode, preview.body).toBe(200);
  const p = preview.json();
  const ids = (p.topics as { id: string; defaultSelected: boolean }[])
    .filter(select ?? ((t) => t.defaultSelected))
    .map((t) => t.id);
  const apply = await call('POST', '/api/import/apply', { token: p.token, topicIds: ids });
  expect(apply.statusCode, apply.body).toBe(200);
  return { preview: p, report: apply.json() };
}

describe('dostęp', () => {
  it('wszystkie trasy treści wymagają odblokowanej sesji', async () => {
    for (const [m, u] of [
      ['GET', '/api/topics'],
      ['GET', '/api/content'],
      ['GET', '/api/daily'],
      ['GET', '/api/imports'],
      ['GET', '/api/taxonomy'],
    ] as const) {
      expect((await call(m, u, undefined, false)).statusCode, u).toBe(401);
    }
    expect(
      (await call('POST', '/api/import/preview', payload(simpleRelease(1)), false)).statusCode,
    ).toBe(401);
    expect((await call('POST', '/api/daily/extra', {}, false)).statusCode).toBe(401);
  });

  it('import wymaga własnego Origin (CSRF)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/import/preview',
      headers: { host: HOST, cookie: `${SESSION_COOKIE}=${cookie}`, origin: 'http://evil.example' },
      payload: payload(simpleRelease(1)),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('import przez API', () => {
  it('podgląd → zatwierdzenie → treści widoczne; kopia powstaje przed importem', async () => {
    const { preview, report } = await importRelease(simpleRelease(6));
    expect(preview.counts.new).toBe(6);
    expect(report.summary.inserted).toBe(6);
    expect(report.snapshot).toMatch(/^lumen-.*pre-operation\.bazabak$/);

    const backups = (await call('GET', '/api/backups')).json().backups as {
      name: string;
      kind: string;
      label?: string;
    }[];
    expect(backups.some((b) => b.kind === 'pre-operation' && b.label === 'przed importem')).toBe(
      true,
    );

    const content = (await call('GET', '/api/content')).json();
    expect(content).toMatchObject({ baseVersion: '0.1.0', schemaVersion: '1.0.0', sources: 3 });
    expect(content.topics.active).toBe(6);
    expect(
      Object.values(content.topics.byCategory as Record<string, number>).reduce((a, b) => a + b, 0),
    ).toBe(6);

    const imports = (await call('GET', '/api/imports')).json().imports as { id: string }[];
    expect(imports).toHaveLength(1);
    const detail = (await call('GET', `/api/imports/${imports[0]!.id}`)).json();
    expect(detail.items).toHaveLength(6);
    expect((await call('GET', '/api/imports/nie-uuid')).statusCode).toBe(400);
    expect(
      (await call('GET', '/api/imports/00000000-0000-4000-8000-000000000000')).statusCode,
    ).toBe(404);
  });

  it('błąd krytyczny (zła suma SHA) zwraca podgląd z blokadą, a zapis jest odrzucony', async () => {
    const bad = simpleRelease(2, {
      tamper: (f) => {
        f['data/sources.json'] = Buffer.from('{}');
      },
    });
    const preview = (await call('POST', '/api/import/preview', payload(bad))).json();
    expect(preview.blocked).toBe(true);
    const apply = await call('POST', '/api/import/apply', { token: preview.token, topicIds: [] });
    expect(apply.statusCode).toBe(400);
    expect(apply.json().error).toBe('blocked');
  });

  it('nieznany lub wygasły token → 410; anulowanie usuwa podgląd', async () => {
    expect(
      (await call('POST', '/api/import/apply', { token: 'nieistniejacy-token-123', topicIds: [] }))
        .statusCode,
    ).toBe(410);
    const preview = (await call('POST', '/api/import/preview', payload(simpleRelease(2)))).json();
    await call('POST', '/api/import/cancel', { token: preview.token });
    expect(
      (await call('POST', '/api/import/apply', { token: preview.token, topicIds: [] })).statusCode,
    ).toBe(410);
  });

  it('blokada bazy czyści niezatwierdzone podglądy', async () => {
    const preview = (await call('POST', '/api/import/preview', payload(simpleRelease(2)))).json();
    await call('POST', '/api/lock', {});
    const again = await call('POST', '/api/unlock', { password: PASSWORD }, false);
    cookie = again.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    expect(
      (await call('POST', '/api/import/apply', { token: preview.token, topicIds: [] })).statusCode,
    ).toBe(410);
  });

  it('walidacja żądania: puste pliki, nieprawidłowe ID, nadmiarowe pola', async () => {
    expect(
      (await call('POST', '/api/import/preview', { files: [], includeExamples: false })).statusCode,
    ).toBe(400);
    expect(
      (await call('POST', '/api/import/apply', { token: 'abcdefghijkl', topicIds: ['../../etc'] }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call('POST', '/api/import/preview', { ...payload(simpleRelease(1)), extra: 1 }))
        .statusCode,
    ).toBe(400);
  });

  it('próba wyjścia poza katalog w ścieżce pliku jest blokowana przez parser', async () => {
    const res = await call('POST', '/api/import/preview', {
      files: [{ path: '../manifest.json', data: Buffer.from('{}').toString('base64') }],
      includeExamples: false,
    });
    expect(res.json().blocked).toBe(true);
  });
});

describe('przeglądanie tematów', () => {
  beforeEach(async () => {
    await importRelease(simpleRelease(8));
  });

  it('lista z filtrami i wyszukiwaniem niewrażliwym na polskie znaki (w tym ł)', async () => {
    const all = (await call('GET', '/api/topics')).json();
    expect(all.total).toBe(8);
    const found = (
      await call('GET', `/api/topics?query=${encodeURIComponent('zegar wahadlowy')}`)
    ).json();
    expect(found.items).toHaveLength(1);
    expect(found.items[0].title).toMatch(/zegar wahadłowy/);
    expect(
      (await call('GET', `/api/topics?query=${encodeURIComponent('LODÓWKA')}`)).json().total,
    ).toBe(1);
    expect((await call('GET', '/api/topics?category=finance')).json().total).toBe(2);
    expect((await call('GET', '/api/topics?level=advanced')).json().total).toBe(0);
    expect((await call('GET', '/api/topics?limit=3&offset=2')).json().items).toHaveLength(3);
    expect((await call('GET', '/api/topics?level=bogus')).statusCode).toBe(400);
  });

  it('szczegóły zawierają warstwę podstawową, ale NIE zdradzają odpowiedzi (extended, quiz, zadanie wypowiedzi)', async () => {
    const id = (await call('GET', '/api/topics')).json().items[0].id as string;
    const raw = (await call('GET', `/api/topics/${id}`)).body;
    const detail = JSON.parse(raw);
    expect(detail.core.main_question).toBeTruthy();
    expect(detail.core.research_questions.length).toBeGreaterThan(2);
    expect(detail.sources).toHaveLength(2);
    expect(detail.sources[0]).toMatchObject({ id: 'src-test-a', url: 'https://example.org/a' });
    // Klucz „quiz” występuje tylko jako szacowany czas (estimated_minutes.quiz), nie jako treść pytań.
    expect(Object.keys(detail)).not.toEqual(expect.arrayContaining(['extended']));
    for (const key of ['extended', 'quiz', 'speaking_task'])
      expect(detail, key).not.toHaveProperty(key);
    for (const secret of [
      'brief',
      'takeaways',
      'misconceptions',
      'correct_option',
      'explanation',
      'knowledge_limits',
      'key_concepts',
    ]) {
      expect(raw, secret).not.toContain(`"${secret}"`);
    }
    expect(raw).not.toContain('scenariuszu testowym decydują'); // treść wyjaśnienia z quizu
  });

  it('nieprawidłowy lub nieistniejący ID', async () => {
    expect((await call('GET', '/api/topics/zly-id')).statusCode).toBe(400);
    expect((await call('GET', '/api/topics/fin-9999')).statusCode).toBe(404);
    expect((await call('GET', '/api/topics/..%2F..%2Fvault')).statusCode).toBe(400);
  });

  it('taksonomia jest dostępna dla interfejsu', async () => {
    const t = (await call('GET', '/api/taxonomy')).json().taxonomy;
    expect(t.categories).toHaveLength(6);
  });
});

describe('stany tematów', () => {
  beforeEach(async () => {
    await importRelease(simpleRelease(8));
  });

  it('ustawianie, filtrowanie i zdejmowanie stanu', async () => {
    const id = (await call('GET', '/api/topics')).json().items[3].id as string;
    expect((await call('PUT', `/api/topics/${id}/state`, { status: 'known' })).statusCode).toBe(
      200,
    );
    expect(
      (await call('GET', '/api/topics?userStatus=known'))
        .json()
        .items.map((i: { id: string }) => i.id),
    ).toEqual([id]);
    expect((await call('GET', '/api/topics?userStatus=new')).json().total).toBe(7);
    expect((await call('GET', `/api/topics/${id}`)).json().userState.status).toBe('known');
    await call('PUT', `/api/topics/${id}/state`, { status: null });
    expect((await call('GET', '/api/topics?userStatus=new')).json().total).toBe(8);
  });

  it('walidacja stanu i nieistniejący temat', async () => {
    expect((await call('PUT', '/api/topics/fin-0001/state', { status: 'bogus' })).statusCode).toBe(
      400,
    );
    expect((await call('PUT', '/api/topics/fin-9999/state', { status: 'known' })).statusCode).toBe(
      404,
    );
    expect(
      (await call('PUT', '/api/topics/fin-0001/state', { status: 'postponed', postponeDays: 0 }))
        .statusCode,
    ).toBe(400);
  });

  it('odłożenie ustawia termin powrotu', async () => {
    const id = (await call('GET', '/api/topics')).json().items[0].id as string;
    await call('PUT', `/api/topics/${id}/state`, { status: 'postponed', postponeDays: 10 });
    expect((await call('GET', `/api/topics/${id}`)).json().userState.postponedUntil).toBe(
      '2026-11-15',
    );
  });
});

describe('temat dnia', () => {
  it('pusta baza: brak tematu z powodem „no_topics”', async () => {
    const res = (await call('GET', '/api/daily')).json();
    expect(res).toMatchObject({ topic: null, reason: 'no_topics', date: '2026-11-05' });
  });

  it('temat dnia jest stały przez cały dzień i zapisany w bazie', async () => {
    await importRelease(simpleRelease(8));
    const first = (await call('GET', '/api/daily')).json();
    expect(first.topic).not.toBeNull();
    expect(first.explanation.factors.length).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++)
      expect((await call('GET', '/api/daily')).json().topic.id).toBe(first.topic.id);
    ctx.clock.t = at(2026, 11, 5, 23);
    expect((await call('GET', '/api/daily')).json().topic.id).toBe(first.topic.id);
    const rows = ctx.session
      .requireUnlocked()
      .db.prepare('SELECT count(*) AS c FROM daily_assignments')
      .get() as { c: number };
    expect(rows.c).toBe(1);
  });

  it('godziny przed początkiem dnia nauki należą jeszcze do poprzedniego dnia', async () => {
    await importRelease(simpleRelease(8));
    const evening = (await call('GET', '/api/daily')).json();
    ctx.clock.t = at(2026, 11, 6, 2); // 02:00 < 03:00
    const night = (await call('GET', '/api/daily')).json();
    expect(night.date).toBe('2026-11-05');
    expect(night.topic.id).toBe(evening.topic.id);
    ctx.clock.t = at(2026, 11, 6, 3);
    expect((await call('GET', '/api/daily')).json().date).toBe('2026-11-06');
  });

  it('kolejnego dnia temat jest nowy; temat główny nigdy się nie powtarza', async () => {
    await importRelease(simpleRelease(8));
    const seen = new Set<string>();
    for (let day = 5; day < 5 + 8; day++) {
      ctx.clock.t = at(2026, 11, day);
      const res = (await call('GET', '/api/daily')).json();
      expect(res.topic, `dzień ${day}`).not.toBeNull();
      expect(seen.has(res.topic.id)).toBe(false);
      seen.add(res.topic.id);
    }
    ctx.clock.t = at(2026, 11, 13);
    expect((await call('GET', '/api/daily')).json()).toMatchObject({
      topic: null,
      reason: 'exhausted',
    });
  });

  it('dodatkowe losowanie nie zastępuje tematu dnia ani nie zmienia postępu', async () => {
    await importRelease(simpleRelease(8));
    const daily = (await call('GET', '/api/daily')).json();
    const extras = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const extra = (await call('POST', '/api/daily/extra', {})).json();
      expect(extra.topic.id).not.toBe(daily.topic.id);
      extras.add(extra.topic.id);
    }
    expect(extras.size).toBeGreaterThan(1);
    expect((await call('GET', '/api/daily')).json().topic.id).toBe(daily.topic.id);
    const db = ctx.session.requireUnlocked().db;
    expect(
      (db.prepare('SELECT count(*) AS c FROM daily_assignments').get() as { c: number }).c,
    ).toBe(1);
    expect(
      (db.prepare('SELECT count(*) AS c FROM topic_user_state').get() as { c: number }).c,
    ).toBe(0);
  });

  it('oznaczenie tematu dnia jako „nieinteresujący” losuje inny temat na dziś', async () => {
    await importRelease(simpleRelease(8));
    const daily = (await call('GET', '/api/daily')).json();
    const res = await call('PUT', `/api/topics/${daily.topic.id}/state`, {
      status: 'not_interesting',
    });
    expect(res.json().reassigned).toBe(true);
    const next = (await call('GET', '/api/daily')).json();
    expect(next.topic.id).not.toBe(daily.topic.id);
    const rows = ctx.session
      .requireUnlocked()
      .db.prepare('SELECT count(*) AS c FROM daily_assignments')
      .get() as { c: number };
    expect(rows.c).toBe(1);
  });

  it('oznaczenie innego tematu nie zmienia tematu dnia', async () => {
    await importRelease(simpleRelease(8));
    const daily = (await call('GET', '/api/daily')).json();
    const other = ((await call('GET', '/api/topics')).json().items as { id: string }[]).find(
      (t) => t.id !== daily.topic.id,
    )!.id;
    const res = await call('PUT', `/api/topics/${other}/state`, { status: 'known' });
    expect(res.json().reassigned).toBe(false);
    expect((await call('GET', '/api/daily')).json().topic.id).toBe(daily.topic.id);
  });

  it('tematy przykładowe są losowane dopiero w trybie demonstracyjnym', async () => {
    const example = makeRelease([
      makePack('pack-000', [makeTopic({ n: 1 }), makeTopic({ n: 2 })], { is_example: true }),
    ]);
    await importRelease(example, { includeExamples: true });
    expect((await call('GET', '/api/content')).json().topics).toMatchObject({
      active: 0,
      examples: 2,
    });
    expect((await call('GET', '/api/topics')).json().total).toBe(0);
    expect((await call('GET', '/api/daily')).json().topic).toBeNull();

    expect((await call('PUT', '/api/settings', { demoMode: true })).statusCode).toBe(200);
    expect((await call('GET', '/api/topics')).json().total).toBe(2);
    const daily = (await call('GET', '/api/daily')).json();
    expect(daily.topic).not.toBeNull();
    expect(daily.topic.isExample).toBe(true);
  });

  it('po imporcie nowej paczki w tym samym dniu pusty dzień dostaje temat', async () => {
    expect((await call('GET', '/api/daily')).json().topic).toBeNull();
    await importRelease(simpleRelease(3));
    expect((await call('GET', '/api/daily')).json().topic).not.toBeNull();
  });
});
