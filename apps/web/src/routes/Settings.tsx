import { Copy, DatabaseBackup, KeyRound, Power, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { MIN_PASSWORD_LENGTH, type BackupInfo, type Settings } from '@lumen/core';
import { Banner, Button, Card, Field, PageHeader, PasswordInput, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useStatus } from '../lib/status';

const LOCK_OPTIONS = [5, 10, 15, 30, 60, 120];
const SELECT =
  'rounded-lg border border-line-strong bg-bg px-3 py-2.5 text-fg transition-colors hover:border-white/25 focus-visible:border-accent';

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Power;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card className="space-y-5">
      <div className="flex items-center gap-3">
        <Icon className="size-5 text-accent" aria-hidden />
        <h2 className="text-lg">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Ustawienia"
        subtitle="Bezpieczeństwo, kopie zapasowe i zarządzanie aplikacją."
      />
      <div className="space-y-6">
        <SecuritySection />
        <PasswordSection />
        <RecoverySection />
        <BackupSection />
        <AppSection />
      </div>
    </>
  );
}

function SecuritySection() {
  const { refresh } = useStatus();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Settings>('GET', '/api/settings').then(setSettings, (e) => setError(errorMessage(e)));
  }, []);

  async function update(patch: Partial<Settings>) {
    setError(null);
    try {
      setSettings(await api<Settings>('PUT', '/api/settings', patch));
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Section icon={ShieldCheck} title="Blokada i dzień nauki">
      {!settings ? (
        <Spinner />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Automatyczna blokada po bezczynności"
            htmlFor="autolock"
            hint="Po tym czasie trzeba ponownie wpisać hasło."
          >
            <select
              id="autolock"
              className={SELECT}
              value={settings.autoLockMinutes}
              onChange={(e) => update({ autoLockMinutes: Number(e.target.value) })}
            >
              {LOCK_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} minut` : `${m / 60} ${m === 60 ? 'godzina' : 'godziny'}`}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Początek dnia nauki"
            htmlFor="daystart"
            hint="Sesja po północy, ale przed tą godziną liczy się jeszcze do poprzedniego dnia."
          >
            <select
              id="daystart"
              className={SELECT}
              value={settings.dayStartHour}
              onChange={(e) => update({ dayStartHour: Number(e.target.value) })}
            >
              {[0, 1, 2, 3, 4, 5, 6].map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Section>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const nextError =
    next.length > 0 && [...next].length < MIN_PASSWORD_LENGTH
      ? `Co najmniej ${MIN_PASSWORD_LENGTH} znaków.`
      : undefined;
  const repeatError = repeat.length > 0 && repeat !== next ? 'Hasła nie są takie same.' : undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api('POST', '/api/password/change', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setRepeat('');
      setMessage({
        tone: 'ok',
        text: 'Hasło zostało zmienione. Klucz odzyskiwania i dane pozostały bez zmian.',
      });
    } catch (err) {
      setMessage({ tone: 'danger', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section icon={KeyRound} title="Zmiana hasła">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <PasswordInput
          label="Obecne hasło"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
        />
        <PasswordInput
          label="Nowe hasło"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          showStrength
          error={nextError}
        />
        <PasswordInput
          label="Powtórz nowe hasło"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          autoComplete="new-password"
          error={repeatError}
        />
        <p className="text-sm text-subtle">
          Starsze kopie zapasowe nadal otwierają się hasłem, które obowiązywało w chwili ich
          utworzenia. Klucz odzyskiwania działa dla wszystkich.
        </p>
        {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={!current || !next || !repeat || !!nextError || !!repeatError}
        >
          Zmień hasło
        </Button>
      </form>
    </Section>
  );
}

function RecoverySection() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ recoveryKey: string }>('POST', '/api/recovery/rotate', { password });
      setNewKey(res.recoveryKey);
      setPassword('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section icon={KeyRound} title="Nowy klucz odzyskiwania">
      {newKey ? (
        <div className="space-y-4">
          <Banner tone="danger" title="Poprzedni klucz przestał działać">
            Zapisz nowy klucz teraz – nie zostanie pokazany ponownie.
          </Banner>
          <p className="break-words rounded-lg border border-line-strong bg-bg px-3 py-3 font-mono text-base leading-loose tracking-wider">
            {newKey}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              icon={Copy}
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(newKey).catch(() => {});
                setCopied(true);
              }}
            >
              {copied ? 'Skopiowano' : 'Kopiuj'}
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="size-4 accent-[var(--color-accent)]"
              />
              Zapisałem nowy klucz
            </label>
            <Button
              variant="primary"
              disabled={!confirmed}
              onClick={() => {
                setNewKey(null);
                setConfirmed(false);
                setCopied(false);
              }}
            >
              Gotowe
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <p className="text-muted">
            Jeśli zgubiłeś klucz albo uważasz, że mógł się wydostać, wygeneruj nowy. Stary
            natychmiast przestanie działać. Hasło i dane pozostaną bez zmian.
          </p>
          <PasswordInput
            label="Hasło (potwierdzenie)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <Button type="submit" busy={busy} disabled={!password}>
            Wygeneruj nowy klucz
          </Button>
        </form>
      )}
    </Section>
  );
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const KIND_LABEL: Record<BackupInfo['kind'], string> = {
  manual: 'Ręczna',
  auto: 'Automatyczna',
  'pre-operation': 'Przed zmianą',
};

type VerifyState = { ok: boolean; text: string };

function BackupSection() {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [directory, setDirectory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, VerifyState>>({});
  const [checking, setChecking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ backups: BackupInfo[]; directory: string }>('GET', '/api/backups');
      setBackups(res.backups);
      setDirectory(res.directory);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/backups', {});
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify(name: string) {
    setChecking(name);
    try {
      const res = await api<{ ok: boolean; message?: string; counts?: Record<string, number> }>(
        'POST',
        '/api/backups/verify',
        { name },
      );
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
    <Section icon={DatabaseBackup} title="Kopie zapasowe">
      <p className="text-muted">
        Kopie są zaszyfrowane tym samym hasłem i kluczem odzyskiwania. Automatyczne kopie, zapis na
        pendrive lub w folderze chmury oraz przywracanie z poziomu aplikacji pojawią się w Etapie 6.
      </p>
      {directory ? (
        <p className="break-all text-sm text-subtle">
          Folder kopii: <span className="font-mono">{directory}</span>
        </p>
      ) : null}
      <Banner tone="warn" title="Brak kopii poza tym komputerem">
        Skopiuj plik z folderu kopii na pendrive lub dysk zewnętrzny. Awaria dysku zniszczy zarówno
        bazę, jak i kopie leżące obok.
      </Banner>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Button variant="primary" onClick={create} busy={busy} icon={DatabaseBackup}>
        Utwórz kopię teraz
      </Button>
      {backups === null ? (
        <Spinner />
      ) : backups.length === 0 ? (
        <p className="text-sm text-subtle">Nie ma jeszcze żadnej kopii.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {backups.map((b) => (
            <li
              key={b.name}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="tabular">{new Date(b.createdAt).toLocaleString('pl-PL')}</p>
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
              <Button onClick={() => verify(b.name)} busy={checking === b.name}>
                Sprawdź
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function AppSection() {
  const { status } = useStatus();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function quit() {
    setBusy(true);
    try {
      await api('POST', '/api/shutdown', {});
    } catch {
      // serwer mógł zamknąć połączenie, zanim odpowiedział
    }
  }

  return (
    <Section icon={Power} title="Aplikacja">
      <p className="text-sm text-muted">
        Lumen <span className="tabular">{status?.version}</span>. Dane są przechowywane lokalnie i
        szyfrowane; aplikacja nie wysyła ich do internetu.
      </p>
      {confirm ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">
            Baza zostanie zablokowana, a serwer zatrzymany.
          </span>
          <Button variant="danger" onClick={quit} busy={busy}>
            Tak, zakończ
          </Button>
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Anuluj
          </Button>
        </div>
      ) : (
        <Button icon={Power} onClick={() => setConfirm(true)}>
          Zakończ aplikację
        </Button>
      )}
    </Section>
  );
}
