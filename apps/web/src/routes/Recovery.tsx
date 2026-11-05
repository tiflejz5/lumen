import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH } from '@lumen/core';
import { Banner, Button, Card, Field, PasswordInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useStatus } from '../lib/status';
import { AuthLayout } from './AuthLayout';

export function Recovery({ onBack }: { onBack: () => void }) {
  const { refresh } = useStatus();
  const [key, setKey] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordError =
    password.length > 0 && [...password].length < MIN_PASSWORD_LENGTH
      ? `Co najmniej ${MIN_PASSWORD_LENGTH} znaków.`
      : undefined;
  const repeatError =
    repeat.length > 0 && repeat !== password ? 'Hasła nie są takie same.' : undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/unlock/recovery', { recoveryKey: key, newPassword: password });
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout wide>
      <Card>
        <form onSubmit={submit} className="space-y-5" noValidate>
          <div className="flex items-center gap-3">
            <KeyRound className="size-5 text-accent" aria-hidden />
            <h1 className="text-xl">Odzyskiwanie dostępu</h1>
          </div>
          <p className="text-muted">
            Wpisz klucz odzyskiwania z wydruku lub menedżera haseł i ustaw nowe hasło. Dane
            pozostaną nietknięte.
          </p>
          <Field
            label="Klucz odzyskiwania"
            htmlFor="recovery-key"
            hint="Wielkość liter i myślniki nie mają znaczenia."
          >
            <textarea
              id="recovery-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              rows={3}
              spellCheck={false}
              autoComplete="off"
              autoFocus
              className="w-full rounded-lg border border-line-strong bg-bg px-3 py-2.5 font-mono tracking-wider text-fg transition-colors hover:border-white/25 focus-visible:border-accent"
            />
          </Field>
          <PasswordInput
            label="Nowe hasło"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            showStrength
            error={passwordError}
          />
          <PasswordInput
            label="Powtórz nowe hasło"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
            error={repeatError}
          />
          <Banner tone="warn">
            Jeśli nie masz ani hasła, ani klucza odzyskiwania, danych nie da się odzyskać – nie ma
            żadnej innej drogi.
          </Banner>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <div className="flex justify-between gap-2">
            <Button variant="ghost" type="button" onClick={onBack}>
              Wróć
            </Button>
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              disabled={!key.trim() || !password || !repeat || !!passwordError || !!repeatError}
            >
              Odblokuj i ustaw hasło
            </Button>
          </div>
        </form>
      </Card>
    </AuthLayout>
  );
}
