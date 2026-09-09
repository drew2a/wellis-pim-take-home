/**
 * Builds the browsable inventory page (docs/legacy-export-inventory.html) from
 * docs/data-profile.json. Run with `npm run profile:inventory` after `npm run profile`.
 *
 * Why: the markdown profile is the record; the page is the reading aid the reviewer uses to see
 * the diversity of every column at once. Long arrays are pruned to their head so the page stays
 * small; the JSON keeps the complete inventories.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CAP = 40;

type Json = null | boolean | number | string | Json[] | {[k: string]: Json};

interface Pruned {
  readonly __list: true;
  readonly items: Json[];
  readonly total: number;
  readonly remaining: number;
}

function countOf(item: Json): number {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return 0;
  const c = item['count'] ?? item['rows'];
  return typeof c === 'number' ? c : 0;
}

function prune(value: Json): Json | Pruned {
  if (Array.isArray(value)) {
    const first = value[0];
    if (value.length > CAP && first !== undefined && typeof first === 'object') {
      const remaining = value.slice(CAP).reduce((acc: number, it) => acc + countOf(it), 0);
      return {__list: true, items: value.slice(0, CAP).map((v) => prune(v) as Json), total: value.length, remaining};
    }
    if (value.length > 200) return {__list: true, items: value.slice(0, CAP), total: value.length, remaining: 0};
    return value.map((v) => prune(v) as Json);
  }
  if (value !== null && typeof value === 'object') {
    const out: {[k: string]: Json} = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'members') continue; // lists of legacy ids, not useful to browse
      out[k] = prune(v) as Json;
    }
    return out;
  }
  return value;
}

const source = JSON.parse(readFileSync(join(ROOT, 'docs', 'data-profile.json'), 'utf8')) as Json;
const data = prune(source);
const template = readFileSync(join(HERE, 'inventory-template.html'), 'utf8');
if (!template.includes('/*__DATA__*/')) throw new Error('template has no data slot');
const html = template.replace('/*__DATA__*/', 'const DATA = ' + JSON.stringify(data).replace(/</gu, '\\u003c') + ';');
const out = join(ROOT, 'docs', 'legacy-export-inventory.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${html.length} bytes)`);
