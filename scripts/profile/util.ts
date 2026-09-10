/**
 * Byte-faithful reading and value-inventory primitives for the legacy profile.
 *
 * Why byte-faithful: `legacy_export/` is read-only evidence (CLAUDE.md §5). Any
 * transformation applied here (trimming, case folding) is computed *alongside* the raw
 * value, never in place of it, so the profile can state what the export contains and
 * what a later normalisation rule would change.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

export interface FileInfo {
  readonly path: string;
  readonly name: string;
  readonly bytes: number;
  readonly hasBom: boolean;
  readonly utf8Valid: boolean;
  readonly nonAsciiBytes: number;
  readonly crlf: number;
  readonly loneLf: number;
  readonly loneCr: number;
  readonly endsWithNewline: boolean;
  /** Physical lines, counting a final unterminated line. */
  readonly physicalLines: number;
  /** Decoded text with the BOM removed (if any); nothing else is altered. */
  readonly text: string;
  /** Physical lines with terminators stripped; a trailing terminator yields no extra line. */
  readonly lines: readonly string[];
  readonly blankLines: number;
}

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function readFileInfo(path: string): FileInfo {
  const buf = readFileSync(path);
  const hasBom = buf.length >= 3 && buf.subarray(0, 3).equals(BOM);
  const body = hasBom ? buf.subarray(3) : buf;

  let utf8Valid = true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    utf8Valid = false;
  }

  let crlf = 0;
  let loneLf = 0;
  let loneCr = 0;
  let nonAsciiBytes = 0;
  for (let i = 0; i < body.length; i++) {
    const b = body[i] ?? 0;
    if (b > 0x7f) nonAsciiBytes++;
    if (b === 0x0d) {
      if (body[i + 1] === 0x0a) {
        crlf++;
        i++;
      } else {
        loneCr++;
      }
    } else if (b === 0x0a) {
      loneLf++;
    }
  }

  const text = body.toString('utf8');
  const rawLines = text.split(/\r\n|\n|\r/);
  const endsWithNewline = /(\r\n|\n|\r)$/.test(text);
  // split() leaves an empty tail element for a terminated final line; drop it.
  const lines = endsWithNewline ? rawLines.slice(0, -1) : rawLines;
  return {
    path,
    name: basename(path),
    bytes: buf.length,
    hasBom,
    utf8Valid,
    nonAsciiBytes,
    crlf,
    loneLf,
    loneCr,
    endsWithNewline,
    physicalLines: lines.length,
    text,
    lines,
    blankLines: lines.filter((l) => l === '').length,
  };
}

export function eolLabel(info: FileInfo): string {
  const parts: string[] = [];
  if (info.crlf > 0) parts.push(`CRLF x ${info.crlf}`);
  if (info.loneLf > 0) parts.push(`bare LF x ${info.loneLf}`);
  if (info.loneCr > 0) parts.push(`bare CR x ${info.loneCr}`);
  return parts.length > 0 ? parts.join(', ') : 'none';
}

/** Digits to `9`, lowercase letters to `a`, uppercase letters to `A`; everything else verbatim. */
export function shape(s: string): string {
  return s
    .replace(/\p{Nd}/gu, '9')
    .replace(/\p{Ll}/gu, 'a')
    .replace(/\p{Lu}/gu, 'A');
}

/** `shape()` with runs of one identical character collapsed to `X+` (e.g. `aaa.aa` -> `a+.a+`). */
export function collapsedShape(s: string): string {
  return shape(s).replace(/(.)\1+/gu, '$1+');
}

/** trim + lowercase + collapse internal whitespace runs to one space. */
export function fold(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/gu, ' ');
}

export function hasEdgeWhitespace(s: string): boolean {
  return s !== s.trim();
}

export function hasDoubleSpace(s: string): boolean {
  return /\s\s/u.test(s.trim());
}

/**
 * Separator for composite string keys. NUL cannot occur in a CSV field or a JSON string
 * value read from the export, so joining with it can never collide two distinct tuples.
 * Written as an escape: a literal NUL byte makes git treat the source file as binary.
 */
export const KEY_SEP = '\u0000';

export function digitsOnly(s: string): string {
  return s.replace(/\D/gu, '');
}

/** True when the string carries a combining mark once decomposed, or any non-ASCII character. */
export function hasDiacritics(s: string): boolean {
  return /\p{M}/u.test(s.normalize('NFD')) || /[^ -~]/u.test(s);
}

/** Characters outside letters, marks, space, apostrophe, hyphen and dot, sorted. */
export function unusualNameChars(s: string): string[] {
  const found = new Set<string>();
  for (const ch of s) if (!/[\p{L}\p{M} '\-.]/u.test(ch)) found.add(ch);
  return [...found].sort();
}

export class Counter {
  private readonly m = new Map<string, number>();

  add(key: string, n = 1): void {
    this.m.set(key, (this.m.get(key) ?? 0) + n);
  }

  get(key: string): number {
    return this.m.get(key) ?? 0;
  }

  get size(): number {
    return this.m.size;
  }

  total(): number {
    let t = 0;
    for (const v of this.m.values()) t += v;
    return t;
  }

  keys(): string[] {
    return [...this.m.keys()].sort();
  }

  /** Sorted by count desc, then key asc, so the output is deterministic. */
  entries(): { value: string; count: number }[] {
    return [...this.m.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  }
}

export interface Group {
  readonly key: string;
  readonly count: number;
  readonly examples: readonly string[];
}

/** Counts keys and keeps up to three example source values per key. */
export class Grouper {
  private readonly m = new Map<string, { count: number; examples: string[] }>();

  add(key: string, example: string): void {
    const g = this.m.get(key);
    if (g === undefined) {
      this.m.set(key, { count: 1, examples: [example] });
      return;
    }
    g.count++;
    if (g.examples.length < 3 && !g.examples.includes(example)) g.examples.push(example);
  }

  get size(): number {
    return this.m.size;
  }

  entries(): Group[] {
    return [...this.m.entries()]
      .map(([key, g]) => ({ key, count: g.count, examples: g.examples }))
      .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
}

export interface NumStats {
  readonly n: number;
  readonly min: number | null;
  readonly p5: number | null;
  readonly median: number | null;
  readonly p95: number | null;
  readonly max: number | null;
}

/** Nearest-rank percentiles: no interpolation, so every reported figure is an observed value. */
export function numStats(xs: readonly number[]): NumStats {
  if (xs.length === 0) return { n: 0, min: null, p5: null, median: null, p95: null, max: null };
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number): number =>
    s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] as number;
  return {
    n: s.length,
    min: s[0] as number,
    p5: at(0.05),
    median: at(0.5),
    p95: at(0.95),
    max: s[s.length - 1] as number,
  };
}

export function fmtNum(x: number | null): string {
  if (x === null) return '-';
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

export function statsRow(label: string, s: NumStats): string[] {
  return [
    label,
    String(s.n),
    fmtNum(s.min),
    fmtNum(s.p5),
    fmtNum(s.median),
    fmtNum(s.p95),
    fmtNum(s.max),
  ];
}

export const STATS_HEADER = ['group', 'n', 'min', 'p5', 'median', 'p95', 'max'] as const;

export interface ParsedNumber {
  readonly ok: boolean;
  readonly value: number;
  /** Decimal separator actually used, `''` for integers. */
  readonly separator: string;
}

/** Accepts `12`, `12.5`, `12,5` (with surrounding whitespace); nothing else. */
export function parseNumber(raw: string): ParsedNumber {
  const t = raw.trim();
  const m = /^([+-]?\d+)(?:([.,])(\d+))?$/u.exec(t);
  if (m === null) return { ok: false, value: Number.NaN, separator: '' };
  const sep = m[2] ?? '';
  const value = Number(`${m[1] ?? ''}${sep === '' ? '' : '.'}${m[3] ?? ''}`);
  return { ok: Number.isFinite(value), value, separator: sep };
}

/** Buckets a value into the first band whose upper bound it is below. */
export function band(x: number, edges: readonly number[]): string {
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i] as number;
    if (x < e) return i === 0 ? `< ${e}` : `${edges[i - 1]} .. ${e}`;
  }
  return `>= ${edges[edges.length - 1]}`;
}

export function bandLabels(edges: readonly number[]): string[] {
  const out: string[] = [`< ${edges[0]}`];
  for (let i = 1; i < edges.length; i++) out.push(`${edges[i - 1]} .. ${edges[i]}`);
  out.push(`>= ${edges[edges.length - 1]}`);
  return out;
}

/** Union-find over row indices, used for every duplicate-candidate grouping. */
export class UnionFind {
  private readonly parent: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }

  find(i: number): number {
    let r = i;
    while ((this.parent[r] as number) !== r) r = this.parent[r] as number;
    let c = i;
    while ((this.parent[c] as number) !== c) {
      const next = this.parent[c] as number;
      this.parent[c] = r;
      c = next;
    }
    return r;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }

  /** Components with more than one member, keyed by the smallest member index. */
  components(): number[][] {
    const byRoot = new Map<number, number[]>();
    for (let i = 0; i < this.parent.length; i++) {
      const r = this.find(i);
      const list = byRoot.get(r);
      if (list === undefined) byRoot.set(r, [i]);
      else list.push(i);
    }
    return [...byRoot.values()]
      .filter((c) => c.length > 1)
      .sort((a, b) => (a[0] as number) - (b[0] as number));
  }
}

/** Groups row indices by a key, dropping empty keys and singleton groups. */
export function groupsByKey(keys: readonly string[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  keys.forEach((k, i) => {
    if (k === '') return;
    const list = m.get(k);
    if (list === undefined) m.set(k, [i]);
    else list.push(i);
  });
  for (const [k, v] of [...m.entries()]) if (v.length < 2) m.delete(k);
  return m;
}
