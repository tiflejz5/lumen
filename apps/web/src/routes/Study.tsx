import {
  BookOpenCheck,
  CircleDashed,
  History as HistoryIcon,
  NotebookPen,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { NoteView, SessionListItem, SessionView, TopicListItem } from '@lumen/core';
import { Pill } from '../components/bits';
import { Banner, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useLabels } from '../lib/taxonomy';
import { formatDuration } from './Session';

/** Rozpoczyna (albo wznawia) sesję tematu i przechodzi do jej ekranu. */
export function useStartSession() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useCallback(
    async (topicId: string) => {
      setBusy(true);
      try {
        const s = await api<SessionView>('POST', '/api/sessions', { topicId });
        navigate(`/sesja/${s.id}`);
      } catch (e) {
        setError(errorMessage(e));
        setBusy(false);
      }
    },
    [navigate],
  );
  return { start, busy, error };
}

const dateFmt = new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const fmtDate = (iso: string) => dateFmt.format(new Date(iso.length === 10 ? `${iso}T12:00` : iso));

export function HistoryPage() {
  const labels = useLabels();
  const [items, setItems] = useState<SessionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ sessions: SessionListItem[] }>('GET', '/api/sessions?status=finished')
      .then((r) => setItems(r.sessions))
      .catch((e) => setError(errorMessage(e)));
  }, []);
  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!items) return <Spinner />;
  return (
    <>
      <PageHeader title="Historia" subtitle="Twoje zakończone sesje nauki." />
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={HistoryIcon} title="Nie ma jeszcze żadnych sesji">
            Gdy zakończysz pierwszą sesję, pojawi się tutaj.
          </EmptyState>
        </Card>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <Link to={`/tematy/${s.topicId}`} className="text-fg hover:underline">
                  {s.title}
                </Link>
                <p className="text-sm text-muted">
                  {fmtDate(s.date)} · {labels.category(s.category)} ·{' '}
                  {formatDuration(s.activeSeconds)}
                </p>
              </div>
              <div className="flex gap-2">
                {s.isDaily ? <Pill tone="accent">Temat dnia</Pill> : null}
                <Pill tone={s.outcome === 'completed' ? 'ok' : 'neutral'}>
                  {s.outcome === 'completed' ? 'Ukończony' : 'Częściowo'}
                </Pill>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function UnfinishedPage() {
  const { start, busy, error: startError } = useStartSession();
  const [topics, setTopics] = useState<TopicListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ items: TopicListItem[] }>('GET', '/api/topics?userStatus=in_progress&limit=200')
      .then((r) => setTopics(r.items))
      .catch((e) => setError(errorMessage(e)));
  }, []);
  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!topics) return <Spinner />;
  return (
    <>
      <PageHeader
        title="Niedokończone"
        subtitle="Tematy, do których warto wrócić – bez presji nadrabiania."
      />
      {startError ? <Banner tone="danger">{startError}</Banner> : null}
      {topics.length === 0 ? (
        <Card>
          <EmptyState icon={CircleDashed} title="Nic nie czeka na dokończenie">
            Tematy, które zaczniesz, ale nie skończysz, pojawią się tutaj.
          </EmptyState>
        </Card>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {topics.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <Link to={`/tematy/${t.id}`} className="text-fg hover:underline">
                {t.title}
              </Link>
              <Button variant="primary" busy={busy} onClick={() => void start(t.id)}>
                Wróć do tematu
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const KIND_LABEL: Record<NoteView['kind'], string> = {
  note: 'Notatka',
  summary: 'Podsumowanie',
  speaking: 'Wypowiedź',
  question: 'Pytanie',
};

export function NotesPage() {
  const [notes, setNotes] = useState<NoteView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);

  const load = useCallback(() => {
    api<{ notes: NoteView[] }>('GET', '/api/notes')
      .then((r) => setNotes(r.notes))
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  async function save() {
    if (!editing) return;
    try {
      await api('PUT', `/api/notes/${editing.id}`, { body: editing.body });
      setEditing(null);
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function remove(id: string) {
    if (!window.confirm('Usunąć tę notatkę?')) return;
    try {
      await api('DELETE', `/api/notes/${id}`);
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!notes) return error ? <Banner tone="danger">{error}</Banner> : <Spinner />;
  return (
    <>
      <PageHeader title="Notatki" subtitle="Własne wnioski, pytania i podsumowania sesji." />
      {error ? (
        <div className="mb-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      ) : null}
      {notes.length === 0 ? (
        <Card>
          <EmptyState icon={NotebookPen} title="Brak notatek">
            Podsumowania i wypowiedzi z sesji oraz notatki dodane przy tematach zbierają się tutaj.
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id}>
              <Card className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
                  <span>
                    <Link to={`/tematy/${n.topicId}`} className="text-accent hover:underline">
                      {n.topicTitle}
                    </Link>{' '}
                    · {fmtDate(n.createdAt)}
                  </span>
                  <Pill>{KIND_LABEL[n.kind]}</Pill>
                </div>
                {editing?.id === n.id ? (
                  <div className="space-y-2">
                    <textarea
                      aria-label="Treść notatki"
                      rows={4}
                      className="w-full rounded-lg border border-line-strong bg-bg px-3 py-2.5 text-fg"
                      value={editing.body}
                      onChange={(e) => setEditing({ id: n.id, body: e.target.value })}
                    />
                    <div className="flex gap-2">
                      <Button variant="primary" onClick={() => void save()}>
                        Zapisz
                      </Button>
                      <Button variant="ghost" onClick={() => setEditing(null)}>
                        Anuluj
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap font-serif leading-relaxed">{n.body}</p>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => setEditing({ id: n.id, body: n.body })}
                      >
                        Edytuj
                      </Button>
                      <Button variant="ghost" icon={Trash2} onClick={() => void remove(n.id)}>
                        Usuń
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Przycisk „Rozpocznij sesję” używany na ekranie głównym i karcie tematu. */
export function StartSessionButton({
  topicId,
  label = 'Rozpocznij sesję',
}: {
  topicId: string;
  label?: string;
}) {
  const { start, busy, error } = useStartSession();
  return (
    <>
      <Button
        variant="primary"
        icon={BookOpenCheck}
        busy={busy}
        onClick={() => void start(topicId)}
      >
        {label}
      </Button>
      {error ? <span className="text-sm text-danger">{error}</span> : null}
    </>
  );
}
