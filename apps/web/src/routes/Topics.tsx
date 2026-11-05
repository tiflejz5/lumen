import { Database, FileDown, History, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ContentSummary, TopicListItem } from '@lumen/core';
import { CategoryIcon, Pill } from '../components/bits';
import { Banner, Card, EmptyState, PageHeader, Spinner, buttonClasses, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { USER_STATUS_LABEL, useLabels } from '../lib/taxonomy';

const SELECT =
  'rounded-lg border border-line-strong bg-bg px-3 py-2 text-sm text-fg transition-colors hover:border-white/25 focus-visible:border-accent';

function Summary({ content }: { content: ContentSummary }) {
  const labels = useLabels();
  const total = content.topics.active;
  const pct =
    content.catalog.total > 0
      ? Math.round((content.catalog.written / content.catalog.total) * 100)
      : 0;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="space-y-3">
        <h2 className="text-lg">Wydanie bazy</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted">Wersja bazy</dt>
          <dd className="tabular">{content.baseVersion ?? '–'}</dd>
          <dt className="text-muted">Wersja schematu</dt>
          <dd className="tabular">{content.schemaVersion ?? '–'}</dd>
          <dt className="text-muted">Wersja taksonomii</dt>
          <dd className="tabular">{content.taxonomyVersion ?? '–'}</dd>
          <dt className="text-muted">Źródła w rejestrze</dt>
          <dd className="tabular">{content.sources}</dd>
          <dt className="text-muted">Tematy aktywne</dt>
          <dd className="tabular">{total}</dd>
          {content.topics.deprecated > 0 ? (
            <>
              <dt className="text-muted">Tematy wycofane</dt>
              <dd className="tabular">{content.topics.deprecated}</dd>
            </>
          ) : null}
        </dl>
        {content.catalog.total > 0 ? (
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted">Napisane tematy z katalogu</span>
              <span className="tabular">
                {content.catalog.written} z {content.catalog.total}
              </span>
            </div>
            <div
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Postęp pisania bazy tematów"
            >
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : null}
        {content.topics.examples > 0 ? (
          <p className="text-xs text-subtle">
            W bazie jest {content.topics.examples} przykładowych tematów
            {content.demoMode
              ? ' (tryb demonstracyjny włączony)'
              : ' (ukryte – włącz tryb demonstracyjny w Ustawieniach)'}
            .
          </p>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg">Rozkład tematów</h2>
        {total === 0 ? (
          <p className="text-sm text-muted">Brak tematów.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {labels.categories.map((c) => {
              const n = content.topics.byCategory[c.id] ?? 0;
              return (
                <li key={c.id} className="flex items-center gap-3">
                  <CategoryIcon id={c.id} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  <span className="tabular w-8 text-right text-muted">{n}</span>
                  <span
                    className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-white/10 sm:block"
                    aria-hidden
                  >
                    <span
                      className="block h-full rounded-full bg-accent/70"
                      style={{ width: `${total ? (n / total) * 100 : 0}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function Topics() {
  const labels = useLabels();
  const [content, setContent] = useState<ContentSummary | null>(null);
  const [list, setList] = useState<{ total: number; items: TopicListItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('');
  const [type, setType] = useState('');
  const [userStatus, setUserStatus] = useState('');
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    api<ContentSummary>('GET', '/api/content').then(setContent, (e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (debounced) params.set('query', debounced);
    if (category) params.set('category', category);
    if (level) params.set('level', level);
    if (type) params.set('topicType', type);
    if (userStatus) params.set('userStatus', userStatus);
    api<{ total: number; items: TopicListItem[] }>('GET', `/api/topics?${params}`).then(
      setList,
      (e) => setError(errorMessage(e)),
    );
  }, [debounced, category, level, type, userStatus, limit]);

  const filtered = !!(debounced || category || level || type || userStatus);
  const actions = (
    <div className="flex flex-wrap gap-2">
      <Link to="/tematy/importy" className={buttonClasses('secondary')}>
        <History className="size-4" aria-hidden />
        Historia importów
      </Link>
      <Link to="/tematy/import" className={buttonClasses('primary')}>
        <FileDown className="size-4" aria-hidden />
        Importuj
      </Link>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Baza tematów"
        subtitle="Tematy do nauki, wersje wydań i import nowych paczek."
        actions={actions}
      />
      {error ? (
        <div className="mb-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      ) : null}
      {!content || !list ? (
        <Spinner />
      ) : content.topics.active === 0 && content.topics.examples === 0 && !filtered ? (
        <Card>
          <EmptyState
            icon={Database}
            title="Baza tematów jest pusta"
            action={
              <Link to="/tematy/import" className={buttonClasses('primary')}>
                Importuj pierwszą paczkę
              </Link>
            }
          >
            Wybierz folder wydania, plik ZIP albo pojedynczą paczkę. Zobaczysz podgląd zmian i sam
            zdecydujesz, co zostanie zapisane.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-6">
          <Summary content={content} />

          <section aria-labelledby="topics-heading" className="space-y-4">
            <h2 id="topics-heading" className="text-lg">
              Tematy <span className="tabular text-muted">({list.total})</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-52 flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
                  aria-hidden
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Szukaj w tytułach…"
                  aria-label="Szukaj tematów"
                  className="w-full rounded-lg border border-line-strong bg-bg py-2 pl-9 pr-3 text-sm text-fg placeholder:text-subtle hover:border-white/25 focus-visible:border-accent"
                />
              </div>
              <select
                aria-label="Kategoria"
                className={SELECT}
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setLimit(50);
                }}
              >
                <option value="">Wszystkie kategorie</option>
                {labels.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Poziom trudności"
                className={SELECT}
                value={level}
                onChange={(e) => {
                  setLevel(e.target.value);
                  setLimit(50);
                }}
              >
                <option value="">Każdy poziom</option>
                {['beginner', 'intermediate', 'advanced'].map((l) => (
                  <option key={l} value={l}>
                    {labels.enumLabel('difficulty', l)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Typ tematu"
                className={SELECT}
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setLimit(50);
                }}
              >
                <option value="">Każdy typ</option>
                {['timeless', 'current'].map((t) => (
                  <option key={t} value={t}>
                    {labels.enumLabel('topic_type', t)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Twój status"
                className={SELECT}
                value={userStatus}
                onChange={(e) => {
                  setUserStatus(e.target.value);
                  setLimit(50);
                }}
              >
                <option value="">Dowolny status</option>
                <option value="new">Nowe</option>
                {Object.entries(USER_STATUS_LABEL).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {list.items.length === 0 ? (
              <p className="py-8 text-center text-muted">
                Żaden temat nie pasuje do wybranych filtrów.
              </p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
                {list.items.map((t) => (
                  <li key={t.id}>
                    <Link
                      to={`/tematy/${t.id}`}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-white/5"
                    >
                      <CategoryIcon id={t.category} className="mt-1 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cx(
                            'block leading-snug',
                            t.status === 'deprecated' && 'text-muted line-through',
                          )}
                        >
                          {t.title}
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs text-subtle">{t.id}</span>
                          <Pill>{labels.enumLabel('difficulty', t.level)}</Pill>
                          <Pill>{labels.enumLabel('topic_type', t.topicType)}</Pill>
                          {t.userStatus ? (
                            <Pill tone="accent">
                              {USER_STATUS_LABEL[t.userStatus] ?? t.userStatus}
                            </Pill>
                          ) : null}
                          {t.needsReview ? <Pill tone="warn">Wymaga weryfikacji</Pill> : null}
                          {t.status === 'deprecated' ? <Pill tone="danger">Wycofany</Pill> : null}
                          {t.isExample ? <Pill>Przykładowy</Pill> : null}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {list.total > list.items.length ? (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setLimit((l) => l + 50)}
                  className={buttonClasses('secondary')}
                >
                  Pokaż więcej ({list.items.length} z {list.total})
                </button>
              </div>
            ) : null}
          </section>
        </div>
      )}
    </>
  );
}
