import { DatabaseBackup, FileJson, History } from 'lucide-react';
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import type {
  BackupHealth,
  BackupInfo,
  RestorePreviewDto,
  Settings,
  UserDataImportReport,
} from '@lumen/core';
import { Banner, Button, Card, Spinner, TextInput, PasswordInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';

const KIND_LABEL: Record<BackupInfo['kind'], string> = {
  manual: 'Ręczna',
  auto: 'Automatyczna',
  'pre-operation': 'Przed zmianą',
};

const COUNT_LABEL: Record<string, string> = {
  topics: 'tematów',
  study_sessions: 'sesji nauki',
  notes: 'notatek',
  knowledge_entries: 'pojęć w bazie wiedzy',
  review_items: 'powtórek',
};

const TABLE_LABEL: Record<string, string> = {
  topic_user_state: 'Stany tematów',
  daily_assignments: 'Tematy dnia',
  study_sessions: 'Sesje nauki',
  quiz_answers: 'Odpowiedzi w quizach',
  notes: 'Notatki',
  knowledge_entries: 'Pojęcia',
  review_items: 'Powtórki',
  review_log: 'Dziennik powtórek',
  badges: 'Odznaki',
};

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleString('pl-PL');

/** Podgląd i zatwierdzenie przywrócenia kopii. `initial` = pierwsze uruchomienie (bez hasła aplikacji). */
export function RestorePanel({
  backup,
  source,
  initial,
  onClose,
}: {
  backup: BackupInfo;
  source: 'local' | 'mirror';
  initial?: boolean;
  onClose: () => void;
}) {
  const [useKey, setUseKey] = useState(false);
  const [secret, setSecret] = useState('');
  const [preview, setPreview] = useState<RestorePreviewDto | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const credentials = useKey ? { recoveryKey: secret } : { password: secret };

  async function check() {
    setBusy(true);
    setError(null);
    try {
      if (initial) {
        // Bez zalogowanej sesji nie ma podglądu – pokazujemy tylko potwierdzenie.
        setPreview({
          createdAt: backup.createdAt,
          appVersion: '',
          schemaVersion: 0,
          counts: {},
          vaultWillBeReplaced: true,
        });
      } else {
        setPreview(
          await api<RestorePreviewDto>('POST', '/api/backups/restore/preview', {
            name: backup.name,
            source,
            ...credentials,
          }),
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await api('POST', initial ? '/api/restore/initial' : '/api/backups/restore', {
        name: backup.name,
        source,
        ...credentials,
        confirm: true,
      });
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="space-y-3 rounded-lg border border-ok/40 bg-ok/10 p-4">
        <p className="font-medium">Kopia została przywrócona.</p>
        <p className="text-sm text-muted">
          Zaloguj się hasłem z chwili wykonania tej kopii.
          {initial ? '' : ' Poprzedni stan został zachowany w folderze kopii (pre-restore-…).'}
        </p>
        <Button variant="primary" onClick={() => window.location.assign('/')}>
          Przejdź do logowania
        </Button>
      </div>
    );

  return (
    <div className="space-y-3 rounded-lg border border-line bg-bg p-4">
      <p className="text-sm">
        Przywracanie kopii z <strong>{fmtDate(backup.createdAt)}</strong>.
      </p>
      {!preview ? (
        <>
          {useKey ? (
            <TextInput
              label="Klucz odzyskiwania z chwili wykonania kopii"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
            />
          ) : (
            <PasswordInput
              label="Hasło z chwili wykonania kopii"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="current-password"
            />
          )}
          <button
            type="button"
            className="text-sm text-accent hover:underline"
            onClick={() => {
              setUseKey(!useKey);
              setSecret('');
            }}
          >
            {useKey ? 'Użyj hasła' : 'Użyj klucza odzyskiwania'}
          </button>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <div className="flex gap-2">
            <Button variant="primary" busy={busy} disabled={!secret} onClick={() => void check()}>
              {initial ? 'Dalej' : 'Sprawdź kopię'}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Anuluj
            </Button>
          </div>
        </>
      ) : (
        <>
          {!initial ? (
            <ul className="text-sm text-muted">
              {Object.entries(preview.counts)
                .filter(([k, v]) => COUNT_LABEL[k] && v > 0)
                .map(([k, v]) => (
                  <li key={k}>
                    {v} {COUNT_LABEL[k]}
                  </li>
                ))}
            </ul>
          ) : null}
          {preview.vaultWillBeReplaced && !initial ? (
            <Banner tone="warn" title="Zmieni się hasło">
              Ta kopia pochodzi z czasu, gdy hasło było inne. Po przywróceniu zalogujesz się hasłem
              z chwili jej wykonania.
            </Banner>
          ) : null}
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1 size-4 accent-[var(--color-accent)]"
            />
            <span>
              Rozumiem, że obecne dane zostaną zastąpione danymi z kopii.
              {initial ? '' : ' Kopia obecnego stanu zostanie zachowana, a aplikacja zablokowana.'}
            </span>
          </label>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <div className="flex gap-2">
            <Button
              variant="danger"
              busy={busy}
              disabled={!confirmed}
              onClick={() => void restore()}
            >
              Przywróć kopię
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Anuluj
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function BackupList({
  items,
  source,
  onChanged,
}: {
  items: BackupInfo[];
  source: 'local' | 'mirror';
  onChanged?: () => void;
}) {
  const [verified, setVerified] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  void onChanged;

  async function verify(name: string) {
    setChecking(name);
    try {
      const res = await api<{ ok: boolean; message?: string }>('POST', '/api/backups/verify', {
        name,
      });
      setVerified((v) => ({
        ...v,
        [name]: {
          ok: res.ok,
          text: res.ok ? 'Kopia jest poprawna' : (res.message ?? 'Kopia jest uszkodzona'),
        },
      }));
    } catch (e) {
      setVerified((v) => ({ ...v, [name]: { ok: false, text: errorMessage(e) } }));
    } finally {
      setChecking(null);
    }
  }

  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {items.map((b) => (
        <li key={b.name} className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="tabular">{fmtDate(b.createdAt)}</p>
              <p className="text-sm text-subtle">
                {KIND_LABEL[b.kind]}
                {b.label ? ` · ${b.label}` : ''} · {formatSize(b.sizeBytes)}
              </p>
              {verified[b.name] ? (
                <p
                  className={`text-sm ${verified[b.name]!.ok ? 'text-ok' : 'text-danger'}`}
                  role="status"
                >
                  {verified[b.name]!.text}
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              {source === 'local' ? (
                <Button onClick={() => void verify(b.name)} busy={checking === b.name}>
                  Sprawdź
                </Button>
              ) : null}
              <Button onClick={() => setRestoring(restoring === b.name ? null : b.name)}>
                Przywróć…
              </Button>
            </div>
          </div>
          {restoring === b.name ? (
            <RestorePanel backup={b} source={source} onClose={() => setRestoring(null)} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function BackupSection() {
  const [data, setData] = useState<{
    backups: BackupInfo[];
    mirrorBackups: BackupInfo[];
    directory: string;
    health: BackupHealth;
  } | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mirrorDraft, setMirrorDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api('GET', '/api/backups'));
      const s = await api<Settings>('GET', '/api/settings');
      setSettings(s);
      setMirrorDraft(s.backupMirrorDir);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function update(patch: Partial<Settings>) {
    setError(null);
    try {
      setSettings(await api<Settings>('PUT', '/api/settings', patch));
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ mirror: { ok: boolean; skipped: boolean; error: string | null } }>(
        'POST',
        '/api/backups',
        {},
      );
      if (res.mirror.error)
        setNotice(
          `Kopia powstała, ale nie skopiowano jej do folderu dodatkowego: ${res.mirror.error}`,
        );
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const health = data?.health;
  return (
    <Card className="space-y-5">
      <div className="flex items-center gap-3">
        <DatabaseBackup className="size-5 text-accent" aria-hidden />
        <h2 className="text-lg">Kopie zapasowe</h2>
      </div>
      <p className="text-muted">
        Kopie są zaszyfrowane tym samym hasłem i kluczem odzyskiwania, więc można je bezpiecznie
        trzymać na pendrive lub w chmurze.
      </p>
      {health ? (
        <Banner
          tone={health.level === 'ok' ? 'ok' : 'warn'}
          title={
            health.level === 'ok'
              ? 'Kopie zapasowe są w porządku'
              : health.level === 'none'
                ? 'Brak kopii zapasowej'
                : 'Warto poprawić kopie zapasowe'
          }
        >
          {health.message}
          {health.lastBackupAt ? ` Ostatnia kopia: ${fmtDate(health.lastBackupAt)}.` : ''}
        </Banner>
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {notice ? <Banner tone="warn">{notice}</Banner> : null}

      {settings ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={settings.autoBackup}
              onChange={(e) => void update({ autoBackup: e.target.checked })}
              className="mt-1 size-4 accent-[var(--color-accent)]"
            />
            <span>
              Automatyczne kopie
              <span className="block text-subtle">
                Raz na dobę, po odblokowaniu aplikacji i w trakcie pracy.
              </span>
            </span>
          </label>
          <div className="space-y-1.5">
            <label htmlFor="keep" className="block text-sm font-medium">
              Ile automatycznych kopii zachować
            </label>
            <select
              id="keep"
              className="rounded-lg border border-line-strong bg-bg px-3 py-2.5 text-fg"
              value={settings.autoBackupKeep}
              onChange={(e) => void update({ autoBackupKeep: Number(e.target.value) })}
            >
              {[3, 7, 14, 30].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <p className="text-sm text-subtle">Kopii ręcznych aplikacja nigdy sama nie usuwa.</p>
          </div>
          <div className="space-y-2">
            <TextInput
              label="Dodatkowy folder na kopie"
              hint="Np. pendrive (E:\Lumen) albo folder synchronizowany z chmurą. Każda nowa kopia jest tam kopiowana."
              placeholder="E:\Lumen"
              value={mirrorDraft}
              onChange={(e) => setMirrorDraft(e.target.value)}
            />
            <Button
              disabled={mirrorDraft.trim() === settings.backupMirrorDir}
              onClick={() => void update({ backupMirrorDir: mirrorDraft.trim() })}
            >
              Zapisz folder
            </Button>
          </div>
        </div>
      ) : null}

      {data?.directory ? (
        <p className="break-all text-sm text-subtle">
          Folder kopii: <span className="font-mono">{data.directory}</span>
        </p>
      ) : null}
      <Button variant="primary" onClick={() => void create()} busy={busy} icon={DatabaseBackup}>
        Utwórz kopię teraz
      </Button>

      {!data ? (
        <Spinner />
      ) : data.backups.length === 0 ? (
        <p className="text-sm text-subtle">Nie ma jeszcze żadnej kopii.</p>
      ) : (
        <BackupList items={data.backups} source="local" onChanged={() => void load()} />
      )}
      {data && data.mirrorBackups.length > 0 ? (
        <section className="space-y-2" aria-labelledby="mirror-list">
          <h3 id="mirror-list" className="text-base">
            Kopie w folderze dodatkowym
          </h3>
          <BackupList items={data.mirrorBackups} source="mirror" />
        </section>
      ) : null}
    </Card>
  );
}

export function UserDataSection() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<UserDataImportReport | null>(null);

  async function exportData() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/user-data/export', { cache: 'no-store' });
      if (!res.ok) throw new Error('export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lumen-dane-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Nie udało się wyeksportować danych.');
    } finally {
      setBusy(false);
    }
  }

  async function importData(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const json: unknown = JSON.parse(await file.text());
      setReport(await api<UserDataImportReport>('POST', '/api/user-data/import', json));
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? 'Ten plik nie jest poprawnym plikiem JSON.'
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-3">
        <FileJson className="size-5 text-accent" aria-hidden />
        <h2 className="text-lg">Eksport i import danych</h2>
      </div>
      <p className="text-muted">
        Plik zawiera Twoje sesje, oceny, notatki, pojęcia i powtórki (bez treści bazy tematów).
        Można go wczytać na innym komputerze albo użyć jako dodatkowej kopii.
      </p>
      <Banner tone="warn" title="Eksport nie jest szyfrowany">
        Plik jest czytelny dla każdego, kto go otworzy. Przechowuj go tak ostrożnie jak własne
        notatki; do bezpiecznego archiwum używaj zaszyfrowanych kopii zapasowych powyżej.
      </Banner>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => void exportData()} busy={busy} icon={FileJson}>
          Eksportuj dane
        </Button>
        <label className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line-strong px-4 text-sm font-medium hover:border-white/25">
          <History className="size-4" aria-hidden />
          Importuj dane
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Wybierz plik danych do importu"
            onChange={(e) => void importData(e)}
          />
        </label>
      </div>
      <p className="text-sm text-subtle">
        Import scala dane: nowszy zapis wygrywa, a nic nie jest usuwane. Przed importem powstaje
        kopia zapasowa.
      </p>
      {report ? (
        <div className="space-y-2 rounded-lg border border-line bg-bg p-4 text-sm">
          <p className="font-medium">Import zakończony</p>
          <ul className="space-y-0.5 text-muted">
            {Object.entries(report.tables)
              .filter(([, t]) => t.inserted + t.updated + t.skipped > 0)
              .map(([name, t]) => (
                <li key={name}>
                  {TABLE_LABEL[name] ?? name}: dodano {t.inserted}, zaktualizowano {t.updated}
                  {t.skipped ? `, pominięto ${t.skipped}` : ''}
                </li>
              ))}
          </ul>
          {Object.values(report.tables).every((t) => t.inserted + t.updated + t.skipped === 0) ? (
            <p className="text-muted">Wszystkie dane były już w tej bazie.</p>
          ) : null}
          {report.notes.map((n) => (
            <p key={n} className="text-warn">
              {n}
            </p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/** Przywracanie na ekranie pierwszej konfiguracji (np. po awarii dysku): kopia musi leżeć w folderze kopii. */
export function RestoreInitial() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ backups: BackupInfo[]; directory: string } | null>(null);
  const [picked, setPicked] = useState<BackupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function show() {
    setOpen(true);
    try {
      setData(await api('GET', '/api/restore/initial/list'));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!open)
    return (
      <button
        type="button"
        className="text-sm text-accent hover:underline"
        onClick={() => void show()}
      >
        Mam kopię zapasową – przywróć dane
      </button>
    );
  return (
    <div className="space-y-3 rounded-lg border border-line p-4">
      <h3 className="text-base">Przywracanie z kopii</h3>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {data ? (
        <>
          <p className="text-sm text-muted">
            Skopiuj plik <span className="font-mono">.bazabak</span> do folderu{' '}
            <span className="break-all font-mono">{data.directory}</span>, a potem wybierz go z
            listy.
          </p>
          {data.backups.length === 0 ? (
            <p className="text-sm text-subtle">W tym folderze nie ma jeszcze żadnej kopii.</p>
          ) : (
            <ul className="space-y-2">
              {data.backups.map((b) => (
                <li key={b.name}>
                  <Button onClick={() => setPicked(b)}>{fmtDate(b.createdAt)}</Button>
                </li>
              ))}
            </ul>
          )}
          {picked ? (
            <RestorePanel backup={picked} source="local" initial onClose={() => setPicked(null)} />
          ) : null}
        </>
      ) : (
        <Spinner />
      )}
    </div>
  );
}
