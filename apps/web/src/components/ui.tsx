import { AlertTriangle, Check, Eye, EyeOff, Info, Loader2, type LucideIcon } from 'lucide-react';
import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { passwordStrength } from '@lumen/core';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-strong disabled:bg-accent/40',
  secondary: 'bg-raised text-fg border border-line-strong hover:bg-white/10 disabled:opacity-50',
  ghost: 'text-muted hover:text-fg hover:bg-white/5 disabled:opacity-50',
  danger: 'bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25 disabled:opacity-50',
};

/** Klasy przycisku do użycia także na linkach (<Link className={buttonClasses('primary')}>). */
export function buttonClasses(variant: ButtonVariant = 'secondary', className?: string): string {
  return cx(
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors',
    VARIANTS[variant],
    className,
  );
}

export function Button({
  variant = 'secondary',
  busy,
  icon: Icon,
  children,
  className,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  busy?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cx(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed',
        VARIANTS[variant],
        className,
      )}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : Icon ? (
        <Icon className="size-4" aria-hidden />
      ) : null}
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cx(
        'rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

const INPUT =
  'w-full rounded-lg border border-line-strong bg-bg px-3 py-2.5 text-fg placeholder:text-subtle transition-colors hover:border-white/25 focus-visible:border-accent';

export function TextInput({
  label,
  hint,
  error,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <input
        id={id}
        {...rest}
        className={cx(INPUT, className)}
        aria-invalid={error ? true : undefined}
      />
    </Field>
  );
}

export function PasswordInput({
  label,
  hint,
  error,
  showStrength,
  value,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string;
  hint?: string;
  error?: string;
  showStrength?: boolean;
  value: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <div className="relative">
        <input
          id={id}
          {...rest}
          value={value}
          type={visible ? 'text' : 'password'}
          spellCheck={false}
          autoCapitalize="none"
          className={cx(INPUT, 'pr-11')}
          aria-invalid={error ? true : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-fg"
          aria-label={visible ? 'Ukryj hasło' : 'Pokaż hasło'}
          aria-pressed={visible}
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      </div>
      {showStrength && value.length > 0 ? <StrengthMeter password={value} /> : null}
    </Field>
  );
}

const STRENGTH_COLORS = ['bg-danger', 'bg-danger', 'bg-warn', 'bg-ok', 'bg-ok'];

function StrengthMeter({ password }: { password: string }) {
  const { score, label } = passwordStrength(password);
  return (
    <div className="pt-1" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cx(
              'h-1 flex-1 rounded-full',
              i < Math.max(score, 1) && password.length > 0
                ? STRENGTH_COLORS[score]
                : 'bg-white/10',
            )}
          />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-subtle">
        Siła hasła: <span className="text-muted">{label}</span> (ocena orientacyjna – najlepsza jest
        fraza z kilku słów)
      </p>
    </div>
  );
}

const BANNER_STYLES = {
  info: { icon: Info, box: 'border-accent/30 bg-accent/10', iconColor: 'text-accent' },
  warn: { icon: AlertTriangle, box: 'border-warn/40 bg-warn/10', iconColor: 'text-warn' },
  danger: { icon: AlertTriangle, box: 'border-danger/40 bg-danger/10', iconColor: 'text-danger' },
  ok: { icon: Check, box: 'border-ok/40 bg-ok/10', iconColor: 'text-ok' },
} as const;

export function Banner({
  tone = 'info',
  title,
  children,
}: {
  tone?: keyof typeof BANNER_STYLES;
  title?: string;
  children?: ReactNode;
}) {
  const { icon: Icon, box, iconColor } = BANNER_STYLES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('flex gap-3 rounded-lg border p-3.5 text-sm', box)}
    >
      <Icon className={cx('mt-0.5 size-4 shrink-0', iconColor)} aria-hidden />
      <div className="space-y-1">
        {title ? <p className="font-medium text-fg">{title}</p> : null}
        {children ? <div className="text-muted">{children}</div> : null}
      </div>
    </div>
  );
}

export function Spinner({ label = 'Ładowanie…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 p-10 text-muted" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-xl border border-line bg-surface text-muted">
        <Icon className="size-5" aria-hidden />
      </div>
      <h2 className="text-lg">{title}</h2>
      {children ? <p className="mt-2 text-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-muted">{subtitle}</p> : null}
      </div>
      {actions}
    </header>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cx('inline-flex items-center gap-2.5 font-semibold tracking-tight', className)}
    >
      <svg viewBox="0 0 64 64" className="size-7" aria-hidden>
        <rect width="64" height="64" rx="15" fill="var(--color-surface)" />
        <circle cx="32" cy="32" r="16" fill="none" stroke="var(--color-accent)" strokeWidth="4" />
        <circle cx="32" cy="32" r="5" fill="var(--color-accent)" />
      </svg>
      Lumen
    </span>
  );
}

export { cx };
