import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { z, ZodError } from 'zod';
import {
  MIN_PASSWORD_LENGTH,
  changePasswordBody,
  recoveryUnlockBody,
  rotateRecoveryBody,
  settingsPatchSchema,
  setupFinishBody,
  setupStartBody,
  unlockBody,
  type ApiError,
  type AppState,
  type StatusResponse,
} from '@lumen/core';
import { APP_VERSION, type AppPaths } from '../config.ts';
import { NewerDatabaseError } from '../db/migrate.ts';
import { DbError } from '../db/connection.ts';
import {
  BackupError,
  createBackup,
  listBackups,
  verifyBackup,
  verifyBackupWithDek,
} from '../modules/backup/backup.ts';
import { ImportStaging } from '../modules/importer/staging.ts';
import { AppSession, SessionError } from '../session/app-session.ts';
import { registerContentRoutes } from './content-routes.ts';
import { VaultError } from '../vault/vault.ts';

export const SESSION_COOKIE = 'lumen_session';

export type BuildAppOptions = {
  session: AppSession;
  paths: AppPaths;
  /** Dozwolone wartości nagłówka Host, np. ["127.0.0.1:47831", "localhost:47831"]. */
  allowedHosts: string[];
  /** Katalog ze zbudowanym frontendem (opcjonalny – w trybie dev serwuje go Vite). */
  webRoot?: string;
  logger?: boolean | object;
  shutdownToken?: string;
  onShutdown?: () => void;
  onActivity?: () => void;
  /** Zegar (do testów). */
  now?: () => Date;
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const PUBLIC_ROUTES = new Set([
  'GET /api/health',
  'GET /api/status',
  'POST /api/setup/start',
  'POST /api/setup/finish',
  'POST /api/unlock',
  'POST /api/unlock/recovery',
  'POST /api/internal/shutdown',
]);
/** Zapytania, które nie liczą się jako aktywność użytkownika (nie odnawiają auto-blokady). */
const PASSIVE_ROUTES = new Set(['GET /api/status', 'GET /api/health']);

const backupNameSchema = z.string().regex(/^[A-Za-z0-9._-]{1,120}\.bazabak$/);
const verifyBackupBody = z
  .object({
    name: backupNameSchema,
    password: z.string().min(1).max(256).optional(),
    recoveryKey: z.string().min(1).max(120).optional(),
  })
  .strict();

function secureEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function send(
  reply: FastifyReply,
  status: number,
  error: string,
  message: string,
  extra: Partial<ApiError> = {},
) {
  const body: ApiError = { error, message, ...extra };
  return reply.code(status).send(body);
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { session, paths } = options;
  const app = Fastify({
    logger: options.logger ?? false,
    // W logach nie zapisujemy adresów ani treści żądań.
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 1024 * 1024,
    trustProxy: false,
  });
  const hosts = new Set(options.allowedHosts.map((h) => h.toLowerCase()));
  const origins = new Set([...hosts].map((h) => `http://${h}`));

  await app.register(cookie);

  // ── zabezpieczenia wszystkich odpowiedzi ──────────────────────────────────────────────────
  app.addHook('onRequest', async (req, reply) => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (!hosts.has(host)) return send(reply, 421, 'bad_host', 'Niedozwolony adres hosta.');

    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (req.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');
    }

    const key = `${req.method} ${req.url.split('?')[0]}`;
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    // Zapytania zmieniające stan muszą pochodzić z naszej własnej strony (ochrona przed CSRF).
    // Jedyny wyjątek: wewnętrzne zatrzymanie przez launcher, zabezpieczone tokenem.
    if (unsafe && key !== 'POST /api/internal/shutdown') {
      const origin = req.headers.origin;
      if (!origin || !origins.has(origin.toLowerCase())) {
        return send(reply, 403, 'bad_origin', 'Niedozwolone pochodzenie żądania.');
      }
    }
    options.onActivity?.();
  });

  // ── uwierzytelnienie ─────────────────────────────────────────────────────────────────────
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const key = `${req.method} ${req.url.split('?')[0]}`;
    if (PUBLIC_ROUTES.has(key)) return;
    if (!session.isValidToken(req.cookies[SESSION_COOKIE])) {
      return send(reply, 401, 'locked', 'Baza jest zablokowana. Odblokuj ją hasłem.');
    }
    if (!PASSIVE_ROUTES.has(key)) session.touch();
  });

  // ── obsługa błędów ───────────────────────────────────────────────────────────────────────
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      const field = String(issue?.path[0] ?? '');
      const message =
        /password/i.test(field) && issue?.code === 'too_small'
          ? `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`
          : 'Nieprawidłowe dane w żądaniu.';
      return send(reply, 400, 'validation', message);
    }
    if (error instanceof SessionError) {
      const status = {
        locked: 401,
        bad_state: 409,
        rate_limited: 429,
        setup_expired: 410,
        setup_mismatch: 422,
      }[error.code];
      return send(
        reply,
        status,
        error.code,
        error.message,
        error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {},
      );
    }
    if (error instanceof VaultError) {
      const status = error.code === 'corrupt_vault' ? 500 : 401;
      return send(reply, status, error.code, error.message);
    }
    if (error instanceof BackupError)
      return send(reply, error.code === 'io' ? 409 : 400, error.code, error.message);
    if (error instanceof NewerDatabaseError)
      return send(reply, 409, 'newer_database', error.message);
    if (error instanceof DbError) return send(reply, 500, error.code, error.message);
    if (
      (error as { statusCode?: number }).statusCode === 400 ||
      (error as { statusCode?: number }).statusCode === 415
    ) {
      return send(reply, 400, 'bad_request', 'Nieprawidłowe żądanie.');
    }
    req.log.error(
      { err: { name: (error as Error).name, message: (error as Error).message } },
      'nieobsłużony błąd',
    );
    return send(
      reply,
      500,
      'internal',
      'Wystąpił nieoczekiwany błąd. Szczegóły są w dzienniku aplikacji.',
    );
  });

  // ── trasy publiczne ──────────────────────────────────────────────────────────────────────
  app.get('/api/health', async () => ({ ok: true, app: 'lumen', version: APP_VERSION }));

  app.get('/api/status', async (req): Promise<StatusResponse> => {
    const authed = session.isValidToken(req.cookies[SESSION_COOKIE]);
    const exists = await session.vaultExists();
    const state: AppState = !exists ? 'uninitialized' : authed ? 'unlocked' : 'locked';
    return {
      state,
      version: APP_VERSION,
      autoLockInSeconds: authed ? session.autoLockInSeconds() : null,
      orphanDatabase: !exists && (await session.hasOrphanDatabase()),
    };
  });

  const setCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', path: '/' });

  app.post('/api/setup/start', async (req) =>
    session.startSetup(setupStartBody.parse(req.body).password),
  );

  app.post('/api/setup/finish', async (req, reply) => {
    const token = await session.finishSetup(setupFinishBody.parse(req.body).answers);
    setCookie(reply, token);
    return { ok: true };
  });

  app.post('/api/unlock', async (req, reply) => {
    const token = await session.unlock(unlockBody.parse(req.body).password);
    setCookie(reply, token);
    return { ok: true };
  });

  app.post('/api/unlock/recovery', async (req, reply) => {
    const { recoveryKey, newPassword } = recoveryUnlockBody.parse(req.body);
    const token = await session.unlockWithRecovery(recoveryKey, newPassword);
    setCookie(reply, token);
    return { ok: true };
  });

  app.post('/api/internal/shutdown', async (req, reply) => {
    const given = String(req.headers['x-lumen-shutdown-token'] ?? '');
    if (!options.shutdownToken || !secureEquals(given, options.shutdownToken)) {
      return send(reply, 403, 'forbidden', 'Brak uprawnień.');
    }
    setImmediate(() => options.onShutdown?.());
    return { ok: true };
  });

  // ── trasy chronione ──────────────────────────────────────────────────────────────────────
  app.post('/api/lock', async (_req, reply: FastifyReply) => {
    session.lock();
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/session/touch', async () => ({
    ok: true,
    autoLockInSeconds: session.autoLockInSeconds(),
  }));

  app.post('/api/shutdown', async () => {
    session.lock();
    setImmediate(() => options.onShutdown?.());
    return { ok: true };
  });

  app.post('/api/password/change', async (req) => {
    const { currentPassword, newPassword } = changePasswordBody.parse(req.body);
    await session.changePassword(currentPassword, newPassword);
    return { ok: true };
  });

  app.post('/api/recovery/rotate', async (req) => {
    const { password } = rotateRecoveryBody.parse(req.body);
    return { recoveryKey: await session.rotateRecovery(password) };
  });

  app.get('/api/settings', async () => session.currentSettings);

  app.put('/api/settings', async (req) =>
    session.updateSettings(settingsPatchSchema.parse(req.body)),
  );

  app.get('/api/backups', async () => ({
    backups: await listBackups(paths.backupsDir),
    directory: paths.backupsDir,
  }));

  app.post('/api/backups', async () => {
    const { db, dek, vault } = session.requireUnlocked();
    return createBackup({
      db,
      dek,
      vault,
      dir: paths.backupsDir,
      kind: 'manual',
      appVersion: APP_VERSION,
    });
  });

  app.post('/api/backups/verify', async (req) => {
    const body = verifyBackupBody.parse(req.body);
    const file = resolve(paths.backupsDir, body.name);
    if (!file.startsWith(resolve(paths.backupsDir) + sep)) {
      throw new BackupError('bad_format', 'Nieprawidłowa nazwa pliku kopii.');
    }
    if (!existsSync(file)) throw new BackupError('bad_format', 'Nie znaleziono pliku kopii.');
    if (body.password) return verifyBackup(file, { password: body.password });
    if (body.recoveryKey) return verifyBackup(file, { recoveryKey: body.recoveryKey });
    return verifyBackupWithDek(file, session.requireUnlocked().dek);
  });

  // ── treści: import, tematy, temat dnia ────────────────────────────────────────────────────
  const staging = new ImportStaging();
  session.onLock(() => staging.clear());
  registerContentRoutes(app, { session, paths, staging, now: options.now ?? (() => new Date()) });

  // ── frontend (po zbudowaniu) ─────────────────────────────────────────────────────────────
  if (options.webRoot && existsSync(join(options.webRoot, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: resolve(options.webRoot),
      wildcard: false,
      index: false,
      setHeaders: (res, path) => {
        res.header(
          'Cache-Control',
          path.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        );
      },
    });
    app.get('/', (_req, reply) => reply.sendFile('index.html'));
    app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.includes('.')) {
        return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      }
      return send(reply, 404, 'not_found', 'Nie znaleziono.');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => send(reply, 404, 'not_found', 'Nie znaleziono.'));
  }

  return app;
}
