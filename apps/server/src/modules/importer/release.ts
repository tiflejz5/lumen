import { createHash } from 'node:crypto';
import {
  SCHEMA_MAJOR,
  checkCross,
  checkTopic,
  topicContentPayload,
  type Issue,
  type Taxonomy,
  type TopicRecord,
} from '@lumen/core';
import { toTaxonomy } from '../topics/repo.ts';
import { describeErrors, getValidators, type ErrorObject } from './schemas.ts';

export type UploadedFile = { path: string; bytes: Buffer };

export type ParsedTopic = {
  /** ID z pliku albo „#N” (pozycja w paczce), gdy rekord nie ma poprawnego ID */
  id: string;
  packFile: string;
  packId: string;
  isExample: boolean;
  record: TopicRecord | null;
  raw: unknown;
  contentHash: string;
  errors: string[];
  warnings: string[];
};

export type ParsedPack = {
  file: string;
  packId: string;
  isExample: boolean;
  skipped: boolean;
  topicCount: number;
  errors: string[];
};

export type CatalogEntry = {
  id: string;
  title: string;
  category: string;
  subcategory: string;
  difficulty: string;
  topic_type: string;
  current_subtype?: string;
  question_type?: string;
  mainstream?: boolean;
  region?: string;
};

export type ParsedRelease = {
  mode: 'release' | 'single';
  /** błędy blokujące cały import */
  fatal: string[];
  notes: string[];
  warnings: string[];
  baseVersion: string | null;
  schemaVersion: string | null;
  taxonomyVersion: string | null;
  taxonomyRaw: unknown;
  sources: { id: string }[] | null;
  catalog: { version: string; entries: CatalogEntry[] } | null;
  packs: ParsedPack[];
  topics: ParsedTopic[];
  issues: Issue[];
};

export type ExistingContext = {
  taxonomy: Taxonomy | null;
  sourceIds: Set<string>;
  topicIds: Set<string>;
  catalogIds: Set<string>;
};

export type ParseOptions = { includeExamples: boolean; today: string; existing: ExistingContext };

const MAX_FILES = 200;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ID_RE = /\b(?:fin|nau|zdr|his|psy|ogo)-\d{4}\b/g;

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function normalizePath(path: string): string | null {
  const p = path.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.includes('\0')) return null;
  const parts = p.split('/');
  if (parts.some((s) => s === '..' || s === '')) return null;
  return parts.join('/');
}

function parseJson(bytes: Buffer): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(bytes.toString('utf8')) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Ścieżki błędów schematu przypisujemy do konkretnego tematu (`/topics/3/...`) albo do paczki. */
function splitPackErrors(errors: ErrorObject[]): {
  pack: ErrorObject[];
  byTopic: Map<number, ErrorObject[]>;
} {
  const pack: ErrorObject[] = [];
  const byTopic = new Map<number, ErrorObject[]>();
  for (const e of errors) {
    const m = /^\/topics\/(\d+)(\/|$)/.exec(e.instancePath);
    if (m) {
      const i = Number(m[1]);
      byTopic.set(i, [...(byTopic.get(i) ?? []), e]);
    } else pack.push(e);
  }
  return { pack, byTopic };
}

function emptyRelease(mode: ParsedRelease['mode']): ParsedRelease {
  return {
    mode,
    fatal: [],
    notes: [],
    warnings: [],
    baseVersion: null,
    schemaVersion: null,
    taxonomyVersion: null,
    taxonomyRaw: null,
    sources: null,
    catalog: null,
    packs: [],
    topics: [],
    issues: [],
  };
}

export function parseUpload(files: UploadedFile[], options: ParseOptions): ParsedRelease {
  const v = getValidators();
  const { existing, today } = options;

  // ── pliki: ścieżki, limity ─────────────────────────────────────────────────────────────────
  const fatalEarly: string[] = [];
  if (files.length === 0) fatalEarly.push('Nie wybrano żadnych plików.');
  if (files.length > MAX_FILES)
    fatalEarly.push(`Zbyt wiele plików (${files.length}); limit to ${MAX_FILES}.`);
  const map = new Map<string, Buffer>();
  for (const f of files) {
    const p = normalizePath(f.path);
    if (!p) {
      fatalEarly.push(`Niedozwolona ścieżka pliku: „${f.path.slice(0, 80)}”.`);
      continue;
    }
    if (f.bytes.length > MAX_FILE_BYTES) {
      fatalEarly.push(`Plik „${p}” jest zbyt duży (limit ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
      continue;
    }
    if (map.has(p)) fatalEarly.push(`Powtórzona ścieżka pliku: „${p}”.`);
    map.set(p, f.bytes);
  }

  const manifestPaths = [...map.keys()].filter(
    (p) => p === 'manifest.json' || p.endsWith('/manifest.json'),
  );
  const mode: ParsedRelease['mode'] = manifestPaths.length > 0 ? 'release' : 'single';
  const rel = emptyRelease(mode);
  rel.fatal.push(...fatalEarly);
  if (rel.fatal.length > 0) return rel;

  let prefix = '';
  if (mode === 'release') {
    const depth = (p: string) => p.split('/').length;
    const best = Math.min(...manifestPaths.map(depth));
    const top = manifestPaths.filter((p) => depth(p) === best);
    if (top.length > 1) {
      rel.fatal.push(
        'Znaleziono kilka plików manifest.json na tym samym poziomie – wybierz jedno wydanie.',
      );
      return rel;
    }
    prefix = top[0]!.slice(0, top[0]!.length - 'manifest.json'.length);
  }
  const at = (relPath: string): Buffer | undefined => map.get(prefix + relPath);

  // ── katalog tytułów (opcjonalny, dowolne miejsce w wybranych plikach) ────────────────────────────
  const catalogPath =
    ['data/catalog.json', 'catalog.json'].map((p) => prefix + p).find((p) => map.has(p)) ??
    [...map.keys()].find((p) => p === 'catalog.json' || p.endsWith('/catalog.json'));
  if (catalogPath) {
    const parsed = parseJson(map.get(catalogPath)!);
    const c = parsed.ok ? (parsed.value as { catalog_version?: unknown; entries?: unknown }) : null;
    if (c && typeof c.catalog_version === 'string' && Array.isArray(c.entries)) {
      const bad = (c.entries as { id?: unknown; title?: unknown }[]).filter(
        (e) =>
          typeof e?.id !== 'string' ||
          !/^(fin|nau|zdr|his|psy|ogo)-\d{4}$/.test(e.id) ||
          typeof e.title !== 'string',
      );
      if (bad.length > 0)
        rel.warnings.push(
          `Katalog tytułów: ${bad.length} wpisów ma nieprawidłowe ID lub tytuł – katalog pominięto.`,
        );
      else rel.catalog = { version: c.catalog_version, entries: c.entries as CatalogEntry[] };
    } else {
      rel.warnings.push('Plik catalog.json ma nieoczekiwany format – katalog pominięto.');
    }
  }

  // ── manifest (tryb wydania) ──────────────────────────────────────────────────────────────────
  let packPaths: string[] = [];
  let taxonomyBytes: Buffer | undefined;
  let sourcesBytes: Buffer | undefined;
  if (mode === 'release') {
    const parsed = parseJson(at('manifest.json')!);
    if (!parsed.ok) {
      rel.fatal.push(`manifest.json: niepoprawny JSON (${parsed.error}).`);
      return rel;
    }
    if (!v.manifest(parsed.value)) {
      rel.fatal.push(...describeErrors(v.manifest.errors).map((e) => `manifest.json: ${e}`));
      return rel;
    }
    const manifest = parsed.value as {
      base_version: string;
      schema_version: string;
      taxonomy_version: string;
      files: { path: string; role: string; sha256: string; is_example?: boolean }[];
    };
    rel.baseVersion = manifest.base_version;
    rel.schemaVersion = manifest.schema_version;
    rel.taxonomyVersion = manifest.taxonomy_version;
    if (Number(manifest.schema_version.split('.')[0]) !== SCHEMA_MAJOR) {
      rel.fatal.push(
        `Wydanie używa schematu ${manifest.schema_version}, a ta wersja aplikacji obsługuje serię ${SCHEMA_MAJOR}.x. Zaktualizuj aplikację przed importem.`,
      );
      return rel;
    }
    for (const entry of manifest.files) {
      const p = normalizePath(entry.path);
      if (!p) {
        rel.fatal.push(`Manifest wskazuje niedozwoloną ścieżkę „${entry.path}”.`);
        continue;
      }
      const bytes = at(p);
      if (!bytes) {
        rel.fatal.push(`Brak pliku „${entry.path}” wymienionego w manifeście.`);
        continue;
      }
      if (sha256(bytes) !== entry.sha256) {
        rel.fatal.push(
          `Suma SHA-256 pliku „${entry.path}” nie zgadza się z manifestem – plik zmieniono po wydaniu.`,
        );
        continue;
      }
      if (entry.role === 'taxonomy') taxonomyBytes = bytes;
      else if (entry.role === 'sources') sourcesBytes = bytes;
      else if (entry.role === 'pack') packPaths.push(prefix + p);
      else rel.notes.push(`Pominięto plik „${entry.path}” o nieobsługiwanej roli „${entry.role}”.`);
    }
    if (rel.fatal.length > 0) return rel;
    const listed = new Set(manifest.files.map((f) => normalizePath(f.path)));
    const unlisted = [...map.keys()].filter(
      (p) =>
        p.startsWith(prefix) &&
        p !== `${prefix}manifest.json` &&
        !listed.has(p.slice(prefix.length)) &&
        !p.endsWith('catalog.json'),
    );
    if (unlisted.length > 0)
      rel.notes.push(`Pliki spoza manifestu zostały zignorowane (${unlisted.length}).`);
  } else {
    // pojedyncze pliki: rozpoznajemy paczki po zawartości, rejestr źródeł i taksonomię po nazwie
    for (const [p, bytes] of map) {
      const base = p.split('/').pop()!;
      if (base === 'catalog.json') continue;
      if (base === 'taxonomy.json') taxonomyBytes = bytes;
      else if (base === 'sources.json') sourcesBytes = bytes;
      else if (base.endsWith('.json')) packPaths.push(p);
    }
    packPaths = packPaths.sort();
    rel.notes.push('Import pojedynczych plików: bez manifestu nie można sprawdzić sum SHA-256.');
  }

  // ── taksonomia ───────────────────────────────────────────────────────────────────────────────
  let taxonomy = existing.taxonomy;
  if (taxonomyBytes) {
    const parsed = parseJson(taxonomyBytes);
    const t = parsed.ok ? toTaxonomy(parsed.value) : null;
    if (!parsed.ok || !t) {
      rel.fatal.push('taxonomy.json: niepoprawny format taksonomii.');
      return rel;
    }
    taxonomy = t;
    rel.taxonomyRaw = parsed.value;
    rel.taxonomyVersion = t.version;
  }

  // ── rejestr źródeł ───────────────────────────────────────────────────────────────────────────
  const sourceIds = new Set(existing.sourceIds);
  if (sourcesBytes) {
    const parsed = parseJson(sourcesBytes);
    if (!parsed.ok) {
      rel.fatal.push(`sources.json: niepoprawny JSON (${parsed.error}).`);
      return rel;
    }
    if (!v.sources(parsed.value)) {
      rel.fatal.push(...describeErrors(v.sources.errors).map((e) => `sources.json: ${e}`));
      return rel;
    }
    const list = (parsed.value as { sources: { id: string }[] }).sources;
    const ids = list.map((s) => s.id);
    const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    if (dup.length > 0) {
      rel.fatal.push(`sources.json: powtórzone ID źródeł: ${dup.join(', ')}.`);
      return rel;
    }
    rel.sources = list;
    ids.forEach((id) => sourceIds.add(id));
  }

  if (packPaths.length === 0 && !rel.catalog) {
    rel.fatal.push('Nie znaleziono żadnej paczki tematów ani katalogu tytułów do zaimportowania.');
    return rel;
  }
  if (!taxonomy && packPaths.length > 0) {
    rel.fatal.push('Brak taksonomii: dołącz taxonomy.json lub najpierw zaimportuj pełne wydanie.');
    return rel;
  }

  // ── paczki i tematy ──────────────────────────────────────────────────────────────────────────
  const seenIds = new Map<string, string>();
  const seenSlugs = new Map<string, string>();
  const seenPackIds = new Map<string, string>();
  const validForCross = new Map<string, TopicRecord>();

  for (const path of packPaths) {
    const file = path.split('/').pop()!;
    const pack: ParsedPack = {
      file,
      packId: '?',
      isExample: false,
      skipped: false,
      topicCount: 0,
      errors: [],
    };
    rel.packs.push(pack);
    const parsed = parseJson(map.get(path)!);
    if (!parsed.ok) {
      pack.errors.push(`niepoprawny JSON (${parsed.error})`);
      continue;
    }
    const raw = parsed.value as {
      pack_id?: unknown;
      is_example?: unknown;
      topics?: unknown;
      schema_version?: unknown;
    };
    if (typeof raw?.pack_id !== 'string' || !Array.isArray(raw.topics)) {
      pack.errors.push('plik nie jest paczką tematów (brak pack_id lub topics)');
      continue;
    }
    pack.packId = raw.pack_id;
    pack.isExample = raw.is_example === true;
    pack.topicCount = raw.topics.length;
    if (pack.isExample && !options.includeExamples) {
      pack.skipped = true;
      rel.notes.push(`Paczka przykładowa „${file}” została pominięta.`);
      continue;
    }
    if (seenPackIds.has(pack.packId))
      pack.errors.push(`pack_id ${pack.packId} już użyte w ${seenPackIds.get(pack.packId)}`);
    seenPackIds.set(pack.packId, file);
    if (
      typeof raw.schema_version === 'string' &&
      Number(raw.schema_version.split('.')[0]) !== SCHEMA_MAJOR
    ) {
      pack.errors.push(
        `schema_version ${raw.schema_version} nie jest obsługiwana (obsługiwana seria ${SCHEMA_MAJOR}.x)`,
      );
      continue;
    }

    const valid = v.pack(parsed.value);
    const { pack: packErrors, byTopic } = valid
      ? { pack: [], byTopic: new Map<number, ErrorObject[]>() }
      : splitPackErrors(v.pack.errors ?? []);
    if (packErrors.length > 0) {
      pack.errors.push(...describeErrors(packErrors));
      // błędy na poziomie paczki (np. liczba tematów) nie unieważniają osobno poprawnych rekordów, ale ostrzegamy
    }

    (raw.topics as unknown[]).forEach((rawTopic, index) => {
      const rec = rawTopic as { id?: unknown; slug?: unknown } | null;
      const label = typeof rec?.id === 'string' ? rec.id : `#${index + 1}`;
      const topic: ParsedTopic = {
        id: label,
        packFile: file,
        packId: pack.packId,
        isExample: pack.isExample,
        record: null,
        raw: rawTopic,
        contentHash: '',
        errors: [],
        warnings: [],
      };
      rel.topics.push(topic);

      const schemaErrors = byTopic.get(index);
      if (schemaErrors?.length) {
        topic.errors.push(...describeErrors(schemaErrors).map((e) => `schemat: ${e}`));
        if (schemaErrors.length > 6)
          topic.errors.push(`… oraz ${schemaErrors.length - 6} kolejnych błędów schematu`);
        return;
      }
      const record = rawTopic as TopicRecord;
      topic.record = record;
      topic.contentHash = sha256(
        Buffer.from(topicContentPayload(rawTopic as Record<string, unknown>)),
      );

      if (seenIds.has(record.id)) {
        topic.errors.push(`powtórzone ID tematu (już użyte w ${seenIds.get(record.id)})`);
        topic.record = null;
        return;
      }
      seenIds.set(record.id, file);
      if (seenSlugs.has(record.slug))
        topic.errors.push(`slug już użyty przez ${seenSlugs.get(record.slug)}`);
      else seenSlugs.set(record.slug, record.id);

      for (const issue of checkTopic(record, `${file}:${record.id}`, taxonomy!, sourceIds, today)) {
        rel.issues.push(issue);
        (issue.level === 'error'
          ? topic.errors
          : issue.level === 'warning'
            ? topic.warnings
            : []
        ).push(issue.message);
      }
      if (topic.errors.length === 0) validForCross.set(record.id, record);
    });
  }

  if (rel.packs.length > 0 && rel.packs.every((p) => p.skipped) && !rel.catalog) {
    rel.fatal.push(
      'Wszystkie paczki w tym wydaniu są przykładowe. Zaznacz opcję importu paczek przykładowych, jeśli chcesz je wypróbować.',
    );
    return rel;
  }

  // ── kontrole krzyżowe (relacje, cykle, duplikaty) ──────────────────────────────────────────────
  if (validForCross.size > 0) {
    const catalogIds = new Set<string>([
      ...existing.catalogIds,
      ...existing.topicIds,
      ...(rel.catalog?.entries.map((e) => e.id) ?? []),
    ]);
    const byId = new Map(rel.topics.filter((t) => t.record).map((t) => [t.id, t]));
    for (const issue of checkCross(validForCross, catalogIds)) {
      rel.issues.push(issue);
      for (const id of new Set(issue.where.match(ID_RE) ?? [])) {
        const target = byId.get(id);
        if (!target) continue;
        if (issue.level === 'error') target.errors.push(issue.message);
        else if (issue.level === 'warning') target.warnings.push(issue.message);
      }
    }
  }
  return rel;
}
