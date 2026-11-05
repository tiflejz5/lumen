import { readdirSync, readFileSync } from 'node:fs';
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

// Ajv i ajv-formats są pakietami CJS – zależnie od ładowarki domyślny eksport bywa opakowany.
function unwrap<T>(mod: unknown): T {
  const m = mod as { default?: unknown };
  return (m.default ?? mod) as T;
}
const Ajv2020 = unwrap<typeof Ajv2020Module.default>(Ajv2020Module);
const addFormats = unwrap<typeof addFormatsModule.default>(addFormatsModule);

const SCHEMA_DIR = new URL('../../../../../packages/core/schema/', import.meta.url);

export const SCHEMA_IDS = {
  manifest: 'https://local.wiedza-baza/schema/manifest.schema.json',
  pack: 'https://local.wiedza-baza/schema/pack.schema.json',
  topic: 'https://local.wiedza-baza/schema/topic.schema.json',
  sources: 'https://local.wiedza-baza/schema/sources.schema.json',
} as const;

export type Validators = Record<keyof typeof SCHEMA_IDS, ValidateFunction>;

let cached: Validators | null = null;

/** Kompiluje schematy autora bazy (JSON Schema 2020-12) – jedno źródło prawdy dla walidacji poziomu 1. */
export function getValidators(): Validators {
  if (cached) return cached;
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(readFileSync(new URL(file, SCHEMA_DIR), 'utf8')));
  }
  cached = Object.fromEntries(
    (Object.entries(SCHEMA_IDS) as [keyof typeof SCHEMA_IDS, string][]).map(([key, id]) => {
      const validate = ajv.getSchema(id);
      if (!validate) throw new Error(`Brak schematu ${id}`);
      return [key, validate];
    }),
  ) as Validators;
  return cached;
}

export function describeErrors(errors: ErrorObject[] | null | undefined, limit = 6): string[] {
  if (!errors) return [];
  return errors
    .slice(0, limit)
    .map((e) => `${e.instancePath || '(korzeń)'}: ${e.message ?? 'niezgodne ze schematem'}`);
}

export type { ErrorObject };
