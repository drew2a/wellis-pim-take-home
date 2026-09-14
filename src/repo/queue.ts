// The work queue (R-C2, R-C3): one list combining the two sources of work — review items the
// import could not decide, and intakes waiting for a person. One query, because they are one
// queue: a reviewer's day is not two screens (ASSIGNMENT.md §3C).
//
// Read by a server component through this module, never by SQL in a page (ADR-0024).
import { sql, type SQL } from 'drizzle-orm';

import type { Queryable } from '@/db/queryable';
import { intakeStateEnum, reviewItemTypeEnum, type ReviewItemStatus } from '@/db/schema';
import { CLINIC_TIME_ZONE, dayOf } from '@/intake/today';
import type { IntakeState } from '@/intake/machine';
import type { ReviewItemType } from '@/import/review/items';

export type QueueKind = 'review_item' | 'intake';
export type QueueAge = 'today' | 'week' | 'older';

export interface QueueRow {
  readonly kind: QueueKind;
  readonly id: string;
  /** A review item's type, or an intake's state: what kind of work this row is. */
  readonly type: string;
  readonly title: string;
  /** The surviving patient, resolved through `merged_into` (ADR-0008 item 2), or null. */
  readonly patientId: string | null;
  readonly patientName: string | null;
  /** When the work arrived, as an instant; null when nothing dates it (ADR-0023 item 2). */
  readonly age: Date | null;
  readonly status: string;
}

export interface QueueFilters {
  readonly types: readonly ReviewItemType[];
  readonly states: readonly IntakeState[];
  readonly status: ReviewItemStatus;
  readonly age?: QueueAge | undefined;
  readonly limit?: number | undefined;
}

export interface QueuePage {
  readonly rows: readonly QueueRow[];
  /** True when the filter matches more rows than `limit` returned; the counts give the totals. */
  readonly more: boolean;
}

export interface QueueCounts {
  readonly items: Readonly<Record<ReviewItemType, number>>;
  readonly intakes: Readonly<Record<IntakeState, number>>;
}

/**
 * Enough that the default view — every open item plus every intake waiting for a person — arrives
 * whole, so nothing a reviewer is meant to act on today is on a page that does not exist. A filter
 * that selects the 2068 legacy approvals is capped, and says so.
 */
const DEFAULT_LIMIT = 500;

/**
 * The queue a reviewer lands on: everything still open, and every intake waiting for a person.
 * `auto_cleared` is "clear for doctor review" and `auto_rejected` that nobody opens is a machine
 * taking the last word on a person's eligibility — neither is "done", so both are in the view a
 * reviewer works rather than one filter click away. Out of it: `draft` and `submitted` (nobody is
 * waiting yet), `approved` and `rejected` (decided), and the `legacy_*` history, because a queue
 * that opened with 2917 legacy rows in it would not be a queue (`docs/reviewer-day.md`).
 */
export const DEFAULT_FILTERS: QueueFilters = {
  types: reviewItemTypeEnum.enumValues,
  states: ['auto_flagged', 'auto_rejected', 'auto_cleared', 'in_review'],
  status: 'open',
};

/**
 * Every patient's surviving id, so the queue names the record a reviewer can actually open. A
 * merged-away patient still carries review items and intakes, and joining `patient_id` alone would
 * show a row nobody works on any more (ADR-0011 item 3).
 */
const SURVIVORS = sql`
  survivors as (
    select id, id as survivor_id from patients where merged_into is null
    union
    select p.id, s.survivor_id from patients p join survivors s on p.merged_into = s.id
  )
`;

/** Midnight of a clinic day, as an instant. The day is the clinic's, never UTC (ADR-0017). */
const startOfDay = (iso: string): SQL =>
  sql`(${iso}::date)::timestamp at time zone ${CLINIC_TIME_ZONE}`;

function ageCondition(age: QueueAge | undefined, now: Date): SQL {
  if (age === undefined) return sql`true`;
  const today = startOfDay(dayOf(now));
  const weekStart = startOfDay(dayOf(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)));
  // A row nothing dates matches no age filter: it cannot be said to be from this week or before it.
  if (age === 'today') return sql`age >= ${today}`;
  if (age === 'week') return sql`age >= ${weekStart}`;
  return sql`age < ${weekStart}`;
}

// An empty selection is `false` rather than an empty `in ()`, which is a syntax error: a reviewer
// who has unticked every type is asking for nothing, not for everything.
const inList = (column: SQL, values: readonly string[]): SQL =>
  values.length === 0 ? sql`false` : sql`${column} in ${[...values]}`;

/**
 * The order the queue is worked in: the intakes waiting for a person first, then the review items,
 * each group oldest first (`docs/reviewer-day.md`). The two sources are not equally urgent — a
 * patient who submitted this morning is waiting for a decision, a consent gap from 2023 is not —
 * and age alone cannot separate them: after a fresh import every review item carries the import
 * moment as its `created_at`, so a new intake lands among hundreds of same-aged rows arbitrarily.
 * Nothing beyond this is sortable (a scope cut, R-S4).
 */
const WORK_FIRST = sql`(case when kind = 'intake' then 0 else 1 end)`;

/** One page of the queue, in the order `WORK_FIRST` describes. */
export async function queuePage(
  db: Queryable,
  filters: QueueFilters,
  now = new Date(),
): Promise<QueuePage> {
  const limit = filters.limit ?? DEFAULT_LIMIT;
  const rows = await db.execute<{
    kind: QueueKind;
    id: string;
    type: string;
    title: string;
    patient_id: string | null;
    patient_name: string | null;
    age: Date | string | null;
    status: string;
  }>(sql`
    with recursive ${SURVIVORS},
    work as (
      select
        'review_item' as kind,
        ri.id::text as id,
        ri.type::text as type,
        ri.title as title,
        p.id::text as patient_id,
        p.full_name as patient_name,
        ri.created_at as age,
        ri.status::text as status
      from review_items ri
      left join survivors sv on sv.id = ri.patient_id
      left join patients p on p.id = sv.survivor_id
      where ${inList(sql`ri.type::text`, filters.types)} and ri.status::text = ${filters.status}

      union all

      select
        'intake' as kind,
        i.id::text as id,
        i.state::text as type,
        coalesce(i.intake_id, 'new intake') as title,
        p.id::text as patient_id,
        p.full_name as patient_name,
        -- A legacy intake is as old as the questionnaire it came from: its audit entries all carry
        -- the one timestamp of the import transaction, which would date 2917 rows to one day
        -- (ADR-0023 item 2). A new-flow intake is as old as its first answer (ADR-0016).
        case
          when i.created_by_run is not null
            then (i.submitted_at::date)::timestamp at time zone ${CLINIC_TIME_ZONE}
          else (
            select min(a.at) from audit_entries a
            where a.entity_type = 'intake' and a.entity_id = i.id::text
          )
        end as age,
        i.state::text as status
      from intakes i
      left join survivors sv on sv.id = i.patient_id
      left join patients p on p.id = sv.survivor_id
      where ${inList(sql`i.state::text`, filters.states)}
    )
    select * from work
    where ${ageCondition(filters.age, now)}
    order by ${WORK_FIRST}, age asc nulls last, id asc
    limit ${limit + 1}
  `);

  const page = [...rows];
  const more = page.length > limit;
  return {
    rows: page.slice(0, limit).map((row) => ({
      kind: row.kind,
      id: row.id,
      type: row.type,
      title: row.title,
      patientId: row.patient_id,
      patientName: row.patient_name,
      age: row.age === null ? null : new Date(row.age),
      status: row.status,
    })),
    more,
  };
}

/**
 * How much of each kind of work there is, whatever is on screen (R-C3: "counts per type visible
 * without clicking"). Counted by the database, not by the rows the page happens to hold, so a
 * filter that returns one page still says how many there are.
 */
export async function queueCounts(
  db: Queryable,
  status: ReviewItemStatus = 'open',
): Promise<QueueCounts> {
  const itemRows = await db.execute<{ type: string; n: string }>(
    sql`select type::text as type, count(*) as n from review_items where status::text = ${status} group by 1`,
  );
  const intakeRows = await db.execute<{ state: string; n: string }>(
    sql`select state::text as state, count(*) as n from intakes group by 1`,
  );

  // Every enum value is a key, so a type with no work is a zero and not a gap: the filter list is
  // the enum, and a missing key would quietly drop a filter (ADR-0023 item 1).
  const items = Object.fromEntries(
    reviewItemTypeEnum.enumValues.map((type) => [type, 0]),
  ) as Record<ReviewItemType, number>;
  for (const row of itemRows) items[row.type as ReviewItemType] = Number(row.n);

  const intakes = Object.fromEntries(
    intakeStateEnum.enumValues.map((state) => [state, 0]),
  ) as Record<IntakeState, number>;
  for (const row of intakeRows) intakes[row.state as IntakeState] = Number(row.n);

  return { items, intakes };
}
