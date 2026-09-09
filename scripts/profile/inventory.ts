/**
 * Builds the browsable inventory page (docs/profile/legacy-export-inventory.html) from
 * docs/profile/data-profile.json. Run with `npm run profile:inventory -- --as-of YYYY-MM-DD`
 * after `npm run profile` with the same date; the script refuses a JSON generated for another
 * date, so the page can never show counts measured against a reference it does not print.
 *
 * Why: the markdown profile is the record; the page is the reading aid the reviewer uses to see
 * the diversity of every column at once. Long arrays are pruned to their head so the page stays
 * small; the JSON keeps the complete inventories.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {INVENTORY_HTML, PROFILE_JSON, abs, asOfFromArgv, reproduceCommand} from './cli.js';

const HERE = dirname(fileURLToPath(import.meta.url));
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

const asOf = asOfFromArgv();
const source = JSON.parse(readFileSync(abs(PROFILE_JSON), 'utf8')) as Json;
if (source === null || typeof source !== 'object' || Array.isArray(source)) throw new Error(`${PROFILE_JSON} is not an object`);
if (source['asOf'] !== asOf) {
  throw new Error(`${PROFILE_JSON} was generated as of ${String(source['asOf'])}, not ${asOf}; run \`${reproduceCommand('profile', asOf)}\` first`);
}
// Only the inventories are pruned. The top-level lists (`sections`, `exportNotesClaims`,
// `notWarnedAbout`) are read with plain `.map` by the template and must stay arrays however
// long they get; the page would otherwise render blank while this script still exits 0.
const data: {[k: string]: Json} = {...source, columns: prune(source['columns'] ?? null) as Json, crossFile: prune(source['crossFile'] ?? null) as Json};
const template = readFileSync(join(HERE, 'inventory-template.html'), 'utf8');
if (!template.includes('/*__DATA__*/')) throw new Error('template has no data slot');
// A function replacement, so `$&` and friends inside the JSON are never expanded.
const html = template.replace('/*__DATA__*/', () => 'const DATA = ' + JSON.stringify(data).replace(/</gu, '\\u003c') + ';');
writeFileSync(abs(INVENTORY_HTML), html);
console.log(`wrote ${INVENTORY_HTML} (${html.length} bytes), as of ${asOf}`);
