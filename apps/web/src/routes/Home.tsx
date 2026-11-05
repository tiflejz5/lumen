import { BookOpenCheck, ChevronDown, Clock, Dices, FileDown } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DailyResult, DayStatus, TopicCard } from '@lumen/core';
import { CategoryIcon, Pill } from '../components/bits';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  buttonClasses,
  cx,
} from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useLabels } from '../lib/taxonomy';
import { StartSessionButton } from './Study';

const today = new Intl.DateTimeFormat('pl-PL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
}).format(new Date());

function TopicHeader({ topic }: { topic: TopicCard }) {
  const labels = useLabels();
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
        <span className="inline-flex items-center gap-2">
          <CategoryIcon id={topic.category} className="text-accent" />
          {labels.category(topic.category)}
          <span aria-hidden className="text-subtle">
            ·
          </span>
          {labels.subcategory(topic.subcategory)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Pill>{labels.enumLabel('difficulty', topic.level)}</Pill>
        <Pill>{labels.enumLabel('topic_type', topic.topicType)}</Pill>
        <Pill>
          <Clock className="size-3" aria-hidden />~{topic.estimatedMinutes} min
        </Pill>
        {topic.needsReview ? (
          <Pill tone="warn" title="Termin przeglądu treści minął – informacje mogły się zmienić">
            Wymaga weryfikacji
          </Pill>
        ) : null}
        {topic.isExample ? <Pill tone="accent">Przykładowy</Pill> : null}
      </div>
    </>
  );
}

function WhyPanel({ result }: { result: DailyResult }) {
  const e = result.explanation;
  if (!e) return null;
  return (
    <div className="mt-4 rounded-lg border border-line bg-bg p-4 text-sm">
      <p className="text-muted">
        Temat wybrała prosta, jawna reguła (nie sztuczna inteligencja) spośród{' '}
        <span className="tabular text-fg">{e.candidates}</span> dostępnych. Każdy czynnik zmienia
        szanse tematu – wartość powyżej 1 zwiększa, poniżej 1 zmniejsza.
      </p>
      <ul className="mt-3 divide-y divide-line">
        {e.factors.map((f) => (
          <li key={f.key} className="flex items-baseline justify-between gap-4 py-2">
            <span>
              <span className="text-fg">{f.label}</span>
              <span className="block text-subtle">{f.detail}</span>
            </span>
            <span className="tabular text-muted">×{f.value}</span>
          </li>
        ))}
      </ul>
      {e.rotationRelaxed ? (
        <p className="mt-3 text-warn">
          Zasada rotacji kategorii została poluzowana, bo nie było innych dostępnych tematów.
        </p>
      ) : null}
    </div>
  );
}

export function Home() {
  const [daily, setDaily] = useState<DailyResult | null>(null);
  const [extra, setExtra] = useState<DailyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [day, setDay] = useState<DayStatus | null>(null);

  const load = useCallback(async () => {
    try {
      setDaily(await api<DailyResult>('GET', '/api/daily'));
      setDay(await api<DayStatus>('GET', '/api/day'));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mark(status: 'known' | 'not_interesting' | 'postponed') {
    if (!daily?.topic) return;
    setBusy(status);
    try {
      await api('PUT', `/api/topics/${daily.topic.id}/state`, {
        status,
        ...(status === 'postponed' ? { postponeDays: 7 } : {}),
      });
      setWhy(false);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function drawExtra() {
    setBusy('extra');
    try {
      setExtra(await api<DailyResult>('POST', '/api/daily/extra', {}));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!daily && !error) return <Spinner />;

  return (
    <>
      <PageHeader title="Dziś" subtitle={today.charAt(0).toUpperCase() + today.slice(1)} />
      {error ? (
        <div className="mb-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      ) : null}

      {daily && !daily.topic ? (
        <Card>
          {daily.reason === 'no_topics' ? (
            <EmptyState
              icon={BookOpenCheck}
              title="Nie ma jeszcze tematów do nauki"
              action={
                <Link to="/tematy/import" className={buttonClasses('primary')}>
                  <FileDown className="size-4" aria-hidden />
                  Zaimportuj bazę tematów
                </Link>
              }
            >
              Baza tematów jest pusta. Wczytaj paczkę z tematami, a pierwszy temat dnia pojawi się
              tutaj.
            </EmptyState>
          ) : (
            <EmptyState icon={BookOpenCheck} title="Wykorzystałeś wszystkie dostępne tematy">
              Nie ma już nowych tematów spełniających Twoje ustawienia. Zaimportuj kolejną paczkę
              albo przejrzyj tematy odłożone w sekcji „Baza tematów”.
            </EmptyState>
          )}
        </Card>
      ) : null}

      {daily?.topic ? (
        <Card className="space-y-5">
          <div>
            <TopicHeader topic={daily.topic} />
            <h2 className="mt-4 text-2xl leading-snug sm:text-3xl">{daily.topic.title}</h2>
            <p className="mt-3 max-w-[65ch] font-serif text-lg leading-relaxed text-muted">
              {daily.topic.summary}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {day?.dailyDone ? (
              <Pill tone="ok">Dzień zaliczony</Pill>
            ) : (
              <StartSessionButton
                topicId={daily.topic.id}
                label={
                  day?.activeSession?.topicId === daily.topic.id
                    ? 'Wróć do sesji'
                    : 'Rozpocznij sesję'
                }
              />
            )}
            <Link to={`/tematy/${daily.topic.id}`} className={buttonClasses('secondary')}>
              Otwórz temat
            </Link>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setWhy((v) => !v)}
              aria-expanded={why}
            >
              Dlaczego ten temat?
              <ChevronDown
                className={cx('size-4 transition-transform', why && 'rotate-180')}
                aria-hidden
              />
            </Button>
          </div>
          {why ? <WhyPanel result={daily} /> : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4 text-sm text-muted">
            <span className="mr-1">Ten temat jest:</span>
            <Button
              type="button"
              variant="ghost"
              onClick={() => mark('known')}
              busy={busy === 'known'}
            >
              Już go znam
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => mark('not_interesting')}
              busy={busy === 'not_interesting'}
            >
              Nieinteresujący
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => mark('postponed')}
              busy={busy === 'postponed'}
            >
              Odłóż na tydzień
            </Button>
          </div>
          <p className="text-xs text-subtle">
            Wybranie jednej z tych opcji losuje inny temat na dziś.
          </p>
        </Card>
      ) : null}

      {daily ? (
        <section className="mt-8" aria-labelledby="extra-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="extra-heading" className="text-lg">
                Dodatkowy temat
              </h2>
              <p className="text-sm text-muted">
                Dodatkowe losowanie nie zastępuje tematu dnia i nie wpływa na postęp.
              </p>
            </div>
            <Button icon={Dices} onClick={drawExtra} busy={busy === 'extra'}>
              Wylosuj dodatkowy temat
            </Button>
          </div>
          {extra?.topic ? (
            <Card className="mt-4 space-y-3">
              <TopicHeader topic={extra.topic} />
              <h3 className="text-xl leading-snug">{extra.topic.title}</h3>
              <p className="max-w-[65ch] font-serif text-muted">{extra.topic.summary}</p>
              <div className="flex flex-wrap gap-3">
                <StartSessionButton topicId={extra.topic.id} />
                <Link to={`/tematy/${extra.topic.id}`} className={buttonClasses('secondary')}>
                  Otwórz temat
                </Link>
              </div>
            </Card>
          ) : extra ? (
            <div className="mt-4">
              <Banner tone="info">Brak innych dostępnych tematów do wylosowania.</Banner>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
