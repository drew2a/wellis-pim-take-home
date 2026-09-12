import { readExportFiles } from './src/import/source/files';
import { parseCsv } from './src/import/source/csv';
import { PATIENTS_HEADER, INTAKES_HEADER, byHeader } from './src/import/source/layout';
import { mapPatient } from './src/import/mapper/patient';
import { mapIntake } from './src/import/mapper/intake';
import { loadRules } from './src/rules/load';
import { candidateGroups, survivorOfGroup, type IdentityRow } from './src/import/identity/candidates';

const files = readExportFiles('legacy_export');
const ctx = { asOf: '2026-09-08', rules: loadRules() };
const patients = parseCsv(files['patients.csv'].bytes, PATIENTS_HEADER).map((r) =>
  mapPatient(byHeader(PATIENTS_HEADER, r.fields), ctx),
);
const intakes = parseCsv(files['intakes.csv'].bytes, INTAKES_HEADER).map((r) =>
  mapIntake(byHeader(INTAKES_HEADER, r.fields), ctx),
);
const intakeCount = new Map<string, number>();
for (const i of intakes) intakeCount.set(i.legacyPatientId, (intakeCount.get(i.legacyPatientId) ?? 0) + 1);

const rows: IdentityRow[] = patients.map((p) => ({
  legacyId: p.legacyId,
  fullName: p.canonical.fullName,
  dob: p.canonical.dob,
  email: p.canonical.email,
  bsn: p.canonical.bsn,
  phone: p.canonical.phone,
  sex: p.canonical.sex,
  city: p.canonical.city,
  weightKg: p.canonical.weightKg,
  heightCm: p.canonical.heightCm,
  status: p.canonical.status,
  signupDate: p.canonical.signupDate,
  source: p.canonical.source,
  intakeCount: intakeCount.get(p.legacyId) ?? 0,
}));

const groups = candidateGroups(rows);
const sizes = new Map<number, number>();
for (const g of groups) sizes.set(g.members.length, (sizes.get(g.members.length) ?? 0) + 1);
const tiers = { 1: 0, 2: 0, 3: 0 } as Record<number, number>;
for (const g of groups) tiers[g.tier] += 1;
console.log('groups', groups.length, 'rows', groups.reduce((n, g) => n + g.members.length, 0), 'sizes', [...sizes]);
console.log('tiers', tiers);
const contradiction = new Map<string, number>();
for (const g of groups.filter((x) => x.tier === 3)) {
  const key = g.contradictions.join('+');
  contradiction.set(key, (contradiction.get(key) ?? 0) + 1);
}
console.log('tier 3 by contradiction', [...contradiction]);
console.log('tier 2 differences', groups.filter((g) => g.tier === 2).map((g) => g.differences.join('+')));
// gained fields on tier-1 merges, and the survivor rules
const gained = new Map<string, number>();
const rulesUsed = new Map<string, number>();
for (const g of groups.filter((x) => x.tier === 1)) {
  const { survivor, losers, rule } = survivorOfGroup(g.members);
  rulesUsed.set(rule, (rulesUsed.get(rule) ?? 0) + 1);
  for (const field of g.differences) gained.set(field, (gained.get(field) ?? 0) + 1);
  void survivor; void losers;
}
console.log('tier-1 differences (fields a survivor could gain)', [...gained]);
console.log('tier-1 survivor rules', [...rulesUsed]);
const named = ['Sem de Boer', 'Annelies Rossi', 'Teun Kowalski', 'Luuk-L Dijkstra'];
for (const g of groups) {
  if (!g.members.some((m) => named.includes(m.fullName))) continue;
  console.log('tier', g.tier, g.contradictions.join(','), '|', g.members.map((m) => `${m.legacyId} ${m.fullName} ${m.dob} ${m.email} ${m.status} ${m.signupDate} intakes=${m.intakeCount}`).join(' || '));
}
