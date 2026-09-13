'use client';

// The patient-facing intake form (R-B1, R-B4): five steps, one per screen, saved to the server
// after each one. Plain on purpose — the brief asks for correct, not polished.
//
// It carries no business rules. Every message under a field is the server's own, from the Zod
// schema at the boundary, so there is exactly one definition of what a valid answer is and the
// client cannot disagree with it (`CLAUDE.md` §2, R-T4). The only client-side validation is the
// browser's `required`, which is a convenience.
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { CONSENT_TEXT, CONSENT_TEXT_VERSION } from '@/consent/text';
import type { IntakeStep } from '@/intake/answers';
import { CONDITION_OPTIONS, GLP1_OPTIONS } from '@/intake/options';

export interface Bounds {
  readonly heightCm: { readonly min: number; readonly max: number };
  readonly weightKg: { readonly min: number; readonly max: number };
}

interface Issue {
  readonly path: string;
  readonly message: string;
}

interface Submitted {
  readonly state: string;
  readonly outcome: string;
  readonly reasons: readonly string[];
  readonly rulesetVersion: string;
}

const STEPS: readonly { readonly step: IntakeStep; readonly title: string }[] = [
  { step: 'identity', title: 'About you' },
  { step: 'metrics', title: 'Height and weight' },
  { step: 'medications', title: 'Medication' },
  { step: 'conditions', title: 'Medical conditions' },
  { step: 'consent', title: 'Consent' },
];

/** Server answers for one step, built from the fields of that step. */
type StepAnswers = Record<string, unknown>;

export function IntakeForm({ bounds }: { bounds: Bounds }): ReactElement {
  const [intakeId, setIntakeId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [issues, setIssues] = useState<readonly Issue[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);

  // Identity
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  // Metrics: kept as strings so a half-typed number is not silently coerced to 0.
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  // Medication
  const [glp1Declared, setGlp1Declared] = useState<boolean | null>(null);
  const [glp1, setGlp1] = useState<string[]>([]);
  const [otherMedications, setOtherMedications] = useState('');
  // Conditions
  const [conditions, setConditions] = useState<string[]>([]);
  const [otherConditions, setOtherConditions] = useState('');
  // Consent
  const [granted, setGranted] = useState(false);

  // React runs effects twice in development, which would leave an abandoned draft behind on every
  // page load. The ref is not an optimisation: a draft is a row, and creating two for one patient
  // is exactly the kind of quiet duplication this system exists to avoid.
  const started = useRef(false);

  // The draft exists server-side before the first question is answered, so every step has
  // somewhere to be saved (ADR-0015 item 3). An abort rather than a flag: if the patient navigates
  // away mid-request, the request goes with them.
  useEffect(() => {
    if (started.current) return undefined;
    started.current = true;
    const aborter = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/intakes', { method: 'POST', signal: aborter.signal });
        if (!response.ok) throw new Error(`the server answered ${response.status}`);
        const body = (await response.json()) as { id: string };
        setIntakeId(body.id);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        setFailure('We could not start your intake. Please reload the page.');
      }
    })();
    return () => {
      aborter.abort();
    };
  }, []);

  const answersFor = useCallback(
    (step: IntakeStep): StepAnswers => {
      switch (step) {
        case 'identity':
          return { fullName, email, dob };
        case 'metrics':
          return { heightCm: Number(heightCm), weightKg: Number(weightKg) };
        case 'medications':
          return { glp1Declared: glp1Declared ?? false, glp1, otherMedications };
        case 'conditions':
          return { conditions, otherConditions };
        case 'consent':
          return { granted, textVersion: CONSENT_TEXT_VERSION };
      }
    },
    [
      fullName,
      email,
      dob,
      heightCm,
      weightKg,
      glp1Declared,
      glp1,
      otherMedications,
      conditions,
      otherConditions,
      granted,
    ],
  );

  /** Saves the current step and, on the last one, submits. The server decides both. */
  const advance = useCallback(async (): Promise<void> => {
    const current = STEPS[index];
    if (intakeId === null || current === undefined) return;
    setBusy(true);
    setIssues([]);
    setFailure(null);
    try {
      const saved = await fetch(`/api/intakes/${intakeId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ step: current.step, answers: answersFor(current.step) }),
      });
      if (saved.status === 400) {
        const body = (await saved.json()) as { issues?: Issue[] };
        setIssues(body.issues ?? []);
        return;
      }
      if (!saved.ok) throw new Error(`the server answered ${saved.status}`);

      if (index < STEPS.length - 1) {
        setIndex(index + 1);
        return;
      }

      const response = await fetch(`/api/intakes/${intakeId}/submit`, { method: 'POST' });
      if (response.status === 400) {
        const body = (await response.json()) as { issues?: Issue[] };
        setIssues(body.issues ?? []);
        return;
      }
      if (!response.ok) throw new Error(`the server answered ${response.status}`);
      setSubmitted((await response.json()) as Submitted);
    } catch {
      setFailure('We could not reach the server. Your answers so far are saved; please try again.');
    } finally {
      setBusy(false);
    }
  }, [answersFor, index, intakeId]);

  if (failure !== null && intakeId === null) return <p className="error">{failure}</p>;
  if (intakeId === null) return <p>Starting your intake…</p>;
  if (submitted !== null) return <Result submitted={submitted} />;

  const current = STEPS[index];
  if (current === undefined) return <p className="error">This form has no such step.</p>;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void advance();
      }}
    >
      <p className="progress">
        Step {index + 1} of {STEPS.length}
      </p>
      <h2>{current.title}</h2>

      {current.step === 'identity' && (
        <>
          <Field label="Full name" issue={issueFor(issues, 'fullName')}>
            <input
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
              }}
              required
            />
          </Field>
          <Field label="Email address" issue={issueFor(issues, 'email')}>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              required
            />
          </Field>
          <Field label="Date of birth" issue={issueFor(issues, 'dob')}>
            <input
              type="date"
              value={dob}
              onChange={(e) => {
                setDob(e.target.value);
              }}
              required
            />
          </Field>
        </>
      )}

      {current.step === 'metrics' && (
        <>
          <Field
            label="Height in centimetres"
            hint={`Between ${bounds.heightCm.min} and ${bounds.heightCm.max}.`}
            issue={issueFor(issues, 'heightCm')}
          >
            <input
              type="number"
              inputMode="numeric"
              value={heightCm}
              onChange={(e) => {
                setHeightCm(e.target.value);
              }}
              required
            />
          </Field>
          <Field
            label="Weight in kilograms"
            hint={`Between ${bounds.weightKg.min} and ${bounds.weightKg.max}, one decimal place.`}
            issue={issueFor(issues, 'weightKg')}
          >
            <input
              type="number"
              step="0.1"
              inputMode="decimal"
              value={weightKg}
              onChange={(e) => {
                setWeightKg(e.target.value);
              }}
              required
            />
          </Field>
        </>
      )}

      {current.step === 'medications' && (
        <>
          <Field
            label="Are you currently using a GLP-1 medication?"
            hint="These are medicines such as Ozempic, Wegovy, Mounjaro, Saxenda or Trulicity."
            issue={issueFor(issues, 'glp1Declared')}
          >
            <label className="choice">
              <input
                type="radio"
                name="glp1Declared"
                checked={glp1Declared === true}
                onChange={() => {
                  setGlp1Declared(true);
                }}
                required
              />
              Yes
            </label>
            <label className="choice">
              <input
                type="radio"
                name="glp1Declared"
                checked={glp1Declared === false}
                onChange={() => {
                  setGlp1Declared(false);
                  setGlp1([]);
                }}
              />
              No
            </label>
          </Field>

          {glp1Declared === true && (
            <Field label="Which one?" issue={issueFor(issues, 'glp1')}>
              {GLP1_OPTIONS.map((option) => (
                <label key={option.value} className="choice">
                  <input
                    type="checkbox"
                    checked={glp1.includes(option.value)}
                    onChange={() => {
                      setGlp1(toggle(glp1, option.value));
                    }}
                  />
                  {option.label}
                </label>
              ))}
            </Field>
          )}

          <Field
            label="Any other medication you take"
            hint={
              glp1Declared === true
                ? 'If your GLP-1 medication is not in the list above, write its name here.'
                : 'Leave this empty if there is none.'
            }
            issue={issueFor(issues, 'otherMedications')}
          >
            <textarea
              rows={3}
              value={otherMedications}
              onChange={(e) => {
                setOtherMedications(e.target.value);
              }}
            />
          </Field>
        </>
      )}

      {current.step === 'conditions' && (
        <>
          <Field
            label="Has a doctor diagnosed you with any of these?"
            issue={issueFor(issues, 'conditions')}
          >
            {CONDITION_OPTIONS.map((option) => (
              <label key={option.value} className="choice">
                <input
                  type="checkbox"
                  checked={conditions.includes(option.value)}
                  onChange={() => {
                    setConditions(toggle(conditions, option.value));
                  }}
                />
                {option.label}
              </label>
            ))}
          </Field>
          <Field
            label="Anything else we should know about your health"
            hint="Leave this empty if there is nothing."
            issue={issueFor(issues, 'otherConditions')}
          >
            <textarea
              rows={3}
              value={otherConditions}
              onChange={(e) => {
                setOtherConditions(e.target.value);
              }}
            />
          </Field>
        </>
      )}

      {current.step === 'consent' && (
        <>
          <p className="consent">{CONSENT_TEXT}</p>
          <p className="hint">Consent text version {CONSENT_TEXT_VERSION}.</p>
          <Field label="" issue={issueFor(issues, 'granted')}>
            <label className="choice">
              <input
                type="checkbox"
                checked={granted}
                onChange={(e) => {
                  setGranted(e.target.checked);
                }}
              />
              I have read the statement above and I agree.
            </label>
          </Field>
        </>
      )}

      {/* An issue no field on this step owns — a whole-step refinement, or a step still missing at
          submit — is shown here rather than swallowed. */}
      {issues
        .filter((issue) => !FIELDS[current.step].includes(issue.path))
        .map((issue) => (
          <p key={`${issue.path}:${issue.message}`} className="error">
            {issue.message}
          </p>
        ))}
      {failure !== null && <p className="error">{failure}</p>}

      <div className="actions">
        {index > 0 && (
          <button
            type="button"
            onClick={() => {
              setIndex(index - 1);
            }}
            disabled={busy}
          >
            Back
          </button>
        )}
        <button type="submit" disabled={busy}>
          {index < STEPS.length - 1 ? 'Next' : 'Submit'}
        </button>
      </div>
    </form>
  );
}

/** What the patient is told afterwards: the engine's own explanation lines, verbatim (R-B9). */
function Result({ submitted }: { submitted: Submitted }): ReactElement {
  const headline: Record<string, string> = {
    auto_cleared: 'Thank you — your intake is with our care team.',
    auto_flagged: 'Thank you — a member of our care team will look at your answers.',
    auto_rejected: 'Thank you. Based on your answers, our programme is not suitable for you.',
  };
  return (
    <section>
      <h2>{headline[submitted.state] ?? 'Thank you.'}</h2>
      <p>A doctor makes the final decision; nothing here is one.</p>
      <h3>What the rules found</h3>
      <ul>
        {submitted.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <p className="hint">Assessed with ruleset {submitted.rulesetVersion}.</p>
    </section>
  );
}

function Field({
  label,
  hint,
  issue,
  children,
}: {
  label: string;
  hint?: string;
  issue?: Issue | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="field">
      {label !== '' && <label className="label">{label}</label>}
      {hint !== undefined && <p className="hint">{hint}</p>}
      {children}
      {issue !== undefined && <p className="error">{issue.message}</p>}
    </div>
  );
}

/** The field paths each step renders, so an issue naming anything else is shown for the step. */
const FIELDS: Record<IntakeStep, readonly string[]> = {
  identity: ['fullName', 'email', 'dob'],
  metrics: ['heightCm', 'weightKg'],
  medications: ['glp1Declared', 'glp1', 'otherMedications'],
  conditions: ['conditions', 'otherConditions'],
  consent: ['granted', 'textVersion'],
};

const issueFor = (issues: readonly Issue[], path: string): Issue | undefined =>
  issues.find((issue) => issue.path === path);

const toggle = (values: readonly string[], value: string): string[] =>
  values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
