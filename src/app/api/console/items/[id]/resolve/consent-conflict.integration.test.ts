// ADR-0025 end to end, over the seven items the importer actually raises — not over fixtures.
//
// The bug this pins: `derivedConsentState` looked `consent_states` up by `item.field`, which holds
// `consent_state` and not a consent type, so every conflict item derived `none`. The detail page
// then rendered the non-conflict banner and passed `conflicted: false` to `ConsentDecision`, which
// offers the two establish buttons on nothing else — and the route, handed the same `none`, would
// have refused a hand-made request too. The whole ADR-0025 path was unreachable, and the unit and
// route tests missed it because their fixtures put the type in `field`.
//
// It runs the real import so that the items under test are the exported ones, payload and all.
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { consentStates, reviewers, reviewItems } from '@/db/schema';
import { loadEnv } from '@/env';
import { runImport } from '@/import/run';
import { derivedConsentState } from '@/repo/items';
import { survivorOf } from '@/repo/membership';
import { loadRules } from '@/rules/load';
import { createTestDatabase, type TestDatabase, type TestDb } from '@/test/database';

const holder = vi.hoisted((): { db: unknown } => ({ db: undefined }));
vi.mock('@/db/client', () => ({ getDb: () => holder.db }));

const SECRET = loadEnv().CONSOLE_SECRET;

const { POST: resolveItem } = await import('./route');
const { SESSION_COOKIE, signSession } = await import('@/console/session');

let database: TestDatabase;
let db: TestDb;
let reviewerId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  holder.db = db;
  await database.migrate();
  await runImport(db, {
    exportDir: 'legacy_export',
    asOf: '2026-09-08',
    dryRun: false,
    rules: loadRules(),
  });
  const [row] = await db
    .insert(reviewers)
    .values({ name: 'Sanne Bakker' })
    .returning({ id: reviewers.id });
  reviewerId = row?.id ?? '';
}, 120_000);

afterAll(async () => {
  await database.drop();
});

const post = (id: string, body: unknown): Promise<Response> =>
  resolveItem(
    new Request(`http://localhost/api/console/items/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { cookie: `${SESSION_COOKIE}=${signSession(reviewerId, new Date(), SECRET)}` },
    }),
    { params: Promise.resolve({ id }) },
  );

const conflictItems = (): Promise<(typeof reviewItems.$inferSelect)[]> =>
  db
    .select()
    .from(reviewItems)
    .where(
      and(eq(reviewItems.type, 'consent'), like(reviewItems.dedupeKey, '%|CONSENT_CONFLICT|%')),
    )
    .orderBy(reviewItems.dedupeKey);

describe('the seven logs that contradict themselves', () => {
  it('shows each of them as a conflict, which is what puts both establish buttons on the screen', async () => {
    const items = await conflictItems();
    expect(items).toHaveLength(7);

    // `conflicted` in `src/app/console/items/[id]/page.tsx` is exactly this comparison, and
    // `ConsentDecision` offers "Consent is granted" / "Consent is revoked" on nothing else.
    const derived = await Promise.all(items.map((item) => derivedConsentState(db, item)));
    expect(derived).toEqual(Array.from({ length: 7 }, () => 'conflict'));
  });

  // Both buttons, over the seven: the odd ones establish granted and the even ones revoked, so
  // neither action is the only one this test ever exercises.
  it('writes the state a reviewer establishes, as human-derived, for every one of them', async () => {
    const items = await conflictItems();

    for (const [index, item] of items.entries()) {
      const state = index % 2 === 0 ? 'granted' : 'revoked';
      const response = await post(item.id, {
        action: 'set_state',
        state,
        note: 'reached the patient; consent confirmed on paper on 2026-09-11',
      });
      expect(await response.json()).toEqual({ status: 'resolved', established: state });
      expect(response.status).toBe(200);

      const survivor = await survivorOf(db, item.patientId ?? '');
      const [row] = await db
        .select()
        .from(consentStates)
        .where(
          and(eq(consentStates.patientId, survivor), eq(consentStates.type, 'data_processing')),
        );
      expect(row).toMatchObject({ state, derivationVersion: 'human' });
    }
  });
});
