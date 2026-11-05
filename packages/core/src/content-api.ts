import type { ImportClass } from './classify.ts';
import type { Explanation, UserTopicStatus } from './selection.ts';

/** Typy odpowiedzi API związanych z treściami – wspólne dla serwera i interfejsu. */

export type PreviewAction = ImportClass | 'invalid' | 'example_skipped';

export type PackInfo = {
  file: string;
  packId: string;
  isExample: boolean;
  skipped: boolean;
  topicCount: number;
  errors: string[];
};

export type PreviewTopic = {
  id: string;
  title: string;
  category: string;
  level: string;
  topicType: string;
  revision: number;
  packId: string;
  isExample: boolean;
  action: PreviewAction;
  selectable: boolean;
  defaultSelected: boolean;
  localRevision: number | null;
  replacesExample: boolean;
  becomesDeprecated: boolean;
  changedSections: string[];
  changeNote: string | null;
  errors: string[];
  warnings: string[];
};

export type ImportPreview = {
  token: string;
  mode: 'release' | 'single';
  baseVersion: string | null;
  schemaVersion: string | null;
  taxonomyVersion: string | null;
  fatal: string[];
  notes: string[];
  warnings: string[];
  packs: PackInfo[];
  topics: PreviewTopic[];
  counts: Record<PreviewAction, number>;
  sources: { total: number; added: number; changed: number } | null;
  catalog: { version: string; total: number; added: number } | null;
  taxonomyChanged: boolean | null;
  /** tematy z bazy lokalnej, których nie ma w tym wydaniu (nie zostaną usunięte) */
  missingLocal: string[];
  blocked: boolean;
};

export type ReportItem = {
  id: string;
  title: string;
  action: PreviewAction;
  decision: 'imported' | 'not_selected' | 'rejected' | 'skipped';
  note?: string;
};

export type ImportSummary = {
  imported: number;
  inserted: number;
  updated: number;
  refreshed: number;
  notSelected: number;
  rejected: number;
  unchanged: number;
  sourcesWritten: number;
  catalogWritten: number;
};

export type ImportReport = {
  id: string;
  createdAt: string;
  mode: 'release' | 'single';
  baseVersion: string | null;
  schemaVersion: string | null;
  summary: ImportSummary;
  snapshot: string | null;
  items: ReportItem[];
  notes: string[];
  warnings: string[];
};

export type ImportListItem = {
  id: string;
  createdAt: string;
  mode: string;
  baseVersion: string | null;
  summary: ImportSummary;
};

export type TopicCard = {
  id: string;
  title: string;
  category: string;
  subcategory: string;
  level: string;
  topicType: string;
  summary: string;
  whyItMatters: string;
  estimatedMinutes: number;
  needsReview: boolean;
  isExample: boolean;
  userStatus: UserTopicStatus | null;
};

export type DailyResult = {
  date: string;
  topic: TopicCard | null;
  explanation: Explanation | null;
  /** powód braku tematu: baza pusta albo wszystko wykorzystane */
  reason: 'no_topics' | 'exhausted' | null;
};

export type TopicListItem = {
  id: string;
  title: string;
  category: string;
  subcategory: string;
  level: string;
  topicType: string;
  status: string;
  revision: number;
  isExample: boolean;
  needsReview: boolean;
  userStatus: string | null;
};

export type SourceRecord = {
  id: string;
  name: string;
  publisher: string;
  authors?: string[];
  year?: number;
  source_type: string;
  language: string;
  description: string;
  limitations: string;
  conflict_of_interest?: string;
  url?: string;
  url_status: 'verified' | 'unverified' | 'institution_only';
  verified_at?: string;
};

export type TopicDetail = {
  id: string;
  slug: string;
  revision: number;
  status: string;
  supersededBy: string | null;
  core: {
    title: string;
    category: string;
    subcategory: string;
    difficulty: { level: string };
    topic_type: string;
    current_subtype?: string;
    summary: string;
    why_it_matters: string;
    main_question: string;
    research_questions: string[];
    keywords: string[];
    search_queries: { query: string; lang: string; purpose: string }[];
    suggested_sources: {
      source_id: string;
      why: string;
      what_to_find: string;
      limitations?: string;
    }[];
    verification_tips: string[];
    final_task: string;
    estimated_minutes: { research: number; quiz: number; summary: number };
  };
  related: { id: string; title: string | null; written: boolean }[];
  relations: { prerequisites: string[]; related: string[]; next: string[] };
  freshness: {
    last_verified_at: string;
    valid_as_of: string;
    review_interval_months: number | null;
    time_sensitive_items?: string[];
  };
  auditGrade: string;
  sources: SourceRecord[];
  needsReview: boolean;
  isExample: boolean;
  userState: { status: string; postponedUntil: string | null; deepen: boolean } | null;
};

export type ContentSummary = {
  baseVersion: string | null;
  schemaVersion: string | null;
  taxonomyVersion: string | null;
  topics: {
    active: number;
    deprecated: number;
    examples: number;
    byCategory: Record<string, number>;
    byLevel: Record<string, number>;
    byType: Record<string, number>;
  };
  catalog: { total: number; written: number };
  sources: number;
  demoMode: boolean;
};

export type TaxonomyDto = {
  taxonomy_version: string;
  categories: {
    id: string;
    id_prefix: string;
    label: string;
    subcategories: { id: string; label: string }[];
  }[];
  enums?: Record<string, Record<string, string>>;
};
