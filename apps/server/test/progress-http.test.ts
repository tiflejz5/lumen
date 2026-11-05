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

async function completeDaily(): Promise<string> {
  const topicId = await dailyTopicId();
  const s = (await call('POST', '/api/sessions', { topicId })).json();
  await call('POST', `/api/sessions/${s.id}/finish`, {
    outcome: 'completed',
    interest: 4,
    confidence: 2,
  });
  return topicId;
}

describe('powtórki', () => {
  it('ukończenie tematu planuje powtórkę na następny dzień', async () => {
    const topicId = await completeDaily();
    const today = (await call('GET', '/api/reviews')).json();
    expect(today.due).toHaveLength(0);
    expect(today.upcoming.map((r: { topicId: string }) => r.topicId)).toEqual([topicId]);
    expect(today.upcoming[0].dueDate).toBe('2026-11-06');
    // przed terminem nie można oceniać
    expect((await call('POST', `/api/reviews/${topicId}`, { rating: 'good' })).statusCode).toBe(
      409,
    );
  });

  it('powtórka: pytanie bez odpowiedzi, odpowiedź osobno, ocena przesuwa termin', async () => {
    const topicId = await completeDaily();
    clock.t += 24 * 3_600_000;
    const overview = (await call('GET', '/api/reviews')).json();
    expect(overview.due).toHaveLength(1);

    const card = (await call('GET', `/api/reviews/${topicId}/card`)).json();
    expect(card.mainQuestion).toBeTruthy();
    expect(JSON.stringify(card)).not.toContain('takeaways');
    const answer = (await call('GET', `/api/reviews/${topicId}/answer`)).json();
    expect(answer.takeaways.length).toBeGreaterThan(0);

    const good = (await call('POST', `/api/reviews/${topicId}`, { rating: 'good' })).json();
    expect(good.stage).toBe(1);
    expect(good.dueDate).toBe('2026-11-09'); // dziś 06.11 + 3 dni
    expect((await call('GET', '/api/reviews')).json().due).toHaveLength(0);

    clock.t += 3 * 24 * 3_600_000;
    const again = (await call('POST', `/api/reviews/${topicId}`, { rating: 'again' })).json();
    expect(again.stage).toBe(0);
    expect((await call('POST', `/api/reviews/${topicId}`, { rating: 'zle' })).statusCode).toBe(400);
    expect((await call('GET', '/api/reviews/fin-9999/card')).statusCode).toBe(404);
  });
});

describe('statystyki i odznaki', () => {
  it('na starcie pusto, po sesji i powtórce – liczniki, seria i odznaki', async () => {
    const empty = (await call('GET', '/api/stats')).json();
    expect(empty.totals.completedTopics).toBe(0);
    expect(empty.streak.current).toBe(0);
    expect(empty.quizAccuracy).toBeNull();
    expect(empty.last30).toHaveLength(30);
    expect(
      (await call('GET', '/api/achievements'))
        .json()
        .badges.every((b: { unlockedAt: string | null }) => !b.unlockedAt),
    ).toBe(true);

    const topicId = await completeDaily();
    clock.t += 24 * 3_600_000;
    await call('POST', `/api/reviews/${topicId}`, { rating: 'easy' });

    const stats = (await call('GET', '/api/stats')).json();
    expect(stats.totals.completedTopics).toBe(1);
    expect(stats.totals.sessions).toBe(1);
    expect(stats.totals.reviews).toBe(1);
    expect(stats.streak.current).toBe(2); // sesja wczoraj + powtórka dziś
    expect(stats.last30.at(-1).reviews).toBe(1);
    expect(stats.categories.some((c: { completed: number }) => c.completed === 1)).toBe(true);
    expect(stats.weakest.length).toBeGreaterThan(0); // pewność 2/5

    const badges = (await call('GET', '/api/achievements')).json().badges;
    const first = badges.find((b: { id: string }) => b.id === 'first-session');
    expect(first.unlockedAt).toBeTruthy();
    expect(badges.find((b: { id: string }) => b.id === 'topics-10').unlockedAt).toBeNull();
  });

  it('wymaga odblokowania', async () => {
    for (const u of ['/api/stats', '/api/achievements', '/api/reviews'])
      expect((await call('GET', u, undefined, false)).statusCode).toBe(401);
  });
});
