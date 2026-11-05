import { RestoreInitial } from './BackupSettings';
import { Copy, KeyRound, Printer, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH, type SetupStartResponse } from '@lumen/core';
import { Banner, Button, Card, PasswordInput, TextInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useStatus } from '../lib/status';
import { AuthLayout } from './AuthLayout';

type Step = 'password' | 'key' | 'confirm';

export function Setup() {
  const { status, refresh } = useStatus();
  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [setup, setSetup] = useState<SetupStartResponse | null>(null);
  const [saved, setSaved] = useState(false);
  const [answers, setAnswers] = useState(['', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const passwordError =
    password.length > 0 && [...password].length < MIN_PASSWORD_LENGTH
      ? `Co najmniej ${MIN_PASSWORD_LENGTH} znaków.`
      : undefined;
  const repeatError =
    repeat.length > 0 && repeat !== password ? 'Hasła nie są takie same.' : undefined;

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    if (passwordError || repeatError || !password) return;
    setBusy(true);
    setError(null);
    try {
      setSetup(await api<SetupStartResponse>('POST', '/api/setup/start', { password }));
      setStep('key');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitConfirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/setup/finish', { answers });
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyKey() {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.recoveryKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    } catch {
      setError('Nie udało się skopiować. Zapisz klucz ręcznie lub wydrukuj.');
    }
  }

  const groups = setup?.recoveryKey.split('-') ?? [];

  return (
    <AuthLayout wide={step !== 'password'}>
      <div className="print:hidden">
        <ol
          className="mb-5 flex items-center justify-center gap-2 text-xs text-subtle"
          aria-label="Postęp konfiguracji"
        >
          {(['password', 'key', 'confirm'] as const).map((s, i) => (
            <li
              key={s}
              className="flex items-center gap-2"
              aria-current={step === s ? 'step' : undefined}
            >
              <span
                className={`grid size-5 place-items-center rounded-full border text-[11px] ${step === s ? 'border-accent text-accent' : 'border-line-strong'}`}
              >
                {i + 1}
              </span>
              <span className={step === s ? 'text-fg' : ''}>
                {['Hasło', 'Klucz odzyskiwania', 'Potwierdzenie'][i]}
              </span>
              {i < 2 ? <span className="h-px w-6 bg-line-strong" aria-hidden /> : null}
            </li>
          ))}
        </ol>

        {step === 'password' && (
          <Card>
            <form onSubmit={submitPassword} className="space-y-5" noValidate>
              <div>
                <h1 className="text-xl">Zabezpiecz swoją bazę wiedzy</h1>
                <p className="mt-1.5 text-muted">
                  Wszystko, co zapiszesz, będzie zaszyfrowane Twoim hasłem. Wybierz coś, co
                  zapamiętasz – najlepiej frazę z kilku słów.
                </p>
              </div>
              {status?.orphanDatabase ? (
                <Banner tone="warn" title="Znaleziono istniejącą bazę bez pliku klucza">
                  Jeśli to przypadek (np. usunięty plik vault.json), przerwij i przywróć plik lub
                  kopię zapasową. Kontynuacja odłoży starą bazę na bok i utworzy nową, pustą.
                </Banner>
              ) : null}
              <PasswordInput
                label="Hasło"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
                showStrength
                error={passwordError}
              />
              <PasswordInput
                label="Powtórz hasło"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                autoComplete="new-password"
                error={repeatError}
              />
              <Banner tone="warn" title="Hasła nie da się zresetować">
                Nikt – także autor aplikacji – nie może go odzyskać. W następnym kroku dostaniesz
                klucz odzyskiwania, który jest jedyną drugą drogą do danych.
              </Banner>
              {error ? <Banner tone="danger">{error}</Banner> : null}
              <Button
                type="submit"
                variant="primary"
                busy={busy}
                disabled={!password || !repeat || !!passwordError || !!repeatError}
                className="w-full"
              >
                Dalej
              </Button>
            </form>
            <div className="mt-5 border-t border-line pt-4">
              <RestoreInitial />
            </div>
          </Card>
        )}

        {step === 'key' && setup && (
          <Card className="space-y-5">
            <div className="flex items-start gap-3">
              <KeyRound className="mt-1 size-5 shrink-0 text-accent" aria-hidden />
              <div>
                <h1 className="text-xl">Twój klucz odzyskiwania</h1>
                <p className="mt-1.5 text-muted">
                  Jeśli zapomnisz hasła, tylko ten klucz otworzy bazę. Pokazujemy go jeden raz.
                </p>
              </div>
            </div>

            <ol
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              aria-label="Klucz odzyskiwania w grupach po cztery znaki"
            >
              {groups.map((g, i) => (
                <li key={i} className="rounded-lg border border-line-strong bg-bg px-3 py-2">
                  <span className="block text-[11px] text-subtle tabular">{i + 1}</span>
                  <span className="font-mono text-base tracking-wider">{g}</span>
                </li>
              ))}
            </ol>

            <div className="flex flex-wrap gap-2">
              <Button icon={Copy} onClick={copyKey} type="button">
                {copied ? 'Skopiowano' : 'Kopiuj'}
              </Button>
              <Button icon={Printer} onClick={() => window.print()} type="button">
                Drukuj
              </Button>
            </div>

            <Banner tone="warn" title="Zapisz go poza tym komputerem">
              Najlepiej wydrukuj albo zapisz w menedżerze haseł. Nie trzymaj go obok bazy. Schowek
              Windows (Win+V) może zapamiętać skopiowany tekst – po wklejeniu go wyczyść.
            </Banner>
            <Banner tone="danger" title="Utrata hasła i klucza = utrata danych">
              Bez obu nie da się odzyskać ani bazy, ani kopii zapasowych. Nie ma resetu ani tylnych
              drzwi.
            </Banner>

            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={saved}
                onChange={(e) => setSaved(e.target.checked)}
                className="mt-1 size-4 accent-[var(--color-accent)]"
              />
              <span>
                Zapisałem klucz w bezpiecznym miejscu i rozumiem, że nie da się go odtworzyć.
              </span>
            </label>
            {error ? <Banner tone="danger">{error}</Banner> : null}
            <div className="flex justify-between gap-2">
              <Button variant="ghost" type="button" onClick={() => setStep('password')}>
                Wstecz
              </Button>
              <Button
                variant="primary"
                disabled={!saved}
                onClick={() => {
                  setError(null);
                  setStep('confirm');
                }}
                type="button"
              >
                Dalej
              </Button>
            </div>
          </Card>
        )}

        {step === 'confirm' && setup && (
          <Card>
            <form onSubmit={submitConfirm} className="space-y-5" noValidate>
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-1 size-5 shrink-0 text-accent" aria-hidden />
                <div>
                  <h1 className="text-xl">Potwierdź, że klucz jest zapisany</h1>
                  <p className="mt-1.5 text-muted">
                    Przepisz z zapisu trzy wskazane fragmenty. To jedyny sposób, żebyśmy mieli
                    pewność, że w razie potrzeby odzyskasz dostęp.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {setup.challenge.map((n, i) => (
                  <TextInput
                    key={n}
                    label={`Grupa nr ${n}`}
                    value={answers[i] ?? ''}
                    onChange={(e) =>
                      setAnswers((a) =>
                        a.map((v, j) => (j === i ? e.target.value.toUpperCase() : v)),
                      )
                    }
                    maxLength={5}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono tracking-wider"
                    autoFocus={i === 0}
                  />
                ))}
              </div>
              {error ? <Banner tone="danger">{error}</Banner> : null}
              <div className="flex justify-between gap-2">
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep('key');
                  }}
                >
                  Wstecz
                </Button>
                <Button
                  variant="primary"
                  type="submit"
                  busy={busy}
                  disabled={answers.some((a) => a.trim().length < 4)}
                >
                  Utwórz zaszyfrowaną bazę
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>

      {/* Wersja do wydruku: jasna, czytelna, tylko klucz. */}
      {setup ? (
        <div className="hidden bg-white p-8 text-black print:block">
          <h1 className="text-2xl font-semibold">Lumen – klucz odzyskiwania</h1>
          <p className="mt-2">
            Przechowuj w bezpiecznym miejscu, poza komputerem. Bez hasła i tego klucza danych nie da
            się odzyskać.
          </p>
          <p className="mt-6 font-mono text-xl leading-loose tracking-widest">
            {setup.recoveryKey}
          </p>
          <p className="mt-6 text-sm">Wydrukowano: {new Date().toLocaleDateString('pl-PL')}</p>
        </div>
      ) : null}
    </AuthLayout>
  );
}
