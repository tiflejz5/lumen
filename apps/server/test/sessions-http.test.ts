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

describe('sesja nauki', () => {
  it('wymaga odblokowania', async () => {
    expect((await call('GET', '/api/sessions', undefined, false)).statusCode).toBe(401);
    expect((await call('GET', '/api/notes', undefined, false)).statusCode).toBe(401);
  });

  it('pełny przebieg: research, quiz, wypowiedź, zakończenie zalicza dzień', async () => {
    const topicId = await dailyTopicId();
    expect((await call('GET', '/api/day')).json().dailyDone).toBe(false);

    const started = (await call('POST', '/api/sessions', { topicId })).json();
    expect(started.stage).toBe('research');
    expect(started.isDaily).toBe(true);
    expect(started.quiz).toBeNull();
    expect(started.extended).toBeNull();
    // wznowienie zwraca tę samą sesję
    expect((await call('POST', '/api/sessions', { topicId })).json().id).toBe(started.id);
    expect((await call('GET', `/api/topics/${topicId}`)).json().userState.status).toBe(
      'in_progress',
    );

    // quiz zablokowany przed etapem „sprawdzenie”
    const early = await call('POST', `/api/sessions/${started.id}/answer`, {
      questionId: 'q1',
      answer: '0',
    });
    expect(early.statusCode).toBe(409);

    clock.t += 5 * 60_000;
    const check = (
      await call('PATCH', `/api/sessions/${started.id}`, { stage: 'check', activeSeconds: 290 })
    ).json();
    expect(check.stage).toBe('check');
    expect(check.activeSeconds).toBe(290);
    expect(check.quiz).toHaveLength(2);
    // odpowiedzi nie wyciekają przed udzieleniem odpowiedzi
    expect(JSON.stringify(check.quiz)).not.toContain('correct');
    expect(check.quiz[0].result).toBeUndefined();
    expect(check.extended).toBeNull();

    const wrong = (
      await call('POST', `/api/sessions/${started.id}/answer`, { questionId: 'q1', answer: '2' })
    ).json();
    expect(wrong.quiz[0].result.correct).toBe(false);
    expect(wrong.quiz[0].result.correctAnswer).toBe('Warunki otoczenia');
    const right = (
      await call('POST', `/api/sessions/${started.id}/answer`, { questionId: 'q2', answer: '1' })
    ).json();
    expect(right.quiz[1].result.correct).toBe(true);
    expect(
      (await call('POST', `/api/sessions/${started.id}/answer`, { questionId: 'q1', answer: '0' }))
        .statusCode,
    ).toBe(409);

    const speaking = (
      await call('PATCH', `/api/sessions/${started.id}`, { stage: 'speaking' })
    ).json();
    expect(speaking.speaking.durationSeconds).toBe(120);
    expect(speaking.extended.takeaways.length).toBeGreaterThan(0);
    // etapu nie da się cofnąć
    expect(
      (await call('PATCH', `/api/sessions/${started.id}`, { stage: 'check' })).statusCode,
    ).toBe(400);

    clock.t += 3 * 60_000;
    const done = (
      await call('POST', `/api/sessions/${started.id}/finish`, {
        outcome: 'completed',
        activeSeconds: 400,
        interest: 5,
        difficulty: 'too_easy',
        confidence: 4,
        summary: 'Moje podsumowanie.',
        deepen: true,
      })
    ).json();
    expect(done.status).toBe('finished');
    expect(done.ratings).toEqual({ interest: 5, difficulty: 'too_easy', confidence: 4 });
    expect(done.notes.map((n: { kind: string }) => n.kind)).toEqual(['summary']);

    const day = (await call('GET', '/api/day')).json();
    expect(day.dailyDone).toBe(true);
    expect(day.activeSession).toBeNull();
    const detail = (await call('GET', `/api/topics/${topicId}`)).json();
    expect(detail.userState.status).toBe('completed');
    expect(detail.userState.deepen).toBe(true);
    expect(
      (await call('POST', `/api/sessions/${started.id}/finish`, { outcome: 'partial' })).statusCode,
    ).toBe(409);
    expect((await call('GET', '/api/sessions?status=finished')).json().sessions).toHaveLength(1);
  });

  it('czas aktywny nie może przekroczyć czasu od startu', async () => {
    const topicId = await dailyTopicId();
    const s = (await call('POST', '/api/sessions', { topicId })).json();
    clock.t += 60_000;
    const u = (await call('PATCH', `/api/sessions/${s.id}`, { activeSeconds: 80_000 })).json();
    expect(u.activeSeconds).toBeLessThanOrEqual(65);
  });

  it('sesja częściowa zostawia temat w toku i nie zalicza dnia', async () => {
    const topicId = await dailyTopicId();
    const s = (await call('POST', '/api/sessions', { topicId })).json();
    expect((await call('GET', '/api/day')).json().activeSession.id).toBe(s.id);
    await call('POST', `/api/sessions/${s.id}/finish`, { outcome: 'partial' });
    const detail = (await call('GET', `/api/topics/${topicId}`)).json();
    expect(detail.userState.status).toBe('in_progress');
    expect((await call('GET', '/api/day')).json().dailyDone).toBe(false);
    // można rozpocząć nową sesję tego samego tematu
    const again = (await call('POST', '/api/sessions', { topicId })).json();
    expect(again.id).not.toBe(s.id);
  });

  it('oceny wpływają na losowanie dodatkowego tematu', async () => {
    const topicId = await dailyTopicId();
    const s = (await call('POST', '/api/sessions', { topicId })).json();
    await call('POST', `/api/sessions/${s.id}/finish`, {
      outcome: 'completed',
      interest: 1,
      difficulty: 'too_hard',
    });
    const extra = (await call('POST', '/api/daily/extra', {})).json();
    expect(extra.topic).not.toBeNull();
    // ocena „za trudny” przesuwa docelowy poziom, a ocena zainteresowania trafia do kategorii tematu
    const keys = (extra.explanation.factors as { key: string }[]).map((f) => f.key);
    expect(keys).toContain('difficulty');
    const category = (await call('GET', `/api/topics/${topicId}`)).json().core.category;
    if (extra.topic.category === category) expect(keys).toContain('interest');
  });

  it('walidacja wejścia', async () => {
    const topicId = await dailyTopicId();
    const s = (await call('POST', '/api/sessions', { topicId })).json();
    expect(
      (await call('POST', `/api/sessions/${s.id}/finish`, { outcome: 'completed', interest: 9 }))
        .statusCode,
    ).toBe(400);
    expect((await call('POST', '/api/sessions', { topicId: 'zly' })).statusCode).toBe(400);
    expect((await call('POST', '/api/sessions', { topicId: 'fin-9999' })).statusCode).toBe(404);
    expect(
      (await call('GET', '/api/sessions/00000000-0000-4000-8000-000000000000')).statusCode,
    ).toBe(404);
  });
});

describe('notatki', () => {
  it('tworzenie, edycja, usuwanie (miękkie) i filtr po temacie', async () => {
    const topicId = await dailyTopicId();
    const n = (await call('POST', '/api/notes', { topicId, body: '  Pierwsza notatka  ' })).json();
    expect(n.body).toBe('Pierwsza notatka');
    expect((await call('PUT', `/api/notes/${n.id}`, { body: 'Zmieniona' })).statusCode).toBe(200);
    const list = (await call('GET', `/api/notes?topicId=${topicId}`)).json().notes;
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe('Zmieniona');
    expect((await call('POST', '/api/notes', { topicId, body: '   ' })).statusCode).toBe(400);
    expect((await call('DELETE', `/api/notes/${n.id}`)).statusCode).toBe(200);
    expect((await call('GET', '/api/notes')).json().notes).toHaveLength(0);
    expect((await call('DELETE', `/api/notes/${n.id}`)).statusCode).toBe(404);
  });
});
