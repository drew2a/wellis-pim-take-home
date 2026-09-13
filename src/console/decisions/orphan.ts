// Resolving an `orphan_intake`: 21 intakes that reference a patient who is in neither
// `patients.csv` nor the consent log, and cannot be repaired from the export (ADR-0006).
//
// Two answers, and neither of them invents a patient. "Create a patient from the intake" is not
// offered anywhere, because the intake carries no identity fields — no name, no date of birth, no
// email — and a row with none of those is a fabricated record. A null reference plus an open item
// says what we actually know.
import { z } from 'zod';

import type { reviewItems } from '@/db/schema';

import { DecisionError, type Decision } from './types';

export const orphanRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('attach'),
      note: z.string().trim().min(1, 'say why, in a sentence'),
      patientId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal('leave_unresolved'),
      note: z.string().trim().min(1, 'say why, in a sentence'),
    })
    .strict(),
]);

export type OrphanRequest = z.infer<typeof orphanRequestSchema>;

export function decideOrphan(
  item: typeof reviewItems.$inferSelect,
  request: OrphanRequest,
  patientExists: boolean,
): Decision {
  if (item.intakeId === null) {
    throw new DecisionError(`review item ${item.id} names no intake to attach`);
  }
  if (request.action === 'leave_unresolved') {
    // An unresolved orphan is an acceptable outcome, and the report counts them (ADR-0006).
    return {
      outcome: 'dismissed',
      note: request.note,
      changes: [],
      resolution: { action: 'leave_unresolved' },
    };
  }
  if (!patientExists) throw new DecisionError('that patient does not exist');

  return {
    outcome: 'resolved',
    note: request.note,
    changes: [
      {
        entityType: 'intake',
        entityId: item.intakeId,
        field: 'patient_id',
        value: request.patientId,
      },
    ],
    resolution: { action: 'attach', patient: request.patientId },
  };
}
