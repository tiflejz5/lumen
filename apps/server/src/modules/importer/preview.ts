import { randomBytes } from 'node:crypto';
import {
  canonicalJson,
  classifyTopic,
  type ImportPreview,
  type PreviewAction,
  type PreviewTopic,
} from '@lumen/core';
import type { Db } from '../../db/connection.ts';
import {
  getCatalogIds,
  getLocalTopics,
  getSourceIds,
  getTaxonomy,
  getTaxonomyRaw,
  getTopicData,
  type LocalTopic,
} from '../topics/repo.ts';
import { parseUpload, type ParsedRelease, type UploadedFile } from './release.ts';

export type { ImportPreview, PreviewAction, PreviewTopic };

export type Staged = {
  release: ParsedRelease;
  preview: ImportPreview;
  createdAt: number;
  includeExamples: boolean;
};

const SELECTABLE: ReadonlySet<PreviewAction> = new Set(['new', 'update', 'conflict', 'refresh']);

/** Sekcje rekordu, które różnią się między wersją lokalną a przychodzącą (do podglądu zmian). */
export function changedSections(
  local: Record<string, unknown>,
  incoming: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  const keys = new Set([...Object.keys(local), ...Object.keys(incoming)]);
  for (const key of [...keys].sort()) {
    const a = local[key];
    const b = incoming[key];
    if (canonicalJson(a) === canonicalJson(b)) continue;
    const isObj = (x: unknown): x is Record<string, unknown> =>
      !!x && typeof x === 'object' && !Array.isArray(x);
    if ((key === 'core' || key === 'extended' || key === 'freshness') && isObj(a) && isObj(b)) {
      for (const sub of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        if (canonicalJson(a[sub]) !== canonicalJson(b[sub])) out.push(`${key}.${sub}`);
      }
    } else out.push(key);
  }
  return out;
}

export function buildPreview(
  db: Db,
  files: UploadedFile[],
  options: { includeExamples: boolean; today: string },
): Staged {
  const localTopics = getLocalTopics(db);
  const localSlugs = new Map(
    (db.prepare('SELECT id, slug FROM topics').all() as { id: string; slug: string }[]).map((r) => [
      r.slug,
      r.id,
    ]),
  );
  const release = parseUpload(files, {
    includeExamples: options.includeExamples,
    today: options.today,
    existing: {
      taxonomy: getTaxonomy(db),
      sourceIds: getSourceIds(db),
      topicIds: new Set(localTopics.keys()),
      catalogIds: getCatalogIds(db),
    },
  });

  // Slug musi być unikalny także względem tematów zapisanych wcześniej (pod innym ID).
  for (const t of release.topics) {
    const owner = t.record ? localSlugs.get(t.record.slug) : undefined;
    if (t.record && owner && owner !== t.record.id) {
      t.errors.push(`slug „${t.record.slug}” jest już używany przez zapisany temat ${owner}`);
    }
  }

  const topics: PreviewTopic[] = release.topics.map((t) => {
    const record = t.record;
    const base = {
      id: t.id,
      title: record?.core.title ?? '(rekord nieprawidłowy)',
      category: record?.core.category ?? '',
      level: record?.core.difficulty.level ?? '',
      topicType: record?.core.topic_type ?? '',
      revision: record?.revision ?? 0,
      packId: t.packId,
      isExample: t.isExample,
      localRevision: null as number | null,
      replacesExample: false,
      becomesDeprecated: false,
      changedSections: [] as string[],
      changeNote: null as string | null,
      errors: t.errors,
      warnings: t.warnings,
    };
    if (!record || t.errors.length > 0) {
      return { ...base, action: 'invalid' as const, selectable: false, defaultSelected: false };
    }
    const local: LocalTopic | undefined = localTopics.get(record.id);
    let action: PreviewAction;
    let replacesExample = false;
    if (local && local.isExample && !t.isExample) {
      action = 'update';
      replacesExample = true;
    } else if (local && !local.isExample && t.isExample) {
      action = 'example_skipped';
    } else {
      action = classifyTopic(
        {
          revision: record.revision,
          contentHash: t.contentHash,
          lastVerifiedAt: record.freshness.last_verified_at,
          status: record.status,
        },
        local && {
          revision: local.revision,
          contentHash: local.contentHash,
          lastVerifiedAt: local.lastVerifiedAt,
          status: local.status,
        },
      );
    }
    let sections: string[] = [];
    if (local && (action === 'update' || action === 'conflict' || action === 'refresh')) {
      const current = getTopicData(db, record.id);
      if (current) sections = changedSections(current, t.raw as Record<string, unknown>);
    }
    const selectable = SELECTABLE.has(action);
    return {
      ...base,
      action,
      selectable,
      // Nowe tematy są domyślnie zaznaczone; zmiany istniejących wymagają świadomej zgody.
      defaultSelected: action === 'new',
      localRevision: local?.revision ?? null,
      replacesExample,
      becomesDeprecated: record.status === 'deprecated' && local?.status === 'active',
      changedSections: sections,
      changeNote: record.changelog[record.changelog.length - 1]
        ? ((record.changelog[record.changelog.length - 1] as { change?: string }).change ?? null)
        : null,
    };
  });

  const counts = {
    new: 0,
    unchanged: 0,
    refresh: 0,
    update: 0,
    conflict: 0,
    older: 0,
    invalid: 0,
    example_skipped: 0,
  } satisfies Record<PreviewAction, number>;
  for (const t of topics) counts[t.action] += 1;

  // Źródła: ile nowych i zmienionych względem lokalnego rejestru.
  let sources: ImportPreview['sources'] = null;
  if (release.sources) {
    const rows = db.prepare('SELECT id, data FROM sources').all() as { id: string; data: string }[];
    const local = new Map(rows.map((r) => [r.id, canonicalJson(JSON.parse(r.data))]));
    let added = 0;
    let changed = 0;
    for (const s of release.sources) {
      const before = local.get(s.id);
      if (before === undefined) added += 1;
      else if (before !== canonicalJson(s)) changed += 1;
    }
    sources = { total: release.sources.length, added, changed };
  }

  let catalog: ImportPreview['catalog'] = null;
  if (release.catalog) {
    const known = getCatalogIds(db);
    catalog = {
      version: release.catalog.version,
      total: release.catalog.entries.length,
      added: release.catalog.entries.filter((e) => !known.has(e.id)).length,
    };
  }

  let taxonomyChanged: boolean | null = null;
  if (release.taxonomyRaw)
    taxonomyChanged = canonicalJson(release.taxonomyRaw) !== canonicalJson(getTaxonomyRaw(db));

  const present = new Set(release.topics.map((t) => t.id));
  const processedAnyPack = release.packs.some((p) => !p.skipped && p.errors.length === 0);
  const missingLocal =
    release.mode === 'release' && processedAnyPack
      ? [...localTopics.values()].filter((l) => !l.isExample && !present.has(l.id)).map((l) => l.id)
      : [];

  const preview: ImportPreview = {
    token: randomBytes(18).toString('base64url'),
    mode: release.mode,
    baseVersion: release.baseVersion,
    schemaVersion: release.schemaVersion,
    taxonomyVersion: release.taxonomyVersion,
    fatal: release.fatal,
    notes: release.notes,
    warnings: release.warnings,
    packs: release.packs,
    topics,
    counts,
    sources,
    catalog,
    taxonomyChanged,
    missingLocal,
    blocked: release.fatal.length > 0,
  };
  return { release, preview, createdAt: Date.now(), includeExamples: options.includeExamples };
}
