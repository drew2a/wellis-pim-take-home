// The mapper's output vocabulary (ADR-0005 layer 1). A column function returns the canonical
// value, the normalisation records that explain every difference from raw, and flags: facts the
// mapper could not decide and hands on. The mapper builds no review item; the review layer turns
// flags into items. Nothing here touches I/O.
import type { RuleCode } from './rule-codes';

export interface RecordDraft {
  readonly field: string;
  /** The value before this rule: the raw string, or the previous rule's `to` when rules chain. */
  readonly from: string;
  /** Null when the rule blanks the value (ADR-0009 item 1). */
  readonly to: string | null;
  readonly ruleCode: RuleCode;
  /** Per-row detail merged over the rule's static evidence when the record is stored. */
  readonly detail?: Readonly<Record<string, unknown>>;
}

export type Flag =
  | { readonly kind: 'email_placeholder'; readonly field: 'email'; readonly raw: string }
  | {
      readonly kind: 'email_internal_space';
      readonly field: 'email';
      readonly raw: string;
      readonly proposed: string;
    }
  | {
      readonly kind: 'date_impossible';
      readonly field: string;
      readonly raw: string;
      readonly read: string;
      readonly reason: 'after_as_of' | 'age_above_100_at_signup';
    }
  | { readonly kind: 'date_unreadable'; readonly field: string; readonly raw: string }
  | { readonly kind: 'bsn_invalid'; readonly field: 'bsn'; readonly raw: string }
  | { readonly kind: 'bsn_malformed'; readonly field: 'bsn'; readonly raw: string }
  | {
      readonly kind: 'phone_unparsed';
      readonly field: 'phone';
      readonly raw: string;
      readonly proposed: string | null;
    }
  | { readonly kind: 'vocabulary_unseen'; readonly field: string; readonly raw: string }
  | { readonly kind: 'weight_unit_missing'; readonly field: 'weight_kg'; readonly raw: string }
  | {
      readonly kind: 'implausible';
      readonly field: 'weight_kg' | 'height_cm';
      readonly raw: string;
      readonly value: number;
    }
  | { readonly kind: 'non_numeric'; readonly field: string; readonly raw: string }
  | { readonly kind: 'timestamp_unparsed'; readonly field: 'at'; readonly raw: string };

export interface Mapped<T> {
  readonly value: T;
  readonly records: readonly RecordDraft[];
  readonly flags: readonly Flag[];
}

export const unchanged = <T>(value: T): Mapped<T> => ({ value, records: [], flags: [] });

export const mapped = <T>(
  value: T,
  records: readonly RecordDraft[] = [],
  flags: readonly Flag[] = [],
): Mapped<T> => ({ value, records, flags });
