'use client';

// The records side by side, and the decision a person takes about them (R-C4, R-C5, R-C6).
//
// Per field the reviewer picks a record or types a value. Picking a record posts **which record**,
// never the value shown: `bsn` is masked on this screen, and a form that sent back what it
// displayed would write `******333` into the column. The server reads the value from the row that
// was named (ADR-0022).
//
// A merge joins **two** records, and a candidate group can hold more than two: it is the transitive
// closure over a shared key, so a new-flow submission matching a pair makes three. The reviewer
// therefore names both sides, and a value can only be picked from one of the two in the merge
// (ADR-0026 item 3). Assuming the other record was whichever one the survivor is not merged the
// wrong pair and wrote a third record's values into the survivor.
import { useState, type ReactElement, type ReactNode } from 'react';

import { useDecide } from '@/app/console/useDecide';
import {
  Caption,
  Choice,
  CompareCard,
  DecisionBar,
  DetailBody,
  DetailSection,
  ENTER,
  ErrorText,
  Hint,
  MergeFields,
  NEEDS_A_NOTE,
} from '@/ui';

export interface DecisionRow {
  readonly field: string;
  readonly values: readonly (string | null)[];
  readonly differs: boolean;
  readonly decidable: boolean;
}

export interface DecisionCandidate {
  readonly patientId: string;
  readonly label: string;
  readonly intakeCount: number;
  readonly consent: string;
  readonly legacyIds: readonly string[];
}

type Pick = { readonly index: number } | { readonly edited: string };

export function IdentityDecision({
  itemId,
  after,
  candidates,
  rows,
  children,
}: {
  readonly itemId: string;
  readonly after: string;
  readonly candidates: readonly DecisionCandidate[];
  readonly rows: readonly DecisionRow[];
  readonly children: ReactNode;
}): ReactElement {
  const decide = useDecide(`/api/console/items/${itemId}/resolve`, after);
  const [survivor, setSurvivor] = useState(0);
  const [loser, setLoser] = useState(1);
  const [picks, setPicks] = useState<Readonly<Record<string, Pick>>>({});

  const firstOther = (skip: number): number => candidates.findIndex((_, index) => index !== skip);

  /**
   * Both sides at once, and the picks dropped. A pick names a record by its position, so keeping
   * one made against a record that has just left the merge would post it as the other side's
   * value — the reviewer would see one thing and the server would write another.
   */
  const choosePair = (nextSurvivor: number, nextLoser: number): void => {
    setSurvivor(nextSurvivor);
    setLoser(nextLoser);
    setPicks({});
  };

  const inMerge = (index: number): boolean => index === survivor || index === loser;

  /**
   * The column checked before the reviewer touches anything — a preview of what the merge does
   * with a field nobody decides, not a decision taken on their behalf. That is the survivor's
   * value, except where the survivor holds none and the other record does: there the survivor
   * *gains* the field, so showing its own empty cell checked would be a lie (ADR-0022 §1).
   *
   * Nothing is posted for an untouched field either way: `picks` stays empty until a click.
   */
  const defaultColumn = (row: DecisionRow): number =>
    (row.values[survivor] ?? '') === '' && (row.values[loser] ?? '') !== '' ? loser : survivor;
  const labelOf = (index: number): string => candidates[index]?.label ?? '';

  const decisions = (): Record<string, unknown> => {
    const chosen: Record<string, unknown> = {};
    for (const [field, pick] of Object.entries(picks)) {
      if ('edited' in pick) chosen[field] = { source: 'edited', value: pick.edited };
      else chosen[field] = { source: pick.index === survivor ? 'survivor' : 'loser' };
    }
    return chosen;
  };

  if (candidates.length < 2) {
    return (
      <>
        <DetailBody>
          {children}
          <DetailSection title="Nothing to merge">
            <ErrorText>
              This item no longer has two records to compare. One of them may already have been
              merged.
            </ErrorText>
          </DetailSection>
        </DetailBody>
      </>
    );
  }

  const survivorId = candidates[survivor]?.patientId ?? '';
  const loserId = candidates[loser]?.patientId ?? '';
  const stopped = !decide.noted || decide.busy !== null;
  const describing = rows.filter((row) => !row.decidable);
  const decidable = rows.filter((row) => row.decidable);

  return (
    <>
      <DetailBody>
        {children}

        <DetailSection title="Which record survives">
          {candidates.map((candidate, index) => (
            <Choice
              key={candidate.patientId}
              type="radio"
              name="survivor"
              checked={survivor === index}
              onChange={() => {
                choosePair(index, index === loser ? firstOther(index) : loser);
              }}
            >
              {`${candidate.label} survives — ${String(candidate.intakeCount)} intakes, consent ${candidate.consent}`}
            </Choice>
          ))}
          {candidates.length > 2 && (
            <>
              <Caption>And the record merged into it</Caption>
              {candidates.map((candidate, index) =>
                index === survivor ? null : (
                  <Choice
                    key={candidate.patientId}
                    type="radio"
                    name="loser"
                    checked={loser === index}
                    onChange={() => {
                      choosePair(survivor, index);
                    }}
                  >
                    {`${candidate.label} — ${String(candidate.intakeCount)} intakes, consent ${candidate.consent}`}
                  </Choice>
                ),
              )}
              <Hint>
                A merge joins two records. Every other record in this group is left exactly as it
                is, and deciding about it is a decision of its own.
              </Hint>
            </>
          )}
        </DetailSection>

        {describing.length > 0 && (
          // Shown and not offered: these describe the row rather than the person, so the survivor
          // keeps its own whatever the other record says.
          <CompareCard
            title="What the rows say, and nobody chooses"
            columns={candidates.map((candidate) => ({ label: candidate.label }))}
            rows={describing.map((row) => ({
              field: row.field,
              values: row.values.map((value) => value ?? '—'),
              differs: row.differs,
            }))}
          />
        )}

        <MergeFields
          title="The fields the survivor keeps"
          columns={[`${labelOf(survivor)} · survives`, `${labelOf(loser)} · merged in`]}
          fields={decidable.map((row) => {
            const agreed = row.differs ? null : (row.values[survivor] ?? '—');
            const chosen = picks[row.field];
            return {
              field: row.field,
              agreed,
              options:
                agreed !== null
                  ? []
                  : [survivor, loser].map((index) => ({
                      value: row.values[index] ?? '—',
                      checked:
                        chosen === undefined
                          ? index === defaultColumn(row)
                          : 'index' in chosen && chosen.index === index,
                      onPick: () => {
                        setPicks({ ...picks, [row.field]: { index } });
                      },
                    })),
              typed: chosen !== undefined && 'edited' in chosen ? chosen.edited : '',
              onType: (value: string) => {
                setPicks({ ...picks, [row.field]: { edited: value } });
              },
              aside:
                candidates.length > 2
                  ? `${row.values
                      .flatMap((value, index) =>
                        inMerge(index) ? [] : [`${value ?? '—'} — ${labelOf(index)}`],
                      )
                      .join('  ·  ')} — not part of this merge.`
                  : null,
            };
          })}
        />
      </DetailBody>

      <DecisionBar
        note={decide.note}
        onNote={decide.setNote}
        placeholder="e.g. same person, moved in 2023; kept the newer address"
        unavailable={
          decide.noted
            ? 'Merging repoints every legacy id, recomputes the consent state and records which record supplied which field. It can be undone through the API; there is no screen for that.'
            : NEEDS_A_NOTE
        }
        error={decide.failure}
        actions={[
          {
            label: 'Merge',
            variant: 'primary',
            hint: ENTER,
            busy: decide.busy === 'merge',
            disabled: stopped,
            onPick: () => {
              decide.send('merge', {
                action: 'merge',
                survivorId,
                loserId,
                decisions: decisions(),
                note: decide.note,
              });
            },
          },
          {
            label: 'Not the same person',
            variant: 'danger',
            hint: 'N',
            busy: decide.busy === 'apart',
            disabled: stopped,
            onPick: () => {
              decide.send('apart', { action: 'not_the_same_person', note: decide.note });
            },
          },
        ]}
      />
    </>
  );
}
