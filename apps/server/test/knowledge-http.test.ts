import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePaths } from '../src/config.ts';
import { buildApp, SESSION_COOKIE } from '../src/http/app.ts';
import { AppSession } from '../src/session/app-session.ts';
import { simpleRelease } from './fixtures/release.ts';
import { FAST_KDF, makeTempDir } from './helpers.ts';

const HOST = '127.0.0.1:47831';
const ORIGIN = `http://${HOST}`;
const PASSWORD = 'zielony koń skacze przez płot';

let app: FastifyInstance;
let session: AppSession;
let cleanup: () => Promise<void>;
let cookie = '';
const clock = { t: new Date(2026, 10, 5, 12, 0).getTime() };

beforeEach(async () => {
  clock.t = new Date(2026, 10, 5, 12, 0).getTime();
  const tmp = await makeTempDir('lumen-sessions-');
  const paths = resolvePaths(join(tmp.dir, 'data'));
  session = new AppSession({ paths, kdf: FAST_KDF, now: () => clock.t });
  app = await buildApp({ session, paths, allowedHosts: [HOST], now: () => new Date(clock.t) });
  cleanup = async () => {
    session.lock();
    await app.close();
    await tmp.cleanup();
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

  const release = simpleRelease(6);
  const files = Object.entries(release.files).map(([path, bytes]) => ({
    path,
    data: bytes.toString('base64'),
  }));
  const preview = (
    await call('POST', '/api/import/preview', { files, includeExamples: false })
  ).json();
  await call('POST', '/api/import/apply', {
    token: preview.token,
    topicIds: (preview.topics as { id: string; defaultSelected: boolean }[])
      .filter((t) => t.defaultSelected)
      .map((t) => t.id),
  });
});
afterEach(async () => {
  await cleanup();
});

function call(method: string, url: string, body?: unknown, authed = true) {
  const headers: Record<string, string> = { host: HOST };
  if (authed && cookie) headers.cookie = `${SESSION_COOKIE}=${cookie}`;
  if (method !== 'GET') headers.origin = ORIGIN;
  return app.inject({
    method: method as 'GET',
    url,
    headers,
    ...(body !== undefined ? { payload: body as object } : {}),
  });
}

async function dailyTopicId(): Promise<string> {
  return (await call('GET', '/api/daily')).json().topic.id as string;
}

describe('baza wiedzy', () => {
  it('wymaga odblokowania', async () => {
    expect((await call('GET', '/api/knowledge', undefined, false)).statusCode).toBe(401);
    expect((await call('GET', '/api/search?q=a', undefined, false)).statusCode).toBe(401);
  });

  it('pojęcia: tworzenie, powiązania [[…]], odnośniki zwrotne, edycja i usuwanie', async () => {
    const topicId = await dailyTopicId();
    const a = (
      await call('POST', '/api/knowledge', {
        term: '  Procent   składany ',
        definition: 'Odsetki od odsetek. Zob. [[Inflacja]] i [[procent skladany]].',
        topicId,
      })
    ).json();
    expect(a.term).toBe('Procent składany');
    expect(a.topicId).toBe(topicId);
    expect(a.topicTitle).toBeTruthy();
    // [[Inflacja]] jeszcze nie istnieje; [[procent skladany]] wskazuje na samo pojęcie
    expect(a.resolved).toEqual({ Inflacja: null, 'procent skladany': a.id });

    const b = (
      await call('POST', '/api/knowledge', {
        term: 'Inflacja',
        definition: 'Wzrost cen. Wpływa na [[Procent składany]].',
      })
    ).json();
    const aAfter = (await call('GET', `/api/knowledge/${a.id}`)).json();
    expect(aAfter.resolved.Inflacja).toBe(b.id);
    expect(aAfter.backlinks).toEqual([{ id: b.id, term: 'Inflacja' }]);
    expect((await call('GET', `/api/knowledge/${b.id}`)).json().backlinks).toEqual([
      { id: a.id, term: 'Procent składany' },
    ]);

    // duplikat (bez względu na wielkość liter i ogonki)
    const dup = await call('POST', '/api/knowledge', { term: 'INFLACJA', definition: 'x' });
    expect(dup.statusCode).toBe(409);

    const upd = (
      await call('PUT', `/api/knowledge/${b.id}`, { term: 'Inflacja cenowa', definition: 'Nowa.' })
    ).json();
    expect(upd.term).toBe('Inflacja cenowa');
    expect(
      (await call('PUT', `/api/knowledge/${b.id}`, { term: 'procent skladany', definition: 'x' }))
        .statusCode,
    ).toBe(409);

    expect((await call('DELETE', `/api/knowledge/${b.id}`)).statusCode).toBe(200);
    expect((await call('GET', `/api/knowledge/${b.id}`)).statusCode).toBe(404);
    // po usunięciu termin można dodać ponownie
    expect(
      (
        await call('POST', '/api/knowledge', {
          term: 'Inflacja cenowa',
          definition: 'Jeszcze raz.',
        })
      ).statusCode,
    ).toBe(200);
  });

  it('walidacja wejścia', async () => {
    expect((await call('POST', '/api/knowledge', { term: '', definition: 'x' })).statusCode).toBe(
      400,
    );
    expect(
      (await call('POST', '/api/knowledge', { term: '!!!', definition: 'x' })).statusCode,
    ).toBe(400);
    expect(
      (await call('POST', '/api/knowledge', { term: 'a', definition: 'x', topicId: 'fin-9999' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call('POST', '/api/knowledge', { term: 'a', definition: 'x', zly: 1 })).statusCode,
    ).toBe(400);
  });

  it('wyszukiwanie obejmuje pojęcia i notatki, ignoruje ogonki i wielkość liter', async () => {
    const topicId = await dailyTopicId();
    await call('POST', '/api/knowledge', {
      term: 'Łańcuch wartości',
      definition: 'Ciąg działań firmy.',
    });
    await call('POST', '/api/notes', { topicId, body: 'Notatka o łańcuchu dostaw i kosztach.' });
    const r = (await call('GET', `/api/search?q=${encodeURIComponent('LANCUCH')}`)).json();
    expect(r.entries.map((e: { term: string }) => e.term)).toEqual(['Łańcuch wartości']);
    expect(r.notes).toHaveLength(1);
    const none = (await call('GET', '/api/search?q=zzzz')).json();
    expect(none.entries).toHaveLength(0);
    expect(none.notes).toHaveLength(0);
    expect((await call('GET', '/api/search?q=')).json().entries).toHaveLength(0);
    expect((await call('GET', '/api/knowledge?q=ciag')).json().entries).toHaveLength(1);
  });
});
