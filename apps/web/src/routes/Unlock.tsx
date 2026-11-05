import { LockKeyhole } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Banner, Button, Card, PasswordInput } from '../components/ui';
import { ApiRequestError, api, errorMessage } from '../lib/api';
import { useStatus } from '../lib/status';
import { AuthLayout } from './AuthLayout';
import { Recovery } from './Recovery';

export function Unlock() {
  const { refresh } = useStatus();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy || wait > 0) return;
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/unlock', { password });
      setPassword('');
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError && err.retryAfterSeconds) setWait(err.retryAfterSeconds);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  if (recovery) return <Recovery onBack={() => setRecovery(false)} />;

  return (
    <AuthLayout>
      <Card>
        <form onSubmit={submit} className="space-y-5" noValidate>
          <div className="flex items-center gap-3">
            <LockKeyhole className="size-5 text-accent" aria-hidden />
            <h1 className="text-xl">Odblokuj bazę</h1>
          </div>
          {/* Pole użytkownika pomaga menedżerom haseł zapisać dane logowania. */}
          <input
            type="text"
            name="username"
            value="Lumen"
            autoComplete="username"
            readOnly
            hidden
          />
          <PasswordInput
            label="Hasło"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
          {error ? (
            <Banner tone="danger">
              {error}
              {wait > 0 ? <span className="tabular"> Odczekaj: {wait} s.</span> : null}
            </Banner>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            disabled={!password || wait > 0}
            className="w-full"
          >
            Odblokuj
          </Button>
          <button
            type="button"
            onClick={() => setRecovery(true)}
            className="mx-auto block text-sm text-muted underline-offset-4 hover:text-fg hover:underline"
          >
            Nie pamiętam hasła
          </button>
        </form>
      </Card>
    </AuthLayout>
  );
}
