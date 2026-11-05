import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
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
const DAY = 24 * 3_600_000;

let app: FastifyInstance;
let session: AppSession;
let cleanup: () => Promise<void>;
let cookie = '';
let dataDir = '';
const clock = { t: new Date(2026, 10, 5, 12, 0).getTime() };
const backupsDir = () => join(dataDir, 'data', 'backups');

beforeEach(async () => {
  clock.t = new Date(2026, 10, 5, 12, 0).getTime();
  const tmp = await makeTempDir('lumen-backup-');
  dataDir = tmp.dir;
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

describe('automatyczne kopie zapasowe', () => {
  it('tworzy kopię raz na dobę, nie usuwa ręcznych i zachowuje tyle automatycznych, ile w ustawieniach', async () => {
    await call('PUT', '/api/settings', { autoBackupKeep: 2 });
    expect((await call('POST', '/api/backups/auto', {})).json().reason).toBe('created');
    expect((await call('POST', '/api/backups/auto', {})).json().reason).toBe('not_due');

    await call('POST', '/api/backups', {}); // ręczna
    for (let i = 0; i < 3; i++) {
      clock.t += DAY + 1000;
      expect((await call('POST', '/api/backups/auto', {})).json().reason).toBe('created');
    }
    const list = (await call('GET', '/api/backups')).json().backups as { kind: string }[];
    expect(list.filter((b) => b.kind === 'auto')).toHaveLength(2);
    expect(list.filter((b) => b.kind === 'manual')).toHaveLength(1);
  });

  it('można wyłączyć', async () => {
    await call('PUT', '/api/settings', { autoBackup: false });
    expect((await call('POST', '/api/backups/auto', {})).json().reason).toBe('disabled');
  });

  it('kopiuje do dodatkowego folderu; brak folderu jest ostrzeżeniem, a nie błędem', async () => {
    expect((await call('GET', '/api/backups')).json().health.level).toBe('none');

    const mirror = join(dataDir, 'pendrive');
    await mkdir(mirror);
    await call('PUT', '/api/settings', { backupMirrorDir: mirror });
    const manual = (await call('POST', '/api/backups', {})).json();
    expect(manual.mirror.ok).toBe(true);
    expect(await readdir(mirror)).toContain(manual.name);
    const listing = (await call('GET', '/api/backups')).json();
    expect(listing.mirrorBackups).toHaveLength(1);
    expect(listing.health.level).toBe('ok');

    // pendrive odłączony
    await call('PUT', '/api/settings', { backupMirrorDir: join(dataDir, 'nie-ma-takiego') });
    const again = (await call('POST', '/api/backups', {})).json();
    expect(again.mirror.ok).toBe(false);
    expect((await call('GET', '/api/backups')).json().health.level).toBe('warn');
  });

  it('ostrzega o braku kopii poza komputerem i o starej kopii', async () => {
    await call('POST', '/api/backups', {});
    expect((await call('GET', '/api/backups')).json().health.level).toBe('warn');
    clock.t += 5 * DAY;
    const h = (await call('GET', '/api/backups')).json().health;
    expect(h.level).toBe('warn');
    expect(h.ageDays).toBe(5);
  });
});

describe('przywracanie z kopii', () => {
  it('przywrócenie cofa zmiany, blokuje aplikację i zostawia kopię stanu sprzed', async () => {
    const topicId = await dailyTopicId();
    await call('POST', '/api/notes', { topicId, body: 'Notatka przed kopią' });
    const backup = (await call('POST', '/api/backups', {})).json();
    await call('POST', '/api/notes', { topicId, body: 'Notatka po kopii' });
    expect((await call('GET', '/api/notes')).json().notes).toHaveLength(2);

    // błędne hasło nie zamyka aplikacji
    const wrong = await call('POST', '/api/backups/restore/preview', {
      name: backup.name,
      password: 'zle haslo',
    });
    expect(wrong.statusCode).toBe(400);
    expect((await call('GET', '/api/notes')).statusCode).toBe(200);
    // brak potwierdzenia
    expect(
      (await call('POST', '/api/backups/restore', { name: backup.name, password: PASSWORD }))
        .statusCode,
    ).toBe(400);

    const preview = (
      await call('POST', '/api/backups/restore/preview', { name: backup.name, password: PASSWORD })
    ).json();
    expect(preview.counts.notes).toBe(1);
    expect(preview.vaultWillBeReplaced).toBe(false);

    const done = await call('POST', '/api/backups/restore', {
      name: backup.name,
      password: PASSWORD,
      confirm: true,
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().preRestoreDir).toBeTruthy();
    // aplikacja jest zablokowana
    expect((await call('GET', '/api/notes')).statusCode).toBe(401);
    const unlock = await call('POST', '/api/unlock', { password: PASSWORD }, false);
    expect(unlock.statusCode).toBe(200);
    cookie = unlock.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    const notes = (await call('GET', '/api/notes')).json().notes as { body: string }[];
    expect(notes.map((n) => n.body)).toEqual(['Notatka przed kopią']);
    expect(existsSync(backupsDir())).toBe(true);
  });

  it('odmawia nazw spoza folderu kopii, nieistniejących plików i braku folderu dodatkowego', async () => {
    for (const body of [
      { name: '..%2Fx.bazabak', password: PASSWORD },
      { name: 'nie-ma.bazabak', password: PASSWORD },
      { name: 'a.bazabak', source: 'mirror', password: PASSWORD },
    ])
      expect((await call('POST', '/api/backups/restore/preview', body)).statusCode).toBe(400);
  });

  it('przywracanie początkowe działa tylko przed konfiguracją', async () => {
    expect((await call('GET', '/api/restore/initial/list', undefined, false)).statusCode).toBe(409);
    expect(
      (
        await call(
          'POST',
          '/api/restore/initial',
          { name: 'a.bazabak', password: PASSWORD, confirm: true },
          false,
        )
      ).statusCode,
    ).toBe(409);
  });
});

describe('eksport i import danych użytkownika', () => {
  async function studyAndNote() {
    const topicId = await dailyTopicId();
    const s = (await call('POST', '/api/sessions', { topicId })).json();
    await call('PATCH', `/api/sessions/${s.id}`, { stage: 'check' });
    await call('POST', `/api/sessions/${s.id}/answer`, { questionId: 'q1', answer: '0' });
    await call('POST', `/api/sessions/${s.id}/finish`, {
      outcome: 'completed',
      interest: 5,
      summary: 'Wnioski',
    });
    await call('POST', '/api/knowledge', { term: 'Pojęcie', definition: 'Opis [[Inne]]', topicId });
    return topicId;
  }

  it('eksport zawiera dane użytkownika i nagłówek pliku do pobrania', async () => {
    await studyAndNote();
    const res = await call('GET', '/api/user-data/export');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('lumen-dane-');
    const data = res.json();
    expect(data.format).toBe('lumen-user-data');
    expect(data.tables.study_sessions).toHaveLength(1);
    expect(data.tables.quiz_answers).toHaveLength(1);
    expect(data.tables.notes).toHaveLength(1);
    expect(data.tables.knowledge_entries).toHaveLength(1);
    expect(data.tables.review_items).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain('password');
  });

  it('import jest idempotentny, a lokalne usunięcie (nowsze) nie jest cofane', async () => {
    await studyAndNote();
    const exported = (await call('GET', '/api/user-data/export')).json();

    const same = (await call('POST', '/api/user-data/import', exported)).json();
    expect(same.tables.study_sessions).toMatchObject({ inserted: 0, unchanged: 1 });
    expect(same.tables.notes.inserted).toBe(0);

    const notes = (await call('GET', '/api/notes')).json().notes as { id: string }[];
    clock.t += 60_000;
    await call('DELETE', `/api/notes/${notes[0]!.id}`);
    const after = (await call('POST', '/api/user-data/import', exported)).json();
    expect(after.tables.notes.updated).toBe(0);
    expect((await call('GET', '/api/notes')).json().notes).toHaveLength(0);
  });

  it('nowszy zapis z pliku wygrywa, a rekordy nieznanych tematów są pomijane', async () => {
    const topicId = await studyAndNote();
    const exported = (await call('GET', '/api/user-data/export')).json();
    const note = exported.tables.notes[0];
    note.body = 'Zmieniona na innym urządzeniu';
    note.updated_at = '2999-01-01T00:00:00.000Z';
    exported.tables.notes.push({ ...note, id: 'x', topic_id: 'fin-9999' });
    exported.tables.topic_user_state.push({
      topic_id: 'fin-9998',
      status: 'known',
      postponed_until: null,
      deepen: 0,
      status_date: null,
      updated_at: '2999-01-01T00:00:00.000Z',
    });
    const r = (await call('POST', '/api/user-data/import', exported)).json();
    expect(r.tables.notes).toMatchObject({ updated: 1, skipped: 1 });
    expect(r.tables.topic_user_state.skipped).toBe(1);
    expect(r.notes).toHaveLength(1);
    const notes = (await call('GET', `/api/notes?topicId=${topicId}`)).json().notes;
    expect(notes[0].body).toBe('Zmieniona na innym urządzeniu');
    const list = (await call('GET', '/api/backups')).json().backups as { label?: string }[];
    expect(list.some((b) => b.label === 'przed importem danych')).toBe(true);
  });

  it('odrzuca obcy plik i wymaga odblokowania', async () => {
    expect((await call('POST', '/api/user-data/import', { foo: 1 })).statusCode).toBe(400);
    expect((await call('GET', '/api/user-data/export', undefined, false)).statusCode).toBe(401);
    expect((await call('POST', '/api/user-data/import', {}, false)).statusCode).toBe(401);
  });
});

describe('przywracanie na nowej instalacji', () => {
  it('kopia skopiowana do folderu kopii przywraca konto i dane (hasło z chwili kopii)', async () => {
    const topicId = await dailyTopicId();
    await call('POST', '/api/notes', { topicId, body: 'Przetrwam awarię dysku' });
    const backup = (await call('POST', '/api/backups', {})).json();

    // „nowy komputer”: świeży katalog danych i osobna aplikacja
    const fresh = await makeTempDir('lumen-fresh-');
    const freshPaths = resolvePaths(join(fresh.dir, 'data'));
    const freshSession = new AppSession({ paths: freshPaths, kdf: FAST_KDF, now: () => clock.t });
    const freshApp = await buildApp({
      session: freshSession,
      paths: freshPaths,
      allowedHosts: [HOST],
      now: () => new Date(clock.t),
    });
    try {
      await mkdir(freshPaths.backupsDir, { recursive: true });
      await copyFile(join(backupsDir(), backup.name), join(freshPaths.backupsDir, backup.name));
      const inject = (method: string, url: string, body?: unknown, c = '') =>
        freshApp.inject({
          method: method as 'GET',
          url,
          headers: {
            host: HOST,
            ...(method !== 'GET' ? { origin: ORIGIN } : {}),
            ...(c ? { cookie: `${SESSION_COOKIE}=${c}` } : {}),
          },
          ...(body !== undefined ? { payload: body as object } : {}),
        });

      const list = (await inject('GET', '/api/restore/initial/list')).json();
      expect(list.backups.map((b: { name: string }) => b.name)).toEqual([backup.name]);
      const wrong = await inject('POST', '/api/restore/initial', {
        name: backup.name,
        password: 'zle haslo',
        confirm: true,
      });
      expect(wrong.statusCode).toBe(400);
      const ok = await inject('POST', '/api/restore/initial', {
        name: backup.name,
        password: PASSWORD,
        confirm: true,
      });
      expect(ok.statusCode, ok.body).toBe(200);

      // po przywróceniu konto istnieje i otwiera się hasłem z kopii
      expect((await inject('GET', '/api/restore/initial/list')).statusCode).toBe(409);
      const unlock = await inject('POST', '/api/unlock', { password: PASSWORD });
      expect(unlock.statusCode).toBe(200);
      const token = unlock.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
      const notes = (await inject('GET', '/api/notes', undefined, token)).json().notes as {
        body: string;
      }[];
      expect(notes.map((n) => n.body)).toEqual(['Przetrwam awarię dysku']);
    } finally {
      freshSession.lock();
      await freshApp.close();
      await fresh.cleanup();
    }
  });
});
