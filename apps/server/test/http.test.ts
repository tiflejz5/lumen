import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePaths, type AppPaths } from '../src/config.ts';
import { buildApp, SESSION_COOKIE } from '../src/http/app.ts';
import { AppSession } from '../src/session/app-session.ts';
import { FAST_KDF, makeTempDir } from './helpers.ts';

const HOST = '127.0.0.1:47831';
const ORIGIN = `http://${HOST}`;
const PASSWORD = 'zielony koń skacze przez płot';

type Ctx = {
  app: FastifyInstance;
  session: AppSession;
  paths: AppPaths;
  clock: { t: number };
  onShutdown: ReturnType<typeof vi.fn>;
  cleanup: () => Promise<void>;
};

let ctx: Ctx;

async function createCtx(): Promise<Ctx> {
  const tmp = await makeTempDir('lumen-http-');
  const paths = resolvePaths(join(tmp.dir, 'data'));
  const webRoot = join(tmp.dir, 'web');
  await mkdir(join(webRoot, 'assets'), { recursive: true });
  await writeFile(
    join(webRoot, 'index.html'),
    '<!doctype html><title>Lumen</title><div id="root"></div>',
  );
  await writeFile(join(webRoot, 'assets', 'app-abc123.js'), 'console.log(1)');
  await writeFile(join(tmp.dir, 'secret.txt'), 'POZA-WEBROOT');
  const clock = { t: 1_700_000_000_000 };
  const session = new AppSession({ paths, kdf: FAST_KDF, now: () => clock.t });
  const onShutdown = vi.fn();
  const app = await buildApp({
    session,
    paths,
    allowedHosts: [HOST, 'localhost:47831'],
    webRoot,
    shutdownToken: 'tajny-token-do-testu',
    onShutdown,
  });
  return {
    app,
    session,
    paths,
    clock,
    onShutdown,
    cleanup: async () => {
      session.lock();
      await app.close();
      await tmp.cleanup();
    },
  };
}

beforeEach(async () => {
  ctx = await createCtx();
});
afterEach(async () => {
  await ctx.cleanup();
});

type Opts = { cookie?: string; origin?: string | null; host?: string };

function req(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, opts: Opts = {}) {
  const headers: Record<string, string> = { host: opts.host ?? HOST };
  if (opts.cookie) headers.cookie = `${SESSION_COOKIE}=${opts.cookie}`;
  if (method !== 'GET' && opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  return ctx.app.inject({
    method,
    url,
    headers,
    ...(body !== undefined ? { payload: body as object } : {}),
  });
}

function cookieOf(res: { cookies: { name: string; value: string }[] }): string {
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE);
  if (!c) throw new Error('brak ciasteczka sesji');
  return c.value;
}

/** Przechodzi pełną konfigurację i zwraca ciasteczko oraz klucz odzyskiwania. */
async function setup(): Promise<{ cookie: string; recoveryKey: string }> {
  const start = await req('POST', '/api/setup/start', { password: PASSWORD });
  expect(start.statusCode).toBe(200);
  const { recoveryKey, challenge } = start.json() as { recoveryKey: string; challenge: number[] };
  const groups = recoveryKey.split('-');
  const finish = await req('POST', '/api/setup/finish', {
    answers: challenge.map((n) => groups[n - 1]),
  });
  expect(finish.statusCode).toBe(200);
  return { cookie: cookieOf(finish), recoveryKey };
}

describe('Host i Origin', () => {
  it('odrzuca nieznany nagłówek Host (DNS rebinding)', async () => {
    const res = await req('GET', '/api/health', undefined, { host: 'zly.example.com' });
    expect(res.statusCode).toBe(421);
  });

  it('akceptuje localhost z poprawnym portem, ale nie z innym', async () => {
    expect(
      (await req('GET', '/api/health', undefined, { host: 'localhost:47831' })).statusCode,
    ).toBe(200);
    expect(
      (await req('GET', '/api/health', undefined, { host: 'localhost:9999' })).statusCode,
    ).toBe(421);
  });

  it('żądania zmieniające stan wymagają własnego Origin (CSRF)', async () => {
    const noOrigin = await req('POST', '/api/unlock', { password: 'x' }, { origin: null });
    expect(noOrigin.statusCode).toBe(403);
    const foreign = await req(
      'POST',
      '/api/unlock',
      { password: 'x' },
      { origin: 'http://evil.example' },
    );
    expect(foreign.statusCode).toBe(403);
  });
});

describe('nagłówki bezpieczeństwa', () => {
  it('API ma CSP, nosniff, DENY i no-store', async () => {
    const res = await req('GET', '/api/status');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('CSP nie dopuszcza żadnych zasobów zewnętrznych', async () => {
    const csp = String((await req('GET', '/api/status')).headers['content-security-policy']);
    expect(csp).not.toMatch(/https?:\/\//);
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
});

describe('konfiguracja początkowa', () => {
  it('status na starcie: uninitialized', async () => {
    const res = await req('GET', '/api/status');
    expect(res.json()).toMatchObject({
      state: 'uninitialized',
      autoLockInSeconds: null,
      orphanDatabase: false,
    });
  });

  it('za krótkie hasło → 400 z czytelnym komunikatem', async () => {
    const res = await req('POST', '/api/setup/start', { password: 'krótkie' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/co najmniej 10 znaków/);
  });

  it('przed potwierdzeniem klucza nic nie trafia na dysk', async () => {
    const start = await req('POST', '/api/setup/start', { password: PASSWORD });
    expect(start.statusCode).toBe(200);
    expect(start.json().recoveryKey).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
    expect(start.json().challenge).toHaveLength(3);
    await expect(readdir(ctx.paths.dataDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('błędne przepisanie fragmentów klucza nie kończy konfiguracji', async () => {
    await req('POST', '/api/setup/start', { password: PASSWORD });
    const res = await req('POST', '/api/setup/finish', { answers: ['AAAA', 'BBBB', 'CCCC'] });
    expect(res.statusCode).toBe(422);
    expect((await req('GET', '/api/status')).json().state).toBe('uninitialized');
  });

  it('po 5 błędnych potwierdzeniach konfiguracja jest unieważniana', async () => {
    await req('POST', '/api/setup/start', { password: PASSWORD });
    for (let i = 0; i < 5; i++)
      await req('POST', '/api/setup/finish', { answers: ['AAAA', 'BBBB', 'CCCC'] });
    const res = await req('POST', '/api/setup/finish', { answers: ['AAAA', 'BBBB', 'CCCC'] });
    expect(res.statusCode).toBe(410);
  });

  it('konfiguracja wygasa po 15 minutach', async () => {
    const start = await req('POST', '/api/setup/start', { password: PASSWORD });
    const groups = (start.json().recoveryKey as string).split('-');
    ctx.clock.t += 16 * 60_000;
    const res = await req('POST', '/api/setup/finish', {
      answers: (start.json().challenge as number[]).map((n) => groups[n - 1]),
    });
    expect(res.statusCode).toBe(410);
  });

  it('poprawna konfiguracja tworzy vault i zaszyfrowaną bazę oraz loguje', async () => {
    const { cookie, recoveryKey } = await setup();
    expect((await req('GET', '/api/status', undefined, { cookie })).json()).toMatchObject({
      state: 'unlocked',
    });
    const vaultText = await readFile(ctx.paths.vaultFile, 'utf8');
    expect(vaultText).not.toContain(PASSWORD);
    expect(vaultText).not.toContain(recoveryKey);
    const db = await readFile(ctx.paths.dbFile);
    expect(db.subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3');
  });

  it('nie pozwala skonfigurować ponownie istniejącej aplikacji', async () => {
    await setup();
    const res = await req('POST', '/api/setup/start', { password: 'inne hasło do próby' });
    expect(res.statusCode).toBe(409);
  });

  it('ciasteczko sesji jest HttpOnly i SameSite=Strict', async () => {
    const start = await req('POST', '/api/setup/start', { password: PASSWORD });
    const groups = (start.json().recoveryKey as string).split('-');
    const finish = await req('POST', '/api/setup/finish', {
      answers: (start.json().challenge as number[]).map((n) => groups[n - 1]),
    });
    const raw = String(finish.headers['set-cookie']);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
  });

  it('wykrywa osieroconą bazę bez vault.json i odkłada ją na bok zamiast kasować', async () => {
    await setup();
    ctx.session.lock();
    const { rm } = await import('node:fs/promises');
    await rm(ctx.paths.vaultFile);
    expect((await req('GET', '/api/status')).json()).toMatchObject({
      state: 'uninitialized',
      orphanDatabase: true,
    });
    await setup();
    const names = await readdir(ctx.paths.dataDir);
    expect(names.some((n) => n.startsWith('lumen.db.orphan-'))).toBe(true);
  });
});

describe('blokada i dostęp', () => {
  it('chronione trasy zwracają 401 bez sesji', async () => {
    for (const [m, u] of [
      ['GET', '/api/settings'],
      ['GET', '/api/backups'],
      ['POST', '/api/session/touch'],
    ] as const) {
      const res = await req(m, u, m === 'POST' ? {} : undefined);
      expect(res.statusCode, u).toBe(401);
      expect(res.json().error).toBe('locked');
    }
  });

  it('sfałszowany token nie daje dostępu', async () => {
    await setup();
    const res = await req('GET', '/api/settings', undefined, { cookie: 'sfalszowany-token' });
    expect(res.statusCode).toBe(401);
  });

  it('ręczna blokada unieważnia sesję', async () => {
    const { cookie } = await setup();
    expect((await req('POST', '/api/lock', {}, { cookie })).statusCode).toBe(200);
    expect((await req('GET', '/api/settings', undefined, { cookie })).statusCode).toBe(401);
    expect((await req('GET', '/api/status')).json().state).toBe('locked');
  });

  it('odblokowuje poprawnym hasłem, odrzuca złe', async () => {
    const { cookie } = await setup();
    await req('POST', '/api/lock', {}, { cookie });
    const bad = await req('POST', '/api/unlock', { password: 'to jest złe hasło' });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toBe('wrong_password');
    const good = await req('POST', '/api/unlock', { password: PASSWORD });
    expect(good.statusCode).toBe(200);
    expect(
      (await req('GET', '/api/settings', undefined, { cookie: cookieOf(good) })).statusCode,
    ).toBe(200);
  });

  it('po kilku błędnych próbach wprowadza opóźnienie i zwalnia je po czasie', async () => {
    const { cookie } = await setup();
    await req('POST', '/api/lock', {}, { cookie });
    for (let i = 0; i < 3; i++)
      await req('POST', '/api/unlock', { password: 'złe hasło numer ' + i });
    const blocked = await req('POST', '/api/unlock', { password: PASSWORD });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().retryAfterSeconds).toBeGreaterThan(0);
    ctx.clock.t += 120_000;
    expect((await req('POST', '/api/unlock', { password: PASSWORD })).statusCode).toBe(200);
  });

  it('opóźnienie rośnie z kolejnymi błędami (do limitu)', async () => {
    const { cookie } = await setup();
    await req('POST', '/api/lock', {}, { cookie });
    const waits: number[] = [];
    for (let i = 0; i < 40 && waits.length < 8; i++) {
      const res = await req('POST', '/api/unlock', { password: 'złe hasło ' + i });
      if (res.statusCode === 429) {
        const wait = res.json().retryAfterSeconds as number;
        waits.push(wait);
        ctx.clock.t += (wait + 1) * 1000; // czekamy, po czym znów zgadujemy
      }
    }
    expect(waits.slice(0, 4)).toEqual([2, 4, 8, 16]);
    expect(waits.at(-1)).toBe(60); // limit górny
    expect(Math.max(...waits)).toBeLessThanOrEqual(60);
  });

  it('automatycznie blokuje po bezczynności', async () => {
    const { cookie } = await setup();
    expect((await req('PUT', '/api/settings', { autoLockMinutes: 1 }, { cookie })).statusCode).toBe(
      200,
    );
    ctx.clock.t += 61_000;
    expect(ctx.session.tick()).toBe(true);
    expect((await req('GET', '/api/settings', undefined, { cookie })).statusCode).toBe(401);
    expect((await req('GET', '/api/status')).json().state).toBe('locked');
  });

  it('aktywność użytkownika odświeża licznik, samo odpytywanie statusu nie', async () => {
    const { cookie } = await setup();
    await req('PUT', '/api/settings', { autoLockMinutes: 1 }, { cookie });
    ctx.clock.t += 40_000;
    await req('GET', '/api/status', undefined, { cookie }); // bierne
    ctx.clock.t += 30_000; // razem 70 s od ostatniej aktywności
    expect(ctx.session.tick()).toBe(true);

    const again = await req('POST', '/api/unlock', { password: PASSWORD });
    const c2 = cookieOf(again);
    ctx.clock.t += 40_000;
    await req('POST', '/api/session/touch', {}, { cookie: c2 }); // aktywne
    ctx.clock.t += 40_000;
    expect(ctx.session.tick()).toBe(false);
  });

  it('status pokazuje pozostały czas do blokady', async () => {
    const { cookie } = await setup();
    ctx.clock.t += 60_000;
    const s = (await req('GET', '/api/status', undefined, { cookie })).json();
    expect(s.autoLockInSeconds).toBe(15 * 60 - 60);
  });
});

describe('zmiana hasła i klucz odzyskiwania', () => {
  it('zmienia hasło: stare przestaje działać, nowe działa', async () => {
    const { cookie } = await setup();
    const wrong = await req(
      'POST',
      '/api/password/change',
      { currentPassword: 'nieprawidłowe obecne', newPassword: 'zupełnie nowe hasło 2026' },
      { cookie },
    );
    expect(wrong.statusCode).toBe(401);
    const ok = await req(
      'POST',
      '/api/password/change',
      { currentPassword: PASSWORD, newPassword: 'zupełnie nowe hasło 2026' },
      { cookie },
    );
    expect(ok.statusCode).toBe(200);
    await req('POST', '/api/lock', {}, { cookie });
    expect((await req('POST', '/api/unlock', { password: PASSWORD })).statusCode).toBe(401);
    ctx.clock.t += 120_000;
    expect(
      (await req('POST', '/api/unlock', { password: 'zupełnie nowe hasło 2026' })).statusCode,
    ).toBe(200);
  });

  it('odblokowuje kluczem odzyskiwania i ustawia nowe hasło', async () => {
    const { cookie, recoveryKey } = await setup();
    await req('POST', '/api/lock', {}, { cookie });
    const res = await req('POST', '/api/unlock/recovery', {
      recoveryKey: recoveryKey.toLowerCase(),
      newPassword: 'hasło po odzyskaniu 2026',
    });
    expect(res.statusCode).toBe(200);
    await req('POST', '/api/lock', {}, { cookie: cookieOf(res) });
    expect(
      (await req('POST', '/api/unlock', { password: 'hasło po odzyskaniu 2026' })).statusCode,
    ).toBe(200);
  });

  it('błędny klucz odzyskiwania jest odrzucony', async () => {
    const { cookie } = await setup();
    await req('POST', '/api/lock', {}, { cookie });
    const res = await req('POST', '/api/unlock/recovery', {
      recoveryKey: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH-JJJJ-KKKK-MMMM-NNNN-PPPP-QQQQ',
      newPassword: 'hasło po odzyskaniu 2026',
    });
    expect(res.statusCode).toBe(401);
  });

  it('rotacja klucza unieważnia stary i zwraca nowy', async () => {
    const { cookie, recoveryKey } = await setup();
    const rotated = await req('POST', '/api/recovery/rotate', { password: PASSWORD }, { cookie });
    expect(rotated.statusCode).toBe(200);
    const next = rotated.json().recoveryKey as string;
    expect(next).not.toBe(recoveryKey);
    await req('POST', '/api/lock', {}, { cookie });
    const oldKey = await req('POST', '/api/unlock/recovery', {
      recoveryKey,
      newPassword: 'hasło po odzyskaniu 2026',
    });
    expect(oldKey.statusCode).toBe(401);
    ctx.clock.t += 120_000;
    const newKey = await req('POST', '/api/unlock/recovery', {
      recoveryKey: next,
      newPassword: 'hasło po odzyskaniu 2026',
    });
    expect(newKey.statusCode).toBe(200);
  });
});

describe('ustawienia', () => {
  it('zapisują się i są walidowane', async () => {
    const { cookie } = await setup();
    expect((await req('GET', '/api/settings', undefined, { cookie })).json()).toEqual({
      autoLockMinutes: 15,
      dayStartHour: 3,
      demoMode: false,
    });
    expect(
      (await req('PUT', '/api/settings', { autoLockMinutes: 30 }, { cookie })).json()
        .autoLockMinutes,
    ).toBe(30);
    expect((await req('PUT', '/api/settings', { autoLockMinutes: 0 }, { cookie })).statusCode).toBe(
      400,
    );
    expect((await req('PUT', '/api/settings', { cokolwiek: 1 }, { cookie })).statusCode).toBe(400);
  });

  it('przeżywają blokadę i ponowne odblokowanie', async () => {
    const { cookie } = await setup();
    await req('PUT', '/api/settings', { autoLockMinutes: 45 }, { cookie });
    await req('POST', '/api/lock', {}, { cookie });
    const again = await req('POST', '/api/unlock', { password: PASSWORD });
    expect(
      (await req('GET', '/api/settings', undefined, { cookie: cookieOf(again) })).json()
        .autoLockMinutes,
    ).toBe(45);
  });
});

describe('kopie zapasowe przez API', () => {
  it('tworzy, wylistowuje i weryfikuje kopię', async () => {
    const { cookie } = await setup();
    const created = await req('POST', '/api/backups', {}, { cookie });
    expect(created.statusCode).toBe(200);
    const list = (await req('GET', '/api/backups', undefined, { cookie })).json().backups as {
      name: string;
    }[];
    expect(list).toHaveLength(1);
    const verified = await req('POST', '/api/backups/verify', { name: list[0]!.name }, { cookie });
    expect(verified.json()).toMatchObject({ ok: true });
    const byPassword = await req(
      'POST',
      '/api/backups/verify',
      { name: list[0]!.name, password: PASSWORD },
      { cookie },
    );
    expect(byPassword.json()).toMatchObject({ ok: true });
  });

  it('blokuje próby wyjścia poza katalog kopii', async () => {
    const { cookie } = await setup();
    for (const name of ['../vault.json', '..\\lumen.db', 'a/b.bazabak', '..%2fx.bazabak']) {
      const res = await req('POST', '/api/backups/verify', { name }, { cookie });
      expect(res.statusCode, name).toBe(400);
    }
    const missing = await req(
      'POST',
      '/api/backups/verify',
      { name: 'nie-ma-takiej.bazabak' },
      { cookie },
    );
    expect(missing.statusCode).toBe(400);
  });
});

describe('zatrzymywanie', () => {
  it('wewnętrzne zatrzymanie wymaga tokenu, ale nie Origin', async () => {
    const hdr = (token?: string) => ({
      host: HOST,
      ...(token ? { 'x-lumen-shutdown-token': token } : {}),
    });
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/api/internal/shutdown', headers: hdr() }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/internal/shutdown',
          headers: hdr('zly-token'),
        })
      ).statusCode,
    ).toBe(403);
    expect(ctx.onShutdown).not.toHaveBeenCalled();
    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/internal/shutdown',
      headers: hdr('tajny-token-do-testu'),
    });
    expect(ok.statusCode).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(ctx.onShutdown).toHaveBeenCalledTimes(1);
  });

  it('zakończenie z interfejsu blokuje bazę i wywołuje zatrzymanie', async () => {
    const { cookie } = await setup();
    expect((await req('POST', '/api/shutdown', {}, { cookie })).statusCode).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(ctx.onShutdown).toHaveBeenCalled();
    expect(ctx.session.isUnlocked).toBe(false);
  });
});

describe('serwowanie frontendu', () => {
  it('zwraca index.html, zasoby z długim cache i fallback SPA', async () => {
    const root = await req('GET', '/');
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('<div id="root">');
    expect(root.headers['cache-control']).toBe('no-cache');

    const asset = await req('GET', '/assets/app-abc123.js');
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');

    const spa = await req('GET', '/ustawienia');
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain('<div id="root">');
  });

  it('nieistniejące API zwraca JSON 404, a nie stronę', async () => {
    const res = await req('GET', '/api/nie-ma');
    expect(res.statusCode).toBe(401); // trasy API bez sesji są zawsze chronione
    const { cookie } = await setup();
    const authed = await req('GET', '/api/nie-ma', undefined, { cookie });
    expect(authed.statusCode).toBe(404);
    expect(authed.json().error).toBe('not_found');
  });

  it('nie wydaje plików spoza katalogu frontendu', async () => {
    for (const url of [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/..%2fsecret.txt',
      '/assets/..%2f..%2fsecret.txt',
    ]) {
      const res = await req('GET', url);
      expect(res.body, url).not.toContain('POZA-WEBROOT');
    }
  });
});
