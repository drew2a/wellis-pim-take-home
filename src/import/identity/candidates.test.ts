// The three tiers of ADR-0006 on the rows the ADR names, and on the shapes that decide a tier.
// Identity never auto-resolves unless the records are literally identical on identity and
// non-contradictory on everything else (`CLAUDE.md` §5); tier 1 is that exception and nothing else.
import { describe, expect, it } from 'vitest';

import { candidateGroups, classify, keysOf, survivorOfGroup, type IdentityRow } from './candidates';

const row = (overrides: Partial<IdentityRow> & { legacyId: string }): IdentityRow => ({
  fullName: 'Test Patient',
  dob: '1980-03-09',
  email: 'test@example.com',
  bsn: null,
  phone: '+31612345678',
  sex: 'female',
  city: 'Utrecht',
  weightKg: '80.0',
  heightCm: 170,
  status: 'active',
  signupDate: '2024-01-01',
  source: 'website',
  intakeCount: 0,
  ...overrides,
});

describe('candidate keys', () => {
  it('takes no key from a value the mapping could not read', () => {
    const kinds = keysOf(row({ legacyId: 'recA', email: null, bsn: null, phone: null })).map(
      (key) => key.kind,
    );

    expect(kinds).toEqual(['name_dob']);
  });

  it('needs both halves of name + dob: a name alone is never identity', () => {
    expect(keysOf(row({ legacyId: 'recA', dob: null })).map((k) => k.kind)).toEqual([
      'email',
      'phone',
    ]);
  });

  it('folds case and inner whitespace into the name half', () => {
    const [key] = keysOf(
      row({ legacyId: 'recA', fullName: 'Sem  DE Boer', email: null, phone: null }),
    );

    expect(key?.value).toBe('sem de boer|1980-03-09');
  });

  it("groups transitively: two rows sharing a phone, a third sharing the second row's email", () => {
    const rows = [
      row({ legacyId: 'recA', email: 'a@example.com' }),
      row({ legacyId: 'recB', email: 'b@example.com' }),
      row({ legacyId: 'recC', email: 'b@example.com', phone: null, dob: null }),
      row({ legacyId: 'recD', email: 'alone@example.com', phone: '+31600000000', dob: null }),
    ];

    const groups = candidateGroups(rows);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.members.map((m) => m.legacyId)).toEqual(['recA', 'recB', 'recC']);
  });
});

describe('tiers (ADR-0006)', () => {
  // Two rows of `Sem de Boer`, identical on name, dob and email and on every other person field.
  it('tier 1: literally identical on identity and non-contradictory elsewhere', () => {
    const pair = [
      row({
        legacyId: 'rec5YQX1LOnITz1b9',
        fullName: 'Sem de Boer',
        dob: '1960-02-03',
        intakeCount: 1,
      }),
      row({
        legacyId: 'rechFnT5jvsZEIUVP',
        fullName: 'Sem de Boer',
        dob: '1960-02-03',
        intakeCount: 2,
      }),
    ];

    expect(classify(pair)).toEqual({ tier: 1, contradictions: [], differences: [] });
  });

  it('tier 1 still, when a field is held on one side and empty on the other', () => {
    const pair = [
      row({ legacyId: 'recA', city: null, sex: 'unknown' }),
      row({ legacyId: 'recB', city: 'Delft' }),
    ];

    // The differing fields are what the survivor would gain, with provenance (ADR-0006).
    expect(classify(pair)).toEqual({ tier: 1, contradictions: [], differences: ['sex', 'city'] });
  });

  it('tier 2: the keys match but the identity is not fully identical', () => {
    const pair = [
      row({ legacyId: 'recA', email: 'wei.vos@example.com' }),
      row({ legacyId: 'recB', email: 'wei.vosx@example.com' }),
    ];

    expect(classify(pair)).toMatchObject({ tier: 2, contradictions: [] });
  });

  it('tier 2: an email held on one side only is not a contradiction either', () => {
    const pair = [row({ legacyId: 'recA', email: null }), row({ legacyId: 'recB' })];

    expect(classify(pair)).toMatchObject({ tier: 2 });
  });

  describe('tier 3: a shared key with contradicting facts', () => {
    it('a different name on one phone (`Luuk-L Dijkstra`)', () => {
      const pair = [
        row({ legacyId: 'recTKYmh9OlSDn0u2', fullName: 'Luuk Dijkstra', dob: '1959-11-05' }),
        row({ legacyId: 'recgGPSFUWYnhf94o', fullName: 'Luuk-L Dijkstra', dob: '1959-11-05' }),
      ];

      expect(classify(pair)).toMatchObject({ tier: 3, contradictions: ['full_name'] });
    });

    it('a different date of birth', () => {
      const pair = [
        row({ legacyId: 'recA', dob: '1980-03-09' }),
        row({ legacyId: 'recB', dob: '1980-09-03' }),
      ];

      expect(classify(pair)).toMatchObject({ tier: 3, contradictions: ['dob'] });
    });

    it('active on one row and churned on the other', () => {
      const pair = [
        row({ legacyId: 'recA', status: 'active' }),
        row({ legacyId: 'recB', status: 'churned' }),
      ];

      expect(classify(pair)).toMatchObject({ tier: 3, contradictions: ['status'] });
    });

    // 6 of the 30 shared bsns belong to clearly different people (ADR-0006).
    it('one bsn carrying two different people', () => {
      const pair = [
        row({ legacyId: 'recA', bsn: '123456782', fullName: 'Anna Bakker', dob: '1970-01-01' }),
        row({ legacyId: 'recB', bsn: '123456782', fullName: 'Piet Jansen', dob: '1991-12-30' }),
      ];

      expect(classify(pair)).toMatchObject({ tier: 3, contradictions: ['full_name', 'dob'] });
    });

    it('an unmapped status neither blocks a merge nor forces one (ADR-0011 item 7)', () => {
      const pair = [
        row({ legacyId: 'recA', status: 'unknown' }),
        row({ legacyId: 'recB', status: 'churned' }),
      ];

      expect(classify(pair)).toMatchObject({ tier: 1, contradictions: [] });
    });
  });
});

describe('the survivor rule (ADR-0006)', () => {
  it('takes the row with intakes', () => {
    const pair = [
      row({ legacyId: 'recB', intakeCount: 0, signupDate: '2025-01-01' }),
      row({ legacyId: 'recA', intakeCount: 2, signupDate: '2024-01-01' }),
    ];

    const { survivor, losers, rule } = survivorOfGroup(pair);

    expect(survivor.legacyId).toBe('recA');
    expect(losers.map((l) => l.legacyId)).toEqual(['recB']);
    expect(rule).toContain('intakes');
  });

  it('takes the later signup when both rows have intakes', () => {
    const pair = [
      row({ legacyId: 'recA', intakeCount: 1, signupDate: '2024-01-01' }),
      row({ legacyId: 'recB', intakeCount: 3, signupDate: '2025-06-01' }),
    ];

    expect(survivorOfGroup(pair).rule).toContain('later');
    expect(survivorOfGroup(pair).survivor.legacyId).toBe('recB');
  });

  it('takes the lower legacy id when the signup dates are equal', () => {
    const pair = [
      row({ legacyId: 'recB', signupDate: '2024-01-01' }),
      row({ legacyId: 'recA', signupDate: '2024-01-01' }),
    ];

    const { survivor, rule } = survivorOfGroup(pair);

    expect(survivor.legacyId).toBe('recA');
    expect(rule).toContain('lower legacy id');
  });

  it('prefers the row it can date over one the export left undated', () => {
    const pair = [
      row({ legacyId: 'recA', signupDate: null }),
      row({ legacyId: 'recB', signupDate: '2023-01-01' }),
    ];

    expect(survivorOfGroup(pair).survivor.legacyId).toBe('recB');
  });
});
