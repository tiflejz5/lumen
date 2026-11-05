import { canonicalJson } from './canonical.ts';

/**
 * Klasyfikacja tematu z paczki względem tematu zapisanego lokalnie (reguły z IMPORT.md i VERSIONING.md).
 *
 *  new        – brak lokalnie
 *  unchanged  – ta sama rewizja i ta sama treść
 *  refresh    – ta sama rewizja i treść, nowsza weryfikacja: zmienia się tylko blok „freshness”
 *  update     – wyższa rewizja
 *  conflict   – ta sama rewizja, ale inna treść (rewizję trzeba było zwiększyć)
 *  older      – niższa rewizja niż lokalna (pomijany)
 */
export type ImportClass = 'new' | 'unchanged' | 'refresh' | 'update' | 'conflict' | 'older';

export type LocalTopicInfo = {
  revision: number;
  contentHash: string;
  lastVerifiedAt: string;
  status: 'active' | 'deprecated';
};

export type IncomingTopicInfo = {
  revision: number;
  contentHash: string;
  lastVerifiedAt: string;
  status: 'active' | 'deprecated';
};

export function classifyTopic(
  incoming: IncomingTopicInfo,
  local: LocalTopicInfo | undefined,
): ImportClass {
  if (!local) return 'new';
  if (incoming.revision > local.revision) return 'update';
  if (incoming.revision < local.revision) return 'older';
  if (incoming.contentHash !== local.contentHash) return 'conflict';
  if (incoming.lastVerifiedAt > local.lastVerifiedAt) return 'refresh';
  return 'unchanged';
}

/**
 * Treść tematu bez bloku „freshness” w postaci kanonicznej: sama ponowna weryfikacja nie zmienia
 * treści (VERSIONING.md: nie zwiększa rewizji). Klucze sortowane, więc kolejność pól w pliku nie ma znaczenia.
 */
export function topicContentPayload(topic: Record<string, unknown>): string {
  const { freshness: _freshness, ...rest } = topic;
  return canonicalJson(rest);
}
