import { Check, Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { DifficultyRating, SessionStage, SessionView, TopicDetail } from '@lumen/core';
import { SafeLink, searchUrl } from '../components/bits';
import { Banner, Button, Card, Spinner, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';

const STEPS: { stage: SessionStage; label: string }[] = [
  { stage: 'research', label: 'Research' },
  { stage: 'check', label: 'Sprawdzenie' },
  { stage: 'speaking', label: 'Wypowiedź' },
  { stage: 'done', label: 'Zakończenie' },
];
const ORDER: SessionStage[] = ['research', 'check', 'speaking', 'done'];

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Elastyczny timer: mierzy aktywny czas, można go wstrzymać; stan jest zapisywany na serwerze co kilkanaście sekund. */
function useActiveTimer(initial: number, running: boolean) {
  const [seconds, setSeconds] = useState(initial);
  const [paused, setPaused] = useState(false);
  const ref = useRef(initial);
  useEffect(() => {
    if (!running || paused) return;
    const id = window.setInterval(() => {
      ref.current += 1;
      setSeconds(ref.current);
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, paused]);
  return { seconds, paused, setPaused, ref };
}

function Stepper({ stage }: { stage: SessionStage }) {
  const current = ORDER.indexOf(stage);
  return (
    <ol className="flex flex-wrap gap-2 text-sm" aria-label="Etapy sesji">
      {STEPS.map((s, i) => (
        <li
          key={s.stage}
          aria-current={i === current ? 'step' : undefined}
          className={cx(
            'rounded-full border px-3 py-1',
            i === current
              ? 'border-accent/50 bg-accent/10 text-accent-strong'
              : i < current
                ? 'border-ok/40 text-ok'
                : 'border-line text-subtle',
          )}
        >
          {i < current ? <Check className="mr-1 inline size-3" aria-hidden /> : null}
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function Research({ topic }: { topic: TopicDetail }) {
  const c = topic.core;
  const sources = new Map(topic.sources.map((s) => [s.id, s]));
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h2 className="text-lg">{c.main_question}</h2>
        <p className="max-w-[65ch] font-serif leading-relaxed text-muted">{c.summary}</p>
      </Card>
      <Card className="space-y-2">
        <h3 className="text-base">Pytania badawcze</h3>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          {c.research_questions.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-2">
        <h3 className="text-base">Zapytania do wyszukiwarki</h3>
        <ul className="space-y-1.5 text-sm">
          {c.search_queries.map((q, i) => (
            <li key={i}>
              <SafeLink href={searchUrl(q.query)} className="break-words">
                {q.query}
              </SafeLink>
              <span className="text-subtle"> – {q.purpose}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-2">
        <h3 className="text-base">Źródła do sprawdzenia</h3>
        <ul className="space-y-2 text-sm text-muted">
          {c.suggested_sources.map((s) => {
            const src = sources.get(s.source_id);
            return (
              <li key={s.source_id}>
                <span className="text-fg">{src?.name ?? s.source_id}</span> – {s.what_to_find}
              </li>
            );
          })}
        </ul>
      </Card>
      <Card className="space-y-2">
        <h3 className="text-base">Jak zweryfikować</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          {c.verification_tips.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Quiz({
  session,
  onAnswer,
  busy,
}: {
  session: SessionView;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  return (
    <div className="space-y-4">
      {session.quiz?.map((q, i) => (
        <Card key={q.id} className="space-y-3">
          <h3 className="text-base">
            {i + 1}. {q.prompt}
          </h3>
          {q.result ? (
            <div className="space-y-2 text-sm">
              <p className={q.result.correct ? 'text-ok' : 'text-danger'}>
                {q.result.correct ? 'Dobrze.' : 'Nie tym razem.'} Twoja odpowiedź: {q.result.answer}
              </p>
              {!q.result.correct ? (
                <p className="text-muted">Poprawna odpowiedź: {q.result.correctAnswer}</p>
              ) : null}
              <p className="text-muted">{q.result.explanation}</p>
            </div>
          ) : q.type === 'single_choice' ? (
            <fieldset className="space-y-2">
              <legend className="sr-only">Odpowiedzi</legend>
              {q.options?.map((o, idx) => (
                <label key={idx} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name={q.id}
                    checked={draft[q.id] === String(idx)}
                    onChange={() => setDraft({ ...draft, [q.id]: String(idx) })}
                    className="mt-1"
                  />
                  {o}
                </label>
              ))}
              <Button
                variant="primary"
                disabled={draft[q.id] === undefined}
                busy={busy}
                onClick={() => void onAnswer(q.id, draft[q.id]!)}
              >
                Sprawdź
              </Button>
            </fieldset>
          ) : (
            <div className="space-y-2">
              <input
                aria-label="Twoja odpowiedź"
                className="w-full rounded-lg border border-line-strong bg-bg px-3 py-2.5 text-fg"
                value={draft[q.id] ?? ''}
                onChange={(e) => setDraft({ ...draft, [q.id]: e.target.value })}
              />
              <Button
                variant="primary"
                disabled={!(draft[q.id] ?? '').trim()}
                busy={busy}
                onClick={() => void onAnswer(q.id, draft[q.id]!)}
              >
                Sprawdź
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function RatingRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div role="group" aria-label={label} className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={value === n}
            onClick={() => onChange(n)}
            className={cx(
              'size-10 rounded-lg border text-sm',
              value === n
                ? 'border-accent bg-accent/15 text-accent-strong'
                : 'border-line-strong text-muted hover:border-white/25',
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

const TEXTAREA =
  'w-full rounded-lg border border-line-strong bg-bg px-3 py-2.5 text-fg placeholder:text-subtle';

export function SessionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionView | null>(null);
  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState('');
  const [speaking, setSpeaking] = useState('');
  const [interest, setInterest] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<DifficultyRating | null>(null);
  const [deepen, setDeepen] = useState(false);
  const active = session?.status === 'active';
  const timer = useActiveTimer(session?.activeSeconds ?? 0, active);
  const timerRef = timer.ref;

  const load = useCallback(async () => {
    try {
      const s = await api<SessionView>('GET', `/api/sessions/${id}`);
      timerRef.current = Math.max(timerRef.current, s.activeSeconds);
      setSession(s);
      setTopic(await api<TopicDetail>('GET', `/api/topics/${s.topicId}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id, timerRef]);

  useEffect(() => {
    void load();
  }, [load]);

  // Okresowy zapis czasu, żeby przerwana sesja nie traciła postępu.
  useEffect(() => {
    if (!active) return;
    const h = window.setInterval(() => {
      api('PATCH', `/api/sessions/${id}`, { activeSeconds: timerRef.current }).catch(() => {});
    }, 15_000);
    return () => window.clearInterval(h);
  }, [active, id, timerRef]);

  async function run(fn: () => Promise<SessionView>) {
    setBusy(true);
    try {
      setSession(await fn());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const goTo = (stage: 'check' | 'speaking') =>
    run(() =>
      api<SessionView>('PATCH', `/api/sessions/${id}`, {
        stage,
        activeSeconds: timerRef.current,
      }),
    );

  const finish = (outcome: 'completed' | 'partial') =>
    run(async () => {
      const result = await api<SessionView>('POST', `/api/sessions/${id}/finish`, {
        outcome,
        activeSeconds: timerRef.current,
        ...(interest ? { interest } : {}),
        ...(confidence ? { confidence } : {}),
        ...(difficulty ? { difficulty } : {}),
        ...(summary.trim() ? { summary } : {}),
        ...(speaking.trim() ? { speaking } : {}),
        deepen,
      });
      return result;
    });

  if (!session || !topic) {
    return error ? <Banner tone="danger">{error}</Banner> : <Spinner />;
  }

  if (session.status === 'finished') {
    return (
      <div className="space-y-5">
        <Banner
          tone={session.outcome === 'completed' ? 'ok' : 'info'}
          title={
            session.outcome === 'completed'
              ? session.isDaily
                ? 'Dzień zaliczony. Dobra robota!'
                : 'Temat ukończony.'
              : 'Sesja zapisana – temat czeka w „Niedokończonych”.'
          }
        >
          Aktywny czas nauki: {formatDuration(session.activeSeconds)}.
        </Banner>
        {session.extended ? (
          <Card className="space-y-2">
            <h2 className="text-lg">Najważniejsze wnioski</h2>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              {session.extended.takeaways.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </Card>
        ) : null}
        <div className="flex gap-3">
          <Link to="/" className="text-accent hover:underline">
            Wróć na ekran „Dziś”
          </Link>
          <Link to={`/tematy/${session.topicId}`} className="text-accent hover:underline">
            Karta tematu
          </Link>
        </div>
      </div>
    );
  }

  const ext = session.extended;
  const allAnswered = session.quiz?.every((q) => q.result) ?? false;

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <p className="text-sm text-muted">{session.isDaily ? 'Temat dnia' : 'Sesja nauki'}</p>
        <h1 className="text-2xl leading-snug sm:text-3xl">{session.title}</h1>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Stepper stage={session.stage} />
          <div className="flex items-center gap-2">
            <span
              className="tabular rounded-lg border border-line px-3 py-1.5 text-sm"
              role="timer"
              aria-label="Aktywny czas nauki"
            >
              {formatDuration(timer.seconds)}
            </span>
            <Button
              variant="ghost"
              icon={timer.paused ? Play : Pause}
              onClick={() => timer.setPaused(!timer.paused)}
              aria-label={timer.paused ? 'Wznów timer' : 'Wstrzymaj timer'}
            >
              {timer.paused ? 'Wznów' : 'Pauza'}
            </Button>
          </div>
        </div>
      </header>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      {session.stage === 'research' ? (
        <>
          <Research topic={topic} />
          <Button variant="primary" busy={busy} onClick={() => void goTo('check')}>
            Przejdź do sprawdzenia
          </Button>
        </>
      ) : null}

      {session.stage === 'check' ? (
        <>
          <Quiz
            session={session}
            busy={busy}
            onAnswer={(questionId, answer) =>
              run(() =>
                api<SessionView>('POST', `/api/sessions/${id}/answer`, { questionId, answer }),
              )
            }
          />
          <Button
            variant="primary"
            busy={busy}
            disabled={!allAnswered}
            onClick={() => void goTo('speaking')}
          >
            Przejdź do wypowiedzi
          </Button>
          {!allAnswered ? (
            <p className="text-sm text-subtle">
              Odpowiedz na wszystkie pytania, aby przejść dalej.
            </p>
          ) : null}
        </>
      ) : null}

      {session.stage === 'speaking' && session.speaking && ext ? (
        <>
          <Card className="space-y-3">
            <h2 className="text-lg">Zadanie: wypowiedz się</h2>
            <p className="font-serif leading-relaxed text-muted">{session.speaking.prompt}</p>
            <p className="text-sm text-subtle">
              Sugerowany czas: {Math.round(session.speaking.durationSeconds / 60)} min. Możesz mówić
              na głos, a tu zapisać główne myśli.
            </p>
            <label className="block text-sm font-medium" htmlFor="speaking">
              Moja wypowiedź (opcjonalnie)
            </label>
            <textarea
              id="speaking"
              rows={4}
              className={TEXTAREA}
              value={speaking}
              onChange={(e) => setSpeaking(e.target.value)}
            />
          </Card>
          <Card className="space-y-3">
            <h2 className="text-lg">Podsumowanie tematu</h2>
            <p className="max-w-[65ch] font-serif leading-relaxed text-muted">{ext.brief}</p>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              {ext.takeaways.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
            <details className="text-sm text-muted">
              <summary className="cursor-pointer text-fg">Pojęcia, mity i granice wiedzy</summary>
              <div className="mt-3 space-y-3">
                <ul className="space-y-1">
                  {ext.keyConcepts.map((k) => (
                    <li key={k.term}>
                      <span className="text-fg">{k.term}</span> – {k.definition}
                    </li>
                  ))}
                </ul>
                <ul className="space-y-1">
                  {ext.misconceptions.map((m, i) => (
                    <li key={i}>
                      <span className="text-fg">Mit:</span> {m.claim} <br />
                      <span className="text-fg">Fakt:</span> {m.correction}
                    </li>
                  ))}
                </ul>
                <p>{ext.knowledgeLimits}</p>
                <p className="text-fg">Pytania na dalej:</p>
                <ul className="list-disc pl-5">
                  {ext.deeperQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            </details>
          </Card>
          <Card className="space-y-4">
            <h2 className="text-lg">Jak poszło?</h2>
            <RatingRow
              label="Jak interesujący był temat? (1–5)"
              value={interest}
              onChange={setInterest}
            />
            <RatingRow
              label="Jak pewnie czujesz się w temacie? (1–5)"
              value={confidence}
              onChange={setConfidence}
            />
            <div role="group" aria-label="Trudność" className="space-y-1.5">
              <p className="text-sm font-medium">Trudność</p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['too_easy', 'Za łatwy'],
                    ['right', 'W sam raz'],
                    ['too_hard', 'Za trudny'],
                  ] as const
                ).map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={difficulty === v}
                    onClick={() => setDifficulty(v)}
                    className={cx(
                      'rounded-lg border px-3 py-2 text-sm',
                      difficulty === v
                        ? 'border-accent bg-accent/15 text-accent-strong'
                        : 'border-line-strong text-muted hover:border-white/25',
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="summary">
                Moje podsumowanie (opcjonalnie)
              </label>
              <textarea
                id="summary"
                rows={3}
                className={TEXTAREA}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Własnymi słowami: co zapamiętam z tego tematu?"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={deepen}
                onChange={(e) => setDeepen(e.target.checked)}
              />
              Chcę pogłębić ten temat później
            </label>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" busy={busy} onClick={() => void finish('completed')}>
                Zakończ i zalicz temat
              </Button>
              <Button busy={busy} onClick={() => void finish('partial')}>
                Dokończę później
              </Button>
            </div>
          </Card>
        </>
      ) : null}

      {session.stage !== 'speaking' ? (
        <div className="border-t border-line pt-4">
          <Button
            variant="ghost"
            busy={busy}
            onClick={() => {
              void finish('partial').then(() => navigate('/niedokonczone'));
            }}
          >
            Przerwij i wróć później
          </Button>
        </div>
      ) : null}
    </div>
  );
}
