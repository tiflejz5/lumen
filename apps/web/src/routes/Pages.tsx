import { Link } from 'react-router-dom';
import { BookOpenCheck } from 'lucide-react';
import { NAV } from '../app/nav';
import { Card, EmptyState, PageHeader } from '../components/ui';

type SoonProps = { title: string; stage: number; description: string };

export function Soon({ title, stage, description }: SoonProps) {
  const Icon = NAV.find((n) => n.label === title)?.icon ?? BookOpenCheck;
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <EmptyState icon={Icon} title="Ta sekcja jest w przygotowaniu">
          {description} Pojawi się w Etapie {stage}.
        </EmptyState>
      </Card>
    </>
  );
}

/** Lista pozostałych pozycji menu na telefonie. */
export function More() {
  const rest = NAV.filter((n) => !n.primary);
  return (
    <>
      <PageHeader title="Więcej" />
      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        {rest.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link to={to} className="flex items-center gap-3 px-4 py-3.5 text-fg hover:bg-white/5">
              <Icon className="size-5 text-muted" aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
