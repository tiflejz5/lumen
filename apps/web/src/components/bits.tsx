import {
  Brain,
  Compass,
  FlaskConical,
  HeartPulse,
  Hourglass,
  Landmark,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './ui';

const CATEGORY_ICON: Record<string, LucideIcon> = {
  finance: Landmark,
  science_tech: FlaskConical,
  health_sport: HeartPulse,
  history_society: Hourglass,
  psychology: Brain,
  general: Compass,
};

export function CategoryIcon({ id, className }: { id: string; className?: string }) {
  const Icon = CATEGORY_ICON[id] ?? Compass;
  return <Icon className={cx('size-4', className)} aria-hidden />;
}

const TONES = {
  neutral: 'border-line-strong text-muted',
  accent: 'border-accent/40 bg-accent/10 text-accent-strong',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  danger: 'border-danger/40 bg-danger/10 text-danger',
  ok: 'border-ok/40 bg-ok/10 text-ok',
} as const;

export function Pill({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Link zewnętrzny: tylko http/https, bez przekazywania referrera i bez dostępu do okna źródłowego. */
export function SafeLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  let safe = false;
  try {
    const u = new URL(href);
    safe = u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    safe = false;
  }
  if (!safe) return <span className={className}>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      referrerPolicy="no-referrer"
      className={cx('text-accent underline-offset-4 hover:underline', className)}
    >
      {children}
    </a>
  );
}

export function searchUrl(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}
