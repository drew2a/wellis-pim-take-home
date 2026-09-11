// Consent `at` (ADR-0007, ADR-0009 item 7): a zoneless wall time in Europe/Amsterdam becomes an
// instant, with a TIMESTAMP_ZONE_ASSUMED record per event. A wall time in the autumn fall-back
// hour has two instants: the earlier one is taken and `ambiguous` recorded. A wall time in the
// spring gap has none: the instant one hour later is taken and `nonexistent` recorded.
import { mapped, type Mapped } from './types';

export const CONSENT_ZONE = 'Europe/Amsterdam';

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/u;

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: CONSENT_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** The wall time in the zone for an instant, as `YYYY-MM-DDTHH:MM:SS`. */
function wallTimeOf(instant: Date): string {
  const p = Object.fromEntries(parts.formatToParts(instant).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

export interface ConsentInstant {
  readonly at: Date;
  readonly ambiguous: boolean;
  readonly nonexistent: boolean;
}

/**
 * Every instant whose wall time in the zone is `raw`. The zone's offsets are +01:00 and +02:00,
 * so the candidates are the wall time read as UTC minus each offset; a candidate counts when it
 * formats back to the same wall time.
 */
export function wallTimeToInstant(raw: string): ConsentInstant | null {
  const m = WALL.exec(raw);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(asUtc);
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d ||
    h > 23 ||
    mi > 59 ||
    s > 59
  ) {
    return null;
  }
  const candidates = [1, 2]
    .map((offsetHours) => new Date(asUtc - offsetHours * 3_600_000))
    .filter((candidate) => wallTimeOf(candidate) === raw)
    .sort((a, b) => a.getTime() - b.getTime());
  const [first] = candidates;
  if (first !== undefined) {
    return { at: first, ambiguous: candidates.length > 1, nonexistent: false };
  }
  // Spring gap: the offset in force before the transition (+01:00) lands after the gap.
  return { at: new Date(asUtc - 3_600_000), ambiguous: false, nonexistent: true };
}

export function mapConsentAt(raw: string): Mapped<Date | null> {
  const instant = wallTimeToInstant(raw);
  if (instant === null) {
    return mapped(null, [], [{ kind: 'timestamp_unparsed', field: 'at', raw }]);
  }
  const detail: Record<string, unknown> = { zone: CONSENT_ZONE };
  if (instant.ambiguous) detail.ambiguous = true;
  if (instant.nonexistent) detail.nonexistent = true;
  return mapped(instant.at, [
    {
      field: 'at',
      from: raw,
      to: instant.at.toISOString(),
      ruleCode: 'TIMESTAMP_ZONE_ASSUMED',
      detail,
    },
  ]);
}
