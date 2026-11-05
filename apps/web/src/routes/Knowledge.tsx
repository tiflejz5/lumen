import { ArrowLeft, Library, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  DEFINITION_MAX,
  TERM_MAX,
  splitLinks,
  type KnowledgeDetail,
  type KnowledgeEntry,
  type NoteView,
} from '@lumen/core';
import { Pill } from '../components/bits';
import { Banner, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';

const INPUT =
  'w-full rounded-lg border border-line-strong bg-bg px-3 py-2.5 text-fg placeholder:text-subtle';

/** Definicja z powiązaniami [[termin]]: istniejące pojęcia są linkami, brakujące – wyróżnione. */
function LinkedText({ text, resolved }: { text: string; resolved: Record<string, string | null> }) {
  return (
    <p className="max-w-[65ch] whitespace-pre-wrap font-serif text-lg leading-relaxed">
      {splitLinks(text).map((seg, i) => {
        if (seg.kind === 'text') return <span key={i}>{seg.text}</span>;
        const id = resolved[seg.text];
        return id ? (
          <Link key={i} to={`/baza-wiedzy/${id}`} className="text-accent hover:underline">
            {seg.text}
          </Link>
        ) : (
          <span
            key={i}
            className="border-b border-dashed border-warn text-warn"
            title="Takiego pojęcia jeszcze nie ma w bazie wiedzy"
          >
            {seg.text}
          </span>
        );
      })}
    </p>
  );
}

function EntryForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: { term: string; definition: string };
  submitLabel: string;
  onSubmit: (v: { term: string; definition: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [term, setTerm] = useState(initial?.term ?? '');
  const [definition, setDefinition] = useState(initial?.definition ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit({ term, definition });
      if (!initial) {
        setTerm('');
        setDefinition('');
      }
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <div>
        <label htmlFor="term" className="mb-1.5 block text-sm font-medium">
          Pojęcie
        </label>
        <input
          id="term"
          className={INPUT}
          value={term}
          maxLength={TERM_MAX}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="definition" className="mb-1.5 block text-sm font-medium">
          Definicja własnymi słowami
        </label>
        <textarea
          id="definition"
          rows={4}
          className={INPUT}
          value={definition}
          maxLength={DEFINITION_MAX}
          onChange={(e) => setDefinition(e.target.value)}
        />
        <p className="mt-1 text-sm text-subtle">
          Powiąż pojęcia, wpisując nazwę w podwójnych nawiasach, np. [[Inflacja]].
        </p>
      </div>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={!term.trim() || !definition.trim()}
        >
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Anuluj
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function KnowledgePage() {
  const [entries, setEntries] = useState<KnowledgeEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    try {
      const r = await api<{ entries: KnowledgeEntry[] }>(
        'GET',
        `/api/knowledge?q=${encodeURIComponent(q)}`,
      );
      setEntries(r.entries);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    const h = window.setTimeout(() => void load(query), 200);
    return () => window.clearTimeout(h);
  }, [query, load]);

  async function create(v: { term: string; definition: string }) {
    await api('POST', '/api/knowledge', v);
    setAdding(false);
    await load(query);
  }

  return (
    <>
      <PageHeader
        title="Baza wiedzy"
        subtitle="Twoja osobista mini-encyklopedia: pojęcia własnymi słowami i powiązania między nimi."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setAdding((v) => !v)}>
            Nowe pojęcie
          </Button>
        }
      />
      {adding ? (
        <Card className="mb-5">
          <EntryForm
            submitLabel="Dodaj pojęcie"
            onSubmit={create}
            onCancel={() => setAdding(false)}
          />
        </Card>
      ) : null}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-3 size-4 text-subtle" aria-hidden />
        <input
          type="search"
          aria-label="Szukaj w bazie wiedzy"
          placeholder="Szukaj pojęcia lub w definicjach…"
          className={`${INPUT} pl-9`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {!entries && !error ? <Spinner /> : null}
      {entries && entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={Library}
            title={query ? 'Nic nie znaleziono' : 'Baza wiedzy jest pusta'}
          >
            {query
              ? 'Spróbuj innych słów.'
              : 'Dodaj pierwsze pojęcie albo zapisz je z sesji nauki – w kroku „Wypowiedź” przy pojęciach z tematu jest przycisk „Zapisz do bazy wiedzy”.'}
          </EmptyState>
        </Card>
      ) : null}
      {entries && entries.length > 0 ? (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {entries.map((e) => (
            <li key={e.id}>
              <Link to={`/baza-wiedzy/${e.id}`} className="block px-4 py-3 hover:bg-white/5">
                <span className="text-fg">{e.term}</span>
                <span className="mt-0.5 line-clamp-1 block text-sm text-muted">{e.definition}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function KnowledgeEntryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [entry, setEntry] = useState<KnowledgeDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntry(await api<KnowledgeDetail>('GET', `/api/knowledge/${id}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);
  useEffect(() => {
    setEntry(null);
    setEditing(false);
    void load();
  }, [load]);

  async function remove() {
    if (!window.confirm('Usunąć to pojęcie z bazy wiedzy?')) return;
    try {
      await api('DELETE', `/api/knowledge/${id}`);
      navigate('/baza-wiedzy');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const back = (
    <Link
      to="/baza-wiedzy"
      className="inline-flex items-center gap-2 text-sm text-muted hover:text-fg"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Baza wiedzy
    </Link>
  );
  if (!entry)
    return (
      <div className="space-y-4">
        {back}
        {error ? <Banner tone="danger">{error}</Banner> : <Spinner />}
      </div>
    );

  return (
    <article className="space-y-5">
      {back}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {editing ? (
        <Card>
          <EntryForm
            initial={{ term: entry.term, definition: entry.definition }}
            submitLabel="Zapisz zmiany"
            onSubmit={async (v) => {
              await api('PUT', `/api/knowledge/${id}`, v);
              setEditing(false);
              await load();
            }}
            onCancel={() => setEditing(false)}
          />
        </Card>
      ) : (
        <>
          <header className="space-y-2">
            <h1 className="text-2xl sm:text-3xl">{entry.term}</h1>
            {entry.topicId ? (
              <p className="text-sm text-muted">
                Z tematu:{' '}
                <Link to={`/tematy/${entry.topicId}`} className="text-accent hover:underline">
                  {entry.topicTitle}
                </Link>
              </p>
            ) : null}
          </header>
          <Card>
            <LinkedText text={entry.definition} resolved={entry.resolved} />
          </Card>
          {entry.backlinks.length > 0 ? (
            <section aria-labelledby="backlinks" className="space-y-2">
              <h2 id="backlinks" className="text-base">
                Odwołują się do tego pojęcia
              </h2>
              <div className="flex flex-wrap gap-2">
                {entry.backlinks.map((b) => (
                  <Link key={b.id} to={`/baza-wiedzy/${b.id}`}>
                    <Pill tone="accent">{b.term}</Pill>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          <div className="flex gap-2">
            <Button onClick={() => setEditing(true)}>Edytuj</Button>
            <Button variant="ghost" icon={Trash2} onClick={() => void remove()}>
              Usuń
            </Button>
          </div>
        </>
      )}
    </article>
  );
}

/** Notatki przypisane do tematu, z możliwością dodania nowej – używane na karcie tematu. */
export function TopicNotes({ topicId }: { topicId: string }) {
  const [notes, setNotes] = useState<NoteView[] | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setNotes((await api<{ notes: NoteView[] }>('GET', `/api/notes?topicId=${topicId}`)).notes);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [topicId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('POST', '/api/notes', { topicId, body });
      setBody('');
      setError(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <h2 className="text-lg">Moje notatki</h2>
      {notes?.length ? (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-line bg-bg p-3 text-sm">
              <p className="whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={(e) => void add(e)} className="space-y-2">
        <label htmlFor="new-note" className="block text-sm font-medium">
          Dodaj notatkę do tego tematu
        </label>
        <textarea
          id="new-note"
          rows={3}
          className={INPUT}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Button type="submit" busy={busy} disabled={!body.trim()}>
          Zapisz notatkę
        </Button>
      </form>
    </Card>
  );
}
