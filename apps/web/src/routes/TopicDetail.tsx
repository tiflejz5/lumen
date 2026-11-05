import { ArrowLeft, Clock, Search } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { SourceRecord, TopicDetail as Detail } from '@lumen/core';
import { CategoryIcon, Pill, SafeLink, searchUrl } from '../components/bits';
import { Banner, Button, Card, Spinner } from '../components/ui';
import { ApiRequestError, api, errorMessage } from '../lib/api';
import { USER_STATUS_LABEL, useLabels } from '../lib/taxonomy';

function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <Card className="space-y-3">
      <h2 id={id} className="text-lg">
        {title}
      </h2>
      <div aria-labelledby={id}>{children}</div>
    </Card>
  );
}

function SourceItem({
  source,
  why,
  what,
  limitations,
}: {
  source: SourceRecord | undefined;
  why: string;
  what: string;
  limitations?: string | undefined;
}) {
  const labels = useLabels();
  if (!source) return <li className="py-3 text-muted">Źródło nie znajduje się w rejestrze.</li>;
  const meta = [
    source.publisher,
    source.year,
    labels.enumLabel('source_type', source.source_type).replace(/^\d+\.\s*/, ''),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="space-y-1.5 py-4">
      <p className="font-medium leading-snug">
        {source.url && source.url_status !== 'institution_only' ? (
          <SafeLink href={source.url}>{source.name}</SafeLink>
        ) : (
          source.name
        )}
      </p>
      <p className="text-sm text-subtle">{meta}</p>
      <p className="text-sm text-muted">
        <span className="text-fg">Dlaczego: </span>
        {why}
      </p>
      <p className="text-sm text-muted">
        <span className="text-fg">Czego szukać: </span>
        {what}
      </p>
      {limitations ? <p className="text-sm text-warn">Ograniczenia: {limitations}</p> : null}
      {source.limitations ? (
        <p className="text-sm text-subtle">Uwagi do źródła: {source.limitations}</p>
      ) : null}
      {source.conflict_of_interest ? (
        <p className="text-sm text-subtle">
          Możliwy konflikt interesów: {source.conflict_of_interest}
        </p>
      ) : null}
      <p className="text-xs text-subtle">
        {source.url_status === 'verified'
          ? `Adres sprawdzony${source.verified_at ? ` ${source.verified_at}` : ''}.`
          : null}
        {source.url_status === 'unverified'
          ? 'Adres niesprawdzony – jeśli link nie działa, wyszukaj źródło po nazwie.'
          : null}
        {source.url_status === 'institution_only' ? (
          <>
            Podano tylko instytucję, bez adresu.{' '}
            <SafeLink href={searchUrl(`${source.name} ${source.publisher}`)}>Wyszukaj</SafeLink>
          </>
        ) : null}
      </p>
    </li>
  );
}

export function TopicDetail() {
  const { id } = useParams();
  const labels = useLabels();
  const [topic, setTopic] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTopic(await api<Detail>('GET', `/api/topics/${id}`));
      setError(null);
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.status === 404
          ? 'Nie znaleziono takiego tematu.'
          : errorMessage(e),
      );
    }
  }, [id]);

  useEffect(() => {
    setTopic(null);
    void load();
  }, [load]);

  async function setStatus(status: string | null) {
    try {
      const res = await api<{ reassigned: boolean }>('PUT', `/api/topics/${id}/state`, {
        status,
        ...(status === 'postponed' ? { postponeDays: 7 } : {}),
      });
      setNotice(res.reassigned ? 'To był temat dnia – na dziś wylosowano inny.' : null);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (error && !topic) {
    return (
      <div className="space-y-4">
        <Link
          to="/tematy"
          className="inline-flex items-center gap-2 text-sm text-muted hover:text-fg"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Baza tematów
        </Link>
        <Banner tone="danger">{error}</Banner>
      </div>
    );
  }
  if (!topic) return <Spinner />;

  const c = topic.core;
  const sources = new Map(topic.sources.map((s) => [s.id, s]));
  const minutes = c.estimated_minutes;
  const status = topic.userState?.status;

  return (
    <article className="space-y-5">
      <Link
        to="/tematy"
        className="inline-flex items-center gap-2 text-sm text-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Baza tematów
      </Link>

      <header className="space-y-3">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-2">
            <CategoryIcon id={c.category} className="text-accent" />
            {labels.category(c.category)} · {labels.subcategory(c.subcategory)}
          </span>
          <span className="font-mono text-xs text-subtle">{topic.id}</span>
        </p>
        <h1 className="text-2xl leading-snug sm:text-3xl">{c.title}</h1>
        <div className="flex flex-wrap gap-2">
          <Pill>{labels.enumLabel('difficulty', c.difficulty.level)}</Pill>
          <Pill>{labels.enumLabel('topic_type', c.topic_type)}</Pill>
          <Pill>
            <Clock className="size-3" aria-hidden />
            ok. {minutes.research + minutes.quiz + minutes.summary} min (research {minutes.research}
            , sprawdzenie {minutes.quiz}, podsumowanie {minutes.summary})
          </Pill>
          {topic.needsReview ? <Pill tone="warn">Wymaga weryfikacji</Pill> : null}
          {topic.status === 'deprecated' ? <Pill tone="danger">Wycofany</Pill> : null}
          {topic.isExample ? <Pill tone="accent">Przykładowy</Pill> : null}
          {status ? <Pill tone="accent">{USER_STATUS_LABEL[status] ?? status}</Pill> : null}
        </div>
      </header>

      {topic.status === 'deprecated' ? (
        <Banner tone="warn" title="Ten temat został wycofany">
          {topic.supersededBy ? (
            <>
              Zastępuje go:{' '}
              <Link className="text-accent hover:underline" to={`/tematy/${topic.supersededBy}`}>
                {topic.supersededBy}
              </Link>
              .
            </>
          ) : (
            'Nie wskazano następcy.'
          )}
        </Banner>
      ) : null}
      {topic.needsReview ? (
        <Banner tone="warn" title="Termin przeglądu treści minął">
          Informacje mogły się zmienić. Zwróć uwagę zwłaszcza na:
          <ul className="mt-1 list-disc pl-4">
            {(topic.freshness.time_sensitive_items ?? ['brak wskazanych elementów']).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
      {notice ? <Banner tone="info">{notice}</Banner> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <Card className="space-y-4">
        <p className="max-w-[65ch] font-serif text-lg leading-relaxed text-muted">{c.summary}</p>
        <div>
          <h2 className="text-sm font-medium text-fg">Dlaczego warto</h2>
          <p className="mt-1 max-w-[65ch] font-serif leading-relaxed text-muted">
            {c.why_it_matters}
          </p>
        </div>
      </Card>

      <div className="rounded-[var(--radius-card)] border border-accent/30 bg-accent/5 p-5 sm:p-6">
        <h2 className="text-sm font-medium text-accent-strong">Pytanie główne</h2>
        <p className="mt-2 max-w-[60ch] font-serif text-xl leading-snug sm:text-2xl">
          {c.main_question}
        </p>
      </div>

      <Section id="rq" title="Pytania badawcze">
        <ol className="ml-5 list-decimal space-y-2.5 text-muted marker:text-subtle">
          {c.research_questions.map((q, i) => (
            <li key={i} className="pl-1">
              {q}
            </li>
          ))}
        </ol>
      </Section>

      <Section id="search" title="Jak szukać">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {c.keywords.map((k) => (
            <Pill key={k}>{k}</Pill>
          ))}
        </div>
        <ul className="divide-y divide-line">
          {c.search_queries.map((q, i) => (
            <li key={i} className="flex items-start gap-3 py-3">
              <Search className="mt-1 size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <SafeLink href={searchUrl(q.query)} className="break-words">
                  {q.query}
                </SafeLink>
                {q.lang === 'en' ? (
                  <span className="ml-2 align-middle">
                    <Pill>po angielsku</Pill>
                  </span>
                ) : null}
                <span className="block text-sm text-subtle">{q.purpose}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-subtle">
          Zapytania otwierają wyszukiwarkę DuckDuckGo w nowej karcie. Aplikacja nie wysyła tam
          żadnych Twoich danych.
        </p>
      </Section>

      <Section id="src" title="Sugerowane źródła">
        <ul className="divide-y divide-line">
          {c.suggested_sources.map((s) => (
            <SourceItem
              key={s.source_id}
              source={sources.get(s.source_id)}
              why={s.why}
              what={s.what_to_find}
              limitations={s.limitations}
            />
          ))}
        </ul>
      </Section>

      <Section id="verify" title="Jak weryfikować informacje">
        <ul className="ml-5 list-disc space-y-2 text-muted marker:text-subtle">
          {c.verification_tips.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </Section>

      <Section id="task" title="Zadanie końcowe">
        <p className="max-w-[65ch] font-serif leading-relaxed text-muted">{c.final_task}</p>
      </Section>

      {topic.related.length > 0 ? (
        <Section id="rel" title="Powiązane tematy">
          <ul className="space-y-1.5">
            {topic.related.map((r) => (
              <li key={r.id} className="text-sm">
                {r.written ? (
                  <Link className="text-accent hover:underline" to={`/tematy/${r.id}`}>
                    {r.title ?? r.id}
                  </Link>
                ) : (
                  <span className="text-muted">
                    {r.title ?? r.id} <span className="text-subtle">(zaplanowany)</span>
                  </span>
                )}
                <span className="ml-2 font-mono text-xs text-subtle">{r.id}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Card className="space-y-3">
        <h2 className="text-lg">Twoje oznaczenie</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setStatus('known')}
            variant={status === 'known' ? 'primary' : 'secondary'}
          >
            Znam ten temat
          </Button>
          <Button
            onClick={() => setStatus('not_interesting')}
            variant={status === 'not_interesting' ? 'primary' : 'secondary'}
          >
            Nieinteresujący
          </Button>
          <Button
            onClick={() => setStatus('postponed')}
            variant={status === 'postponed' ? 'primary' : 'secondary'}
          >
            Odłóż na tydzień
          </Button>
          {status ? (
            <Button variant="ghost" onClick={() => setStatus(null)}>
              Wyczyść oznaczenie
            </Button>
          ) : null}
        </div>
        {topic.userState?.postponedUntil ? (
          <p className="text-sm text-muted">
            Wróci do losowania po {topic.userState.postponedUntil}.
          </p>
        ) : null}
        <p className="text-xs text-subtle">
          Rewizja {topic.revision} · ostatnia weryfikacja {topic.freshness.last_verified_at} · ocena
          audytu: {labels.enumLabel('audit_grade', topic.auditGrade)}. Opracowanie i quiz pojawią
          się po sesji nauki (Etap 3).
        </p>
      </Card>
    </article>
  );
}
