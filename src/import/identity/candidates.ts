// Duplicate-patient candidates and their three tiers (ADR-0006). Pure: this module reads mapped
// rows and decides nothing about the database. Deterministic and explainable (§3B): four exact
// keys after the normalisation of ADR-0005, no similarity score, no threshold to tune.
//
// A name alone is never a key: 618 folded names cover 1470 rows in this export, so grouping by
// name would merge strangers. Folded name *with* date of birth is.

/** The fields a candidate decision reads. `intakeCount` decides the survivor, not identity. */
export interface IdentityRow {
  readonly legacyId: string;
  readonly fullName: string;
  readonly dob: string | null;
  readonly email: string | null;
  readonly bsn: string | null;
  readonly phone: string | null;
  /** `unknown` counts as empty: an unmapped spelling neither blocks a merge nor forces one. */
  readonly sex: string;
  readonly city: string | null;
  readonly weightKg: string | null;
  readonly heightCm: number | null;
  /** `unknown` counts as empty, as `sex` does (ADR-0011 item 7). */
  readonly status: string;
  readonly signupDate: string | null;
  readonly source: string | null;
  readonly intakeCount: number;
}

export type KeyKind = 'email' | 'bsn' | 'phone' | 'name_dob';

export interface CandidateKey {
  readonly kind: KeyKind;
  readonly value: string;
}

export type Tier = 1 | 2 | 3;

export interface CandidateGroup {
  /** Two or more rows, in legacy id order. */
  readonly members: readonly IdentityRow[];
  /** The keys that put them in one group, in kind order. */
  readonly matchedKeys: readonly CandidateKey[];
  readonly tier: Tier;
  /** Fields that contradict across the group; empty unless the tier is 3. */
  readonly contradictions: readonly string[];
  /** Fields on which the rows are not identical, contradictions included. */
  readonly differences: readonly string[];
}

/** Case and inner whitespace, the same folding the profile applies (`scripts/profile/util.ts`). */
export function foldName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, ' ');
}

/**
 * The four exact keys of ADR-0006. A null value is no key: a placeholder email and an unresolved
 * internal-space address are already null in the canonical row (ADR-0005), and grouping on the
 * absence of a value would put every incomplete record in one group.
 */
export function keysOf(row: IdentityRow): CandidateKey[] {
  const keys: CandidateKey[] = [];
  if (row.email !== null) keys.push({ kind: 'email', value: row.email });
  if (row.bsn !== null) keys.push({ kind: 'bsn', value: row.bsn });
  if (row.phone !== null) keys.push({ kind: 'phone', value: row.phone });
  if (row.dob !== null && row.fullName.trim() !== '') {
    keys.push({ kind: 'name_dob', value: `${foldName(row.fullName)}|${row.dob}` });
  }
  return keys;
}

// The person fields a merge compares. `source` and `signup_date` are absent by decision: they
// describe the row, not the person, and two rows from two funnels on two dates is exactly the
// "signed up twice" the export notes describe (ADR-0006).
const PERSON_FIELDS = [
  'full_name',
  'dob',
  'email',
  'sex',
  'bsn',
  'phone',
  'city',
  'weight_kg',
  'height_cm',
  'status',
] as const;

type PersonField = (typeof PERSON_FIELDS)[number];

/**
 * A contradiction is a fact about the person that cannot be true twice. A different email is not
 * one — signing up twice with two addresses is the case ops describes — but a different name or
 * date of birth on one bsn or phone is, and so is a commercial standing that says active on one
 * row and churned on the other (ADR-0006's three tier-3 examples).
 */
const CONTRADICTION_FIELDS: readonly PersonField[] = ['full_name', 'dob', 'status'];

/** Identity proper: tier 1 needs all three present and identical. */
const IDENTITY_FIELDS: readonly PersonField[] = ['full_name', 'dob', 'email'];

function valueOf(row: IdentityRow, field: PersonField): string | null {
  switch (field) {
    case 'full_name': {
      const folded = foldName(row.fullName);
      return folded === '' ? null : folded;
    }
    case 'dob':
      return row.dob;
    case 'email':
      return row.email;
    case 'sex':
      return row.sex === 'unknown' ? null : row.sex;
    case 'bsn':
      return row.bsn;
    case 'phone':
      return row.phone;
    case 'city':
      return row.city;
    case 'weight_kg':
      return row.weightKg;
    case 'height_cm':
      return row.heightCm === null ? null : String(row.heightCm);
    case 'status':
      return row.status === 'unknown' ? null : row.status;
  }
}

/** The distinct non-empty values of a field across the group. */
function present(members: readonly IdentityRow[], field: PersonField): string[] {
  return [...new Set(members.map((row) => valueOf(row, field)).filter((v) => v !== null))];
}

/** Held by every member, and the same value: what tier 1 demands of the three identity fields. */
function identicalAcross(members: readonly IdentityRow[], field: PersonField): boolean {
  const values = members.map((row) => valueOf(row, field));
  return new Set(values).size === 1 && values[0] !== null;
}

/** Not the same everywhere: two values, or held on one side and empty on the other. */
function differs(members: readonly IdentityRow[], field: PersonField): boolean {
  const values = members.map((row) => valueOf(row, field));
  const distinct = new Set(values);
  return distinct.size > 1 && !(distinct.size === 1 && values[0] === null);
}

export function classify(members: readonly IdentityRow[]): {
  tier: Tier;
  contradictions: string[];
  differences: string[];
} {
  const differences = PERSON_FIELDS.filter((field) => differs(members, field));
  const contradictions = CONTRADICTION_FIELDS.filter((field) => present(members, field).length > 1);
  if (contradictions.length > 0) return { tier: 3, contradictions, differences };

  // Tier 1 is `CLAUDE.md` §5's deliberate exception: literally identical on identity and
  // non-contradictory on everything else, where "non-contradictory" means equal after
  // normalisation or empty on one side. Everything else is a decision for a human.
  const identity = IDENTITY_FIELDS.every((field) => identicalAcross(members, field));
  const nonContradictory = PERSON_FIELDS.every((field) => present(members, field).length <= 1);
  return { tier: identity && nonContradictory ? 1 : 2, contradictions: [], differences };
}

/**
 * Groups rows by the union of their keys: two rows are candidates when they share any one of the
 * four, and a group is the transitive closure of that relation.
 */
export function candidateGroups(rows: readonly IdentityRow[]): CandidateGroup[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const seen = parent.get(id);
    if (seen === undefined || seen === id) return id;
    const root = find(seen);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const [rootA, rootB] = [find(a), find(b)];
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  const byKey = new Map<string, string[]>();
  for (const row of rows) {
    parent.set(row.legacyId, row.legacyId);
    for (const key of keysOf(row)) {
      const id = `${key.kind}:${key.value}`;
      const holders = byKey.get(id) ?? [];
      holders.push(row.legacyId);
      byKey.set(id, holders);
    }
  }
  for (const holders of byKey.values()) {
    for (const legacyId of holders.slice(1)) union(holders[0] as string, legacyId);
  }

  const byRoot = new Map<string, IdentityRow[]>();
  for (const row of rows) {
    const root = find(row.legacyId);
    byRoot.set(root, [...(byRoot.get(root) ?? []), row]);
  }

  const groups: CandidateGroup[] = [];
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => (a.legacyId < b.legacyId ? -1 : 1));
    const ids = new Set(sorted.map((row) => row.legacyId));
    const matchedKeys = [...byKey.entries()]
      .filter(([, holders]) => holders.length > 1 && holders.every((id) => ids.has(id)))
      .map(([id]) => {
        const separator = id.indexOf(':');
        return { kind: id.slice(0, separator) as KeyKind, value: id.slice(separator + 1) };
      })
      .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
    groups.push({ members: sorted, matchedKeys, ...classify(sorted) });
  }
  return groups.sort((a, b) =>
    (a.members[0] as IdentityRow).legacyId < (b.members[0] as IdentityRow).legacyId ? -1 : 1,
  );
}

export interface Survivor {
  readonly survivor: IdentityRow;
  readonly losers: readonly IdentityRow[];
  /** The clause of ADR-0006's rule that decided it, for the merge's audit reason. */
  readonly rule: string;
}

/**
 * ADR-0006's survivor rule, in order: the row with intakes; if both or neither, the later signup;
 * if equal, the lower legacy id. A row the export gave no readable signup date counts as the
 * earlier one — the dated row is the one we can place.
 */
export function survivorOfGroup(members: readonly IdentityRow[]): Survivor {
  const withIntakes = members.filter((row) => row.intakeCount > 0);
  const rule =
    withIntakes.length === 1
      ? 'survivor is the only row with intakes'
      : sameSignup(members)
        ? 'survivor has the lower legacy id'
        : 'survivor signed up later';
  const survivor =
    withIntakes.length === 1
      ? (withIntakes[0] as IdentityRow)
      : [...members].sort(byLaterSignupThenLowerId)[0];
  return {
    survivor: survivor as IdentityRow,
    losers: members.filter((row) => row.legacyId !== (survivor as IdentityRow).legacyId),
    rule,
  };
}

const sameSignup = (members: readonly IdentityRow[]): boolean =>
  new Set(members.map((row) => row.signupDate ?? '')).size === 1;

function byLaterSignupThenLowerId(a: IdentityRow, b: IdentityRow): number {
  const [left, right] = [a.signupDate ?? '', b.signupDate ?? ''];
  if (left !== right) return left < right ? 1 : -1;
  return a.legacyId < b.legacyId ? -1 : 1;
}
