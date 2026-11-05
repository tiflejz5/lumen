import { ChevronRight, FileArchive, FolderOpen, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  ImportListItem,
  ImportPreview,
  ImportReport,
  PreviewAction,
  PreviewTopic,
} from '@lumen/core';
import { Pill } from '../components/bits';
import { Banner, Button, Card, PageHeader, Spinner, buttonClasses, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { readPicked } from '../lib/files';
import { useLabels } from '../lib/taxonomy';

type Tone = 'neutral' | 'accent' | 'warn' | 'danger' | 'ok';

const ACTION: Record<PreviewAction, { label: string; tone: Tone; help: string }> = {
  new: { label: 'Nowy', tone: 'ok', help: 'Tematu nie ma jeszcze w bazie.' },
  update: { label: 'Aktualizacja', tone: 'accent', help: 'Wyższa rewizja niż zapisana w bazie.' },
  conflict: {
    label: 'Konflikt wersji',
    tone: 'warn',
    help: 'Ta sama rewizja, ale inna treść. Autor powinien był podnieść numer rewizji.',
  },
  refresh: {
    label: 'Odświeżenie',
    tone: 'accent',
    help: 'Ta sama treść, nowsza data weryfikacji.',
  },
  invalid: {
    label: 'Nieprawidłowy',
    tone: 'danger',
    help: 'Rekord nie przeszedł walidacji i zostanie odrzucony.',
  },
  unchanged: { label: 'Bez zmian', tone: 'neutral', help: 'Identyczny z zapisanym w bazie.' },
  older: {
    label: 'Starsza rewizja',
    tone: 'neutral',
    help: 'W bazie jest nowsza rewizja – pomijany.',
  },
  example_skipped: {
    label: 'Przykładowy',
    tone: 'neutral',
    help: 'Temat przykładowy nie zastępuje prawdziwego.',
  },
};

const ORDER: PreviewAction[] = [
  'invalid',
  'conflict',
  'update',
  'refresh',
  'new',
  'example_skipped',
  'older',
  'unchanged',
];

const SECTION_LABEL: Record<string, string> = {
  'core.title': 'tytuł',
  'core.summary': 'opis',
  'core.why_it_matters': 'kontekst',
  'core.main_question': 'pytanie główne',
  'core.research_questions': 'pytania badawcze',
  'core.keywords': 'słowa kluczowe',
  'core.search_queries': 'zapytania',
  'core.suggested_sources': 'źródła',
  'core.verification_tips': 'wskazówki weryfikacji',
  'core.final_task': 'zadanie końcowe',
  'core.difficulty': 'trudność',
  'extended.claims': 'twierdzenia',
  'extended.brief': 'opracowanie',
  quiz: 'quiz',
  relations: 'relacje',
  status: 'status',
  revision: 'rewizja',
  changelog: 'historia zmian',
};
const sectionLabel = (s: string) => SECTION_LABEL[s] ?? s;

function Row({
  t,
  checked,
  onToggle,
}: {
  t: PreviewTopic;
  checked: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = ACTION[t.action];
  const labels = useLabels();
  const details =
    t.errors.length + t.warnings.length + t.changedSections.length > 0 || !!t.changeNote;
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={!t.selectable}
          onChange={onToggle}
          aria-label={`Importuj ${t.id}`}
          className="mt-1 size-4 shrink-0 accent-[var(--color-accent)] disabled:opacity-30"
        />
        <div className="min-w-0 flex-1">
          <p className="leading-snug">{t.title}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs text-subtle">{t.id}</span>
            <Pill tone={meta.tone} title={meta.help}>
              {meta.label}
            </Pill>
            {t.level ? <Pill>{labels.enumLabel('difficulty', t.level)}</Pill> : null}
            {t.localRevision !== null && t.revision > 0 ? (
              <Pill>
                rew. {t.localRevision} → {t.revision}
              </Pill>
            ) : t.revision > 0 ? (
              <Pill>rew. {t.revision}</Pill>
            ) : null}
            {t.replacesExample ? <Pill tone="accent">zastępuje przykładowy</Pill> : null}
            {t.becomesDeprecated ? <Pill tone="warn">zostanie wycofany</Pill> : null}
            {t.isExample ? <Pill>przykładowy</Pill> : null}
            {t.warnings.length > 0 ? <Pill tone="warn">{t.warnings.length} uwag</Pill> : null}
          </p>
        </div>
        {details ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`Szczegóły ${t.id}`}
            className="mt-0.5 rounded p-1 text-muted hover:text-fg"
          >
            <ChevronRight
              className={cx('size-4 transition-transform', open && 'rotate-90')}
              aria-hidden
            />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="ml-7 mt-3 space-y-3 text-sm">
          {t.errors.length > 0 ? (
            <div>
              <p className="font-medium text-danger">Błędy</p>
              <ul className="ml-4 list-disc text-muted">
                {t.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {t.changedSections.length > 0 ? (
            <p className="text-muted">
              <span className="font-medium text-fg">Zmienione: </span>
              {t.changedSections.map(sectionLabel).join(', ')}
            </p>
          ) : null}
          {t.changeNote ? (
            <p className="text-muted">
              <span className="font-medium text-fg">Opis zmiany: </span>
              {t.changeNote}
            </p>
          ) : null}
          {t.warnings.length > 0 ? (
            <div>
              <p className="font-medium text-warn">Uwagi</p>
              <ul className="ml-4 list-disc text-muted">
                {t.warnings.slice(0, 5).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {t.warnings.length > 5 ? <li>… oraz {t.warnings.length - 5} kolejnych</li> : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function ReportView({ report }: { report: ImportReport }) {
  const s = report.summary;
  const rows: [string, number][] = [
    ['Zaimportowane', s.imported],
    ['– w tym nowe', s.inserted],
    ['– w tym zaktualizowane', s.updated],
    ['– w tym odświeżone', s.refreshed],
    ['Niezaznaczone (zmiany do późniejszej decyzji)', s.notSelected],
    ['Odrzucone jako nieprawidłowe', s.rejected],
    ['Bez zmian', s.unchanged],
    ['Zapisane źródła', s.sourcesWritten],
    ['Zapisane tytuły katalogu', s.catalogWritten],
  ];
  const notable = report.items.filter((i) => i.decision === 'rejected' || i.note);
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm sm:max-w-md">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className={k.startsWith('–') ? 'pl-3 text-subtle' : 'text-muted'}>{k}</dt>
            <dd className="tabular text-right">{v}</dd>
          </div>
        ))}
      </dl>
      {report.snapshot ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <ShieldCheck className="size-4 text-ok" aria-hidden />
          Przed importem wykonano kopię zapasową:{' '}
          <span className="font-mono text-xs">{report.snapshot}</span>
        </p>
      ) : null}
      {report.warnings.length > 0 ? (
        <Banner tone="warn" title="Uwagi">
          <ul className="list-disc pl-4">
            {report.warnings.slice(0, 8).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
      {notable.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-medium">Do uwagi</h3>
          <ul className="divide-y divide-line rounded-lg border border-line text-sm">
            {notable.map((i) => (
              <li key={i.id} className="px-3 py-2">
                <span className="font-mono text-xs text-subtle">{i.id}</span> {i.title}
                <span className="block text-muted">
                  {i.decision === 'rejected' ? `Odrzucony: ${i.note ?? ''}` : i.note}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ImportWizard() {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<PreviewAction | 'all'>('all');
  const [includeExamples, setIncludeExamples] = useState(false);
  const [busy, setBusy] = useState<'reading' | 'applying' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '');
    folderRef.current?.setAttribute('directory', '');
  }, []);

  async function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy('reading');
    setError(null);
    setPreview(null);
    try {
      const picked = await readPicked([...list]);
      if (picked.error) throw new Error(picked.error);
      if (picked.files.length === 0)
        throw new Error('W wybranych plikach nie ma żadnych plików JSON.');
      const p = await api<ImportPreview>('POST', '/api/import/preview', {
        files: picked.files,
        includeExamples,
      });
      setPreview(p);
      setSelected(new Set(p.topics.filter((t) => t.defaultSelected).map((t) => t.id)));
      setFilter('all');
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : errorMessage(e));
    } finally {
      setBusy(null);
      if (folderRef.current) folderRef.current.value = '';
      if (filesRef.current) filesRef.current.value = '';
    }
  }

  async function apply() {
    if (!preview) return;
    setBusy('applying');
    setError(null);
    try {
      setReport(
        await api<ImportReport>('POST', '/api/import/apply', {
          token: preview.token,
          topicIds: [...selected],
        }),
      );
      setPreview(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (preview) await api('POST', '/api/import/cancel', { token: preview.token }).catch(() => {});
    setPreview(null);
  }

  const sorted = useMemo(
    () =>
      preview
        ? [...preview.topics].sort(
            (a, b) => ORDER.indexOf(a.action) - ORDER.indexOf(b.action) || a.id.localeCompare(b.id),
          )
        : [],
    [preview],
  );
  const visible = filter === 'all' ? sorted : sorted.filter((t) => t.action === filter);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const selectWhere = (pred: (t: PreviewTopic) => boolean) =>
    setSelected(new Set(sorted.filter((t) => t.selectable && pred(t)).map((t) => t.id)));
  // Czy jest cokolwiek do zapisania: zaznaczone tematy albo nowe/zmienione źródła, katalog lub taksonomia.
  const releaseDataChanges =
    !!preview &&
    ((preview.sources ? preview.sources.added + preview.sources.changed > 0 : false) ||
      (preview.catalog ? preview.catalog.added > 0 : false) ||
      preview.taxonomyChanged === true);
  const hasWork = selected.size > 0 || releaseDataChanges;
  const nothingToDo =
    !!preview &&
    !preview.blocked &&
    !preview.topics.some((t) => t.selectable) &&
    !releaseDataChanges;

  if (report) {
    return (
      <>
        <PageHeader
          title="Import zakończony"
          subtitle="Raport został zapisany w historii importów."
        />
        <Card className="space-y-5">
          <ReportView report={report} />
          <div className="flex flex-wrap gap-2">
            <Link to="/tematy" className={buttonClasses('primary')}>
              Przejdź do bazy tematów
            </Link>
            <Link to="/" className={buttonClasses('secondary')}>
              Zobacz temat dnia
            </Link>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Import tematów"
        subtitle="Wczytaj wydanie bazy, sprawdź podgląd i zatwierdź zmiany. Nic nie zostanie zapisane bez Twojej zgody."
      />
      {error ? (
        <div className="mb-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      ) : null}

      {!preview ? (
        <Card className="space-y-5">
          <p className="text-muted">
            Możesz wybrać cały folder wydania (z plikiem{' '}
            <span className="font-mono text-sm">manifest.json</span>), archiwum ZIP albo pojedyncze
            pliki paczek. Sprawdzimy sumy kontrolne, zgodność ze schematem i wszystkie reguły
            jakości. Przed zapisem powstanie kopia zapasowa.
          </p>
          <div className="flex flex-wrap gap-3">
            <input
              ref={folderRef}
              type="file"
              multiple
              hidden
              onChange={(e) => onPick(e.target.files)}
              aria-label="Wybierz folder wydania"
              id="pick-folder"
            />
            <input
              ref={filesRef}
              type="file"
              multiple
              hidden
              accept=".json,.zip,application/json,application/zip"
              onChange={(e) => onPick(e.target.files)}
              aria-label="Wybierz pliki lub archiwum ZIP"
              id="pick-files"
            />
            <Button
              variant="primary"
              icon={FolderOpen}
              busy={busy === 'reading'}
              onClick={() => folderRef.current?.click()}
            >
              Wybierz folder wydania
            </Button>
            <Button
              icon={FileArchive}
              disabled={busy === 'reading'}
              onClick={() => filesRef.current?.click()}
            >
              Wybierz ZIP lub pliki
            </Button>
          </div>
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={includeExamples}
              onChange={(e) => setIncludeExamples(e.target.checked)}
              className="mt-1 size-4 accent-[var(--color-accent)]"
            />
            <span>
              Importuj także paczki przykładowe (do wypróbowania aplikacji)
              <span className="block text-subtle">
                Takie tematy są oznaczone, ukryte w statystykach i losowane dopiero po włączeniu
                trybu demonstracyjnego w Ustawieniach.
              </span>
            </span>
          </label>
          {busy === 'reading' ? <Spinner label="Wczytywanie i sprawdzanie plików…" /> : null}
        </Card>
      ) : (
        <div className="space-y-5">
          {preview.fatal.length > 0 ? (
            <Banner tone="danger" title="Import jest zablokowany">
              <ul className="list-disc pl-4">
                {preview.fatal.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </Banner>
          ) : null}
          {preview.notes.length > 0 || preview.warnings.length > 0 ? (
            <Banner tone="info">
              <ul className="list-disc pl-4">
                {[...preview.notes, ...preview.warnings].map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </Banner>
          ) : null}
          {preview.missingLocal.length > 0 ? (
            <Banner
              tone="warn"
              title={`W bazie jest ${preview.missingLocal.length} tematów, których nie ma w tym wydaniu`}
            >
              Nie zostaną usunięte (tematów się nie usuwa, tylko wycofuje).
            </Banner>
          ) : null}
          {preview.packs.some((p) => p.errors.length > 0) ? (
            <Banner tone="warn" title="Problemy z paczkami">
              <ul className="list-disc pl-4">
                {preview.packs
                  .filter((p) => p.errors.length > 0)
                  .map((p) => (
                    <li key={p.file}>
                      {p.file}: {p.errors.join('; ')}
                    </li>
                  ))}
              </ul>
            </Banner>
          ) : null}

          {!preview.blocked ? (
            <Card className="space-y-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg">
                  Podgląd wydania{' '}
                  {preview.baseVersion ? (
                    <span className="tabular text-muted">{preview.baseVersion}</span>
                  ) : null}
                </h2>
                <span className="text-sm text-muted">
                  schemat {preview.schemaVersion ?? '–'} · taksonomia{' '}
                  {preview.taxonomyVersion ?? '–'}
                </span>
              </div>
              <div
                className="flex flex-wrap gap-2 text-sm"
                role="group"
                aria-label="Filtr rodzaju zmian"
              >
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  aria-pressed={filter === 'all'}
                  className={cx(
                    'rounded-full border px-3 py-1',
                    filter === 'all'
                      ? 'border-accent text-accent'
                      : 'border-line-strong text-muted hover:text-fg',
                  )}
                >
                  Wszystkie <span className="tabular">{preview.topics.length}</span>
                </button>
                {ORDER.filter((a) => preview.counts[a] > 0).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setFilter(a)}
                    aria-pressed={filter === a}
                    className={cx(
                      'rounded-full border px-3 py-1',
                      filter === a
                        ? 'border-accent text-accent'
                        : 'border-line-strong text-muted hover:text-fg',
                    )}
                  >
                    {ACTION[a].label} <span className="tabular">{preview.counts[a]}</span>
                  </button>
                ))}
              </div>
              <p className="text-sm text-muted">
                {preview.sources
                  ? `Źródła: ${preview.sources.total} (nowe ${preview.sources.added}, zmienione ${preview.sources.changed}). `
                  : ''}
                {preview.catalog
                  ? `Katalog tytułów: ${preview.catalog.total} (nowe ${preview.catalog.added}). `
                  : ''}
                {preview.taxonomyChanged ? 'Taksonomia zostanie zaktualizowana. ' : ''}
                Nowe tematy są zaznaczone domyślnie; zmiany istniejących wymagają Twojego
                zaznaczenia.
              </p>
              <div className="flex flex-wrap gap-2 text-sm">
                <Button variant="ghost" onClick={() => selectWhere((t) => t.action === 'new')}>
                  Tylko nowe
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => selectWhere((t) => t.action === 'new' || t.action === 'update')}
                >
                  Nowe i aktualizacje
                </Button>
                <Button variant="ghost" onClick={() => selectWhere((t) => t.action === 'refresh')}>
                  Odświeżenia
                </Button>
                <Button variant="ghost" onClick={() => setSelected(new Set())}>
                  Odznacz wszystko
                </Button>
              </div>
              <ul
                className="max-h-[32rem] divide-y divide-line overflow-auto rounded-lg border border-line"
                aria-label="Tematy do zaimportowania"
              >
                {visible.map((t) => (
                  <Row
                    key={`${t.packId}-${t.id}`}
                    t={t}
                    checked={selected.has(t.id)}
                    onToggle={() => toggle(t.id)}
                  />
                ))}
              </ul>
            </Card>
          ) : null}

          {nothingToDo ? (
            <Banner tone="info">
              Nie ma niczego nowego do zaimportowania – baza jest już aktualna.
            </Banner>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" onClick={cancel}>
              Anuluj
            </Button>
            {!preview.blocked ? (
              <Button
                variant="primary"
                onClick={apply}
                busy={busy === 'applying'}
                disabled={!hasWork}
              >
                Zaimportuj zaznaczone ({selected.size})
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}

export function ImportHistory() {
  const [items, setItems] = useState<ImportListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ imports: ImportListItem[] }>('GET', '/api/imports').then(
      (r) => setItems(r.imports),
      (e) => setError(errorMessage(e)),
    );
  }, []);
  return (
    <>
      <PageHeader
        title="Historia importów"
        actions={
          <Link to="/tematy" className={buttonClasses('secondary')}>
            Wróć do bazy tematów
          </Link>
        }
      />
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-muted">Nie wykonano jeszcze żadnego importu.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {items.map((i) => (
            <li key={i.id}>
              <Link
                to={`/tematy/importy/${i.id}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-white/5"
              >
                <span>
                  <span className="tabular block">
                    {new Date(i.createdAt).toLocaleString('pl-PL')}
                  </span>
                  <span className="text-sm text-muted">
                    {i.mode === 'release' ? 'Wydanie' : 'Pojedyncze pliki'}
                    {i.baseVersion ? ` ${i.baseVersion}` : ''}
                  </span>
                </span>
                <span className="text-sm text-muted">
                  zaimportowano <span className="tabular text-fg">{i.summary.imported}</span>,
                  odrzucono <span className="tabular text-fg">{i.summary.rejected}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function ImportReportPage() {
  const { id } = useParams();
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<ImportReport>('GET', `/api/imports/${id}`).then(setReport, (e) =>
      setError(errorMessage(e)),
    );
  }, [id]);
  return (
    <>
      <PageHeader
        title="Raport importu"
        subtitle={report ? new Date(report.createdAt).toLocaleString('pl-PL') : undefined}
        actions={
          <Link to="/tematy/importy" className={buttonClasses('secondary')}>
            Wróć do historii
          </Link>
        }
      />
      {error ? (
        <Banner tone="danger">{error}</Banner>
      ) : !report ? (
        <Spinner />
      ) : (
        <Card>
          <ReportView report={report} />
        </Card>
      )}
    </>
  );
}
