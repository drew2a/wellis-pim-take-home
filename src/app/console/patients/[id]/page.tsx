// The patient (R-C9): the record we own, everything that belongs to it, and **how it came to look
// the way it does** — which is what the audit timeline is for.
//
// Records are resolved through the membership function of ADR-0008 item 2, never through the copied
// `patient_id`: a merge moves no row, so a patient's intakes and consent events are its own and
// those of every record merged into it (ADR-0011 item 3).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';

import { requireReviewer } from '@/console/guard';
import { getDb } from '@/db/client';
import { dayOf } from '@/intake/today';
import { patientDetail } from '@/repo/patient-detail';
import {
  Badge,
  Caption,
  Card,
  Definitions,
  Hint,
  Page,
  PageHeader,
  Raw,
  SectionTitle,
  StateBadge,
  Table,
  humanise,
  toneForReviewItem,
  type Column,
  type Definition,
} from '@/ui';

import { entryValue } from './entry';
import { RevealBsn } from './RevealBsn';

export const dynamic = 'force-dynamic';

/** Enough to read a record's history without a second page; the whole of it is in the database. */
const TIMELINE_SHOWN = 120;

const text = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

export default async function PatientPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}): Promise<ReactElement> {
  await requireReviewer();
  const detail = await patientDetail(getDb(), (await params).id);
  if (detail === null) notFound();

  const { patient } = detail;
  const record: Definition[] = [
    { term: 'name', value: text(patient.fullName) },
    { term: 'date of birth', value: text(patient.dob) },
    { term: 'email', value: <Raw>{text(patient.email)}</Raw> },
    {
      term: 'bsn',
      value:
        detail.maskedBsn === null ? (
          <Caption>none</Caption>
        ) : (
          <RevealBsn patientId={patient.id} masked={detail.maskedBsn} />
        ),
    },
    { term: 'bsn check', value: patient.bsnCheck },
    { term: 'phone', value: <Raw>{text(patient.phone)}</Raw> },
    { term: 'city', value: text(patient.city) },
    { term: 'sex', value: patient.sex },
    {
      term: 'weight / height',
      value: `${text(patient.weightKg)} kg · ${text(patient.heightCm)} cm`,
    },
    { term: 'status', value: <Badge tone="info">{patient.status}</Badge> },
    { term: 'signed up', value: text(patient.signupDate) },
    { term: 'source', value: text(patient.source) },
    { term: 'built from', value: <Raw>{detail.legacyIds.join(', ') || 'the intake form'}</Raw> },
  ];

  const intakeColumns: readonly Column<(typeof detail.intakes)[number]>[] = [
    {
      header: 'Intake',
      cell: (row) => (
        <Link href={`/console/intakes/${row.id}`}>{row.intakeId ?? 'new intake'}</Link>
      ),
    },
    { header: 'State', cell: (row) => <StateBadge state={row.state} /> },
    { header: 'Outcome', cell: (row) => humanise(row.outcome) },
    { header: 'Submitted', cell: (row) => row.submittedAt ?? '—' },
    {
      header: "Today's rules",
      cell: (row) =>
        row.shadow === null ? (
          <Caption>—</Caption>
        ) : (
          <Caption>{`${humanise(row.shadow.outcome)} (${row.shadow.rulesetVersion})`}</Caption>
        ),
    },
  ];

  return (
    <Page>
      <PageHeader title={patient.fullName}>
        <Link href="/console">Back to the queue</Link>
      </PageHeader>

      {detail.survivorOfMerge !== null && (
        <Hint>
          This record was merged away. Its records now belong to{' '}
          <Link href={`/console/patients/${detail.survivorOfMerge}`}>the surviving record</Link>.
        </Hint>
      )}

      <Card>
        <Definitions items={record} />
      </Card>

      {detail.mergedAway.length > 0 && (
        <>
          <SectionTitle>Records merged into this one</SectionTitle>
          <Card>
            <Definitions
              items={detail.mergedAway.map((row) => ({
                term: row.name,
                value: <Link href={`/console/patients/${row.id}`}>{row.id}</Link>,
              }))}
            />
          </Card>
        </>
      )}

      <SectionTitle>Consent</SectionTitle>
      <Card>
        <Definitions
          items={detail.consent.map((row) => ({
            term: row.type,
            value: (
              <span>
                <Badge tone={row.state === 'granted' ? 'good' : 'warn'}>
                  {humanise(row.state)}
                </Badge>
                {row.establishedByHand && <Caption> established by a reviewer</Caption>}
              </span>
            ),
          }))}
        />
        {detail.consentEvents.length === 0 ? (
          <Hint>No event in the log.</Hint>
        ) : (
          <Definitions
            items={detail.consentEvents.map((event, index) => ({
              term: String(index + 1),
              value: `${event.at.toISOString()} · ${event.type} ${event.action}${event.version === null ? '' : ` (${event.version})`}`,
            }))}
          />
        )}
      </Card>

      <SectionTitle>Intakes</SectionTitle>
      <Table
        columns={intakeColumns}
        rows={detail.intakes}
        rowKey={(row) => row.id}
        empty="No intake belongs to this record."
      />

      <SectionTitle>Open items</SectionTitle>
      {detail.openItems.length === 0 ? (
        <Hint>Nothing open about this patient.</Hint>
      ) : (
        <Card>
          <Definitions
            items={detail.openItems.map((row) => ({
              key: row.id,
              term: '',
              value: (
                <span>
                  <Badge tone={toneForReviewItem(row.type)}>{humanise(row.type)}</Badge>{' '}
                  <Link href={`/console/items/${row.id}`}>{row.title}</Link>
                </span>
              ),
            }))}
          />
        </Card>
      )}

      <SectionTitle>How this record came to look the way it does</SectionTitle>
      <Card>
        <Definitions
          items={detail.timeline.slice(0, TIMELINE_SHOWN).map((entry) => ({
            term: `${dayOf(entry.at)} · ${entry.actor}`,
            value: entryValue(entry),
          }))}
        />
        {detail.timeline.length > TIMELINE_SHOWN && (
          <Hint>{`…and ${detail.timeline.length - TIMELINE_SHOWN} older entries.`}</Hint>
        )}
      </Card>

      <SectionTitle>The rows as exported</SectionTitle>
      <Card>
        <Hint>
          Read-only, untrimmed, exactly as the export gave them (R-A8) — with <Raw>bsn</Raw> masked
          as it is everywhere else, because reading the number is a route that records the look.
        </Hint>
        {[...detail.rawPatients, ...detail.rawIntakes].map((row, index) => (
          <Definitions
            key={index}
            items={Object.entries(row).map(([term, given]) => ({
              term,
              value: <Raw>{text(given)}</Raw>,
            }))}
          />
        ))}
      </Card>
    </Page>
  );
}
