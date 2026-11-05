import { Award, Flame, Repeat, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  REVIEW_LADDER,
  type BadgeStatus,
  type ReviewAnswer,
  type ReviewCard,
  type ReviewListItem,
  type ReviewOverview,
  type ReviewRating,
  type StatsOverview,
} from '@lumen/core';
import { Pill } from '../components/bits';
import { Banner, Button, Card, EmptyState, PageHeader, Spinner, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useLabels } from '../lib/taxonomy';

const dateFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long' });
const fmtDay = (iso: string) => dateFmt.format(new Date(`${iso}T12:00`));

// ── powtórki ──────────────────────────────────────────────────────────────────────────────────

const RATINGS: { rating: ReviewRating; label: string; hint: string }[] = [
  { rating: 'again', label: 'Nie pamiętam', hint: 'wrócę jutro' },
  { rating: 'hard', label: 'Z trudem', hint: 'ten sam odstęp' },
  { rating: 'good', label: 'Dobrze', hint: 'dłuższy odstęp' },
  { rating: 'easy', label: 'Łatwo', hint: 'znacznie dłuższy' },
];

function ReviewRunner({ item, onDone }: { item: ReviewListItem; onDone: () => void }) {
  const [card, setCard] = useState<ReviewCard | null>(null);
  const [answer, setAnswer] = useState<ReviewAnswer | null>(null);
  const [recall, setRecall] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCard(null);
    setAnswer(null);
    setRecall('');
    api<ReviewCard>('GET', `/api/reviews/${item.topicId}/card`)
      .then(setCard)
      .catch((e) => setError(errorMessage(e)));
  }, [item.topicId]);

  async function reveal() {
    try {
      setAnswer(await api<ReviewAnswer>('GET', `/api/reviews/${item.topicId}/answer`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function rate(rating: ReviewRating) {
    setBusy(true);
    try {
      await api('POST', `/api/reviews/${item.topicId}`, { rating });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  if (!card) return error ? <Banner tone="danger">{error}</Banner> : <Spinner />;
  return (
    <Card className="space-y-4">
      <p className="text-sm text-muted">
        Powtórka – spróbuj odpowiedzieć, zanim zajrzysz do notatek
      </p>
      <h2 className="text-xl leading-snug">{card.title}</h2>
      <p className="font-serif text-lg leading-relaxed text-muted">{card.mainQuestion}</p>
      {!answer ? (
        <>
          <label className="block text-sm font-medium" htmlFor="recall">
            Co pamiętasz? (opcjonalnie, tylko dla Ciebie)
          </label>
          <textarea
            id="recall"
            rows={3}
            className="w-full rounded-lg border border-line-strong bg-bg px-3 py-2.5 text-fg"
            value={recall}
            onChange={(e) => setRecall(e.target.value)}
          />
          <Button variant="primary" onClick={() => void reveal()}>
            Pokaż odpowiedź
          </Button>
        </>
      ) : (
        <>
          <div className="space-y-3 rounded-lg border border-line bg-bg p-4">
            <p className="font-serif leading-relaxed">{answer.brief}</p>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              {answer.takeaways.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
          <div role="group" aria-label="Jak poszło?" className="grid gap-2 sm:grid-cols-4">
            {RATINGS.map((r) => (
              <Button
                key={r.rating}
                variant={r.rating === 'good' ? 'primary' : 'secondary'}
                busy={busy}
                onClick={() => void rate(r.rating)}
                className="h-auto flex-col py-2"
              >
                <span>{r.label}</span>
                <span className="text-xs font-normal opacity-70">{r.hint}</span>
              </Button>
            ))}
          </div>
        </>
      )}
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Card>
  );
}

export function ReviewsPage() {
  const labels = useLabels();
  const [overview, setOverview] = useState<ReviewOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);

  const load = useCallback(async () => {
    try {
      setOverview(await api<ReviewOverview>('GET', '/api/reviews'));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!overview) return error ? <Banner tone="danger">{error}</Banner> : <Spinner />;
  const current = overview.due[0];

  return (
    <>
      <PageHeader
        title="Powtórki"
        subtitle="Krótkie przypomnienia w rosnących odstępach: 1, 3, 7, 16, 35, 75 i 150 dni."
      />
      {current ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Do zrobienia: <span className="tabular text-fg">{overview.due.length}</span>
            {done > 0 ? ` · wykonane teraz: ${done}` : ''}
          </p>
          <ReviewRunner
            item={current}
            onDone={() => {
              setDone((n) => n + 1);
              void load();
            }}
          />
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={Repeat}
            title={done > 0 ? 'Powtórki na dziś zrobione' : 'Brak powtórek na dziś'}
          >
            {overview.upcoming.length > 0
              ? `Najbliższa: ${fmtDay(overview.upcoming[0]!.dueDate)}.`
              : 'Powtórki pojawią się po ukończeniu pierwszego tematu.'}
          </EmptyState>
        </Card>
      )}
      {overview.upcoming.length > 0 ? (
        <section className="mt-8" aria-labelledby="upcoming">
          <h2 id="upcoming" className="mb-3 text-lg">
            Najbliższe powtórki
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {overview.upcoming.map((r) => (
              <li
                key={r.topicId}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <Link to={`/tematy/${r.topicId}`} className="hover:underline">
                  {r.title}
                </Link>
                <span className="text-sm text-muted">
                  {labels.category(r.category)} · {fmtDay(r.dueDate)} · etap {r.stage + 1}/
                  {REVIEW_LADDER.length}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

// ── statystyki ────────────────────────────────────────────────────────────────────────────────

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="tabular mt-1 text-2xl">{value}</p>
      {hint ? <p className="mt-1 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

function ActivityChart({ days }: { days: StatsOverview['last30'] }) {
  const max = Math.max(1, ...days.map((d) => d.minutes + d.reviews));
  const width = 600;
  const height = 120;
  const bar = width / days.length;
  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-32 w-full"
        role="img"
        aria-label="Aktywność w ostatnich 30 dniach: minuty nauki i powtórki"
      >
        {days.map((d, i) => {
          const h = ((d.minutes + d.reviews) / max) * (height - 8);
          return (
            <rect
              key={d.date}
              x={i * bar + 2}
              y={height - Math.max(h, d.minutes + d.reviews > 0 ? 3 : 1)}
              width={bar - 4}
              height={Math.max(h, d.minutes + d.reviews > 0 ? 3 : 1)}
              rx={2}
              className={d.sessions + d.reviews > 0 ? 'fill-accent' : 'fill-line-strong'}
            >
              <title>
                {fmtDay(d.date)}: {d.minutes} min, sesje: {d.sessions}, powtórki: {d.reviews}
              </title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-subtle">
        <span>{fmtDay(days[0]!.date)}</span>
        <span>{fmtDay(days.at(-1)!.date)}</span>
      </figcaption>
    </figure>
  );
}

export function StatsPage() {
  const labels = useLabels();
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<StatsOverview>('GET', '/api/stats')
      .then(setStats)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  if (!stats) return error ? <Banner tone="danger">{error}</Banner> : <Spinner />;

  const t = stats.totals;
  const hours =
    t.activeMinutes >= 60 ? `${(t.activeMinutes / 60).toFixed(1)} h` : `${t.activeMinutes} min`;
  if (t.sessions === 0 && t.reviews === 0) {
    return (
      <>
        <PageHeader title="Statystyki" />
        <Card>
          <EmptyState icon={TrendingUp} title="Statystyki pojawią się po pierwszej sesji">
            Ukończ pierwszy temat, a zobaczysz tu regularność, postęp w kategoriach i obszary do
            pogłębienia.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Statystyki"
        subtitle="Regularność, postęp w kategoriach i obszary do pogłębienia."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Seria"
          value={`${stats.streak.current} dni`}
          hint={`Najdłuższa: ${stats.streak.longest}. Jeden dzień wolny w tygodniu jej nie przerywa.`}
        />
        <Stat label="Ukończone tematy" value={String(t.completedTopics)} />
        <Stat label="Czas nauki" value={hours} hint={`${t.sessions} sesji`} />
        <Stat
          label="Poprawne odpowiedzi"
          value={stats.quizAccuracy === null ? '–' : `${Math.round(stats.quizAccuracy * 100)}%`}
          hint="w quizach sesji"
        />
      </div>

      <Card className="mt-6 space-y-2">
        <h2 className="text-lg">Ostatnie 30 dni</h2>
        <ActivityChart days={stats.last30} />
      </Card>

      <section className="mt-6" aria-labelledby="cats">
        <h2 id="cats" className="mb-3 text-lg">
          Postęp w kategoriach
        </h2>
        <ul className="space-y-3">
          {stats.categories.map((c) => (
            <li key={c.category}>
              <Card className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{labels.category(c.category)}</span>
                  <span className="tabular text-sm text-muted">
                    {c.completed} / {c.available}
                  </span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-line"
                  role="progressbar"
                  aria-label={`Postęp: ${labels.category(c.category)}`}
                  aria-valuemin={0}
                  aria-valuemax={Math.max(1, c.available)}
                  aria-valuenow={c.completed}
                >
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{
                      width: `${Math.min(100, (c.completed / Math.max(1, c.available)) * 100)}%`,
                    }}
                  />
                </div>
                {c.avgConfidence !== null ? (
                  <p className="text-xs text-subtle">
                    Średnia pewność {c.avgConfidence.toFixed(1)}/5
                    {c.avgInterest !== null
                      ? ` · zainteresowanie ${c.avgInterest.toFixed(1)}/5`
                      : ''}
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {stats.weakest.length > 0 ? (
        <div className="mt-6">
          <Banner tone="info" title="Obszary do pogłębienia">
            Najniższa pewność: {stats.weakest.map((c) => labels.category(c)).join(', ')}. Możesz
            wrócić do tych tematów w powtórkach.
          </Banner>
        </div>
      ) : null}
    </>
  );
}

// ── osiągnięcia ───────────────────────────────────────────────────────────────────────────────

export function AchievementsPage() {
  const [badges, setBadges] = useState<BadgeStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ badges: BadgeStatus[] }>('GET', '/api/achievements')
      .then((r) => setBadges(r.badges))
      .catch((e) => setError(errorMessage(e)));
  }, []);
  if (!badges) return error ? <Banner tone="danger">{error}</Banner> : <Spinner />;
  const earned = badges.filter((b) => b.unlockedAt).length;
  return (
    <>
      <PageHeader
        title="Osiągnięcia"
        subtitle={`Zdobyte: ${earned} z ${badges.length}. Odznaki nagradzają regularność, nie tempo.`}
      />
      <ul className="grid gap-3 sm:grid-cols-2">
        {badges.map((b) => (
          <li key={b.id}>
            <Card className={cx('h-full space-y-2', !b.unlockedAt && 'opacity-80')}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-base">
                  {b.unlockedAt ? (
                    <Award className="size-4 text-accent" aria-hidden />
                  ) : (
                    <Flame className="size-4 text-subtle" aria-hidden />
                  )}
                  {b.title}
                </h2>
                {b.unlockedAt ? <Pill tone="ok">Zdobyta</Pill> : null}
              </div>
              <p className="text-sm text-muted">{b.description}</p>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-line"
                role="progressbar"
                aria-label={`Postęp: ${b.title}`}
                aria-valuemin={0}
                aria-valuemax={b.goal}
                aria-valuenow={b.value}
              >
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${(b.value / b.goal) * 100}%` }}
                />
              </div>
              <p className="tabular text-xs text-subtle">
                {b.value} / {b.goal}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
