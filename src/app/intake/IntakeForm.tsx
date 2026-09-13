'use client';

// The patient-facing intake form (R-B1, R-B4): five steps, one per screen, saved to the server
// after each one. The first step creates the draft, so nothing is written until the patient has
// answered something (ADR-0016).
//
// It carries no business rules. Every message under a field is the server's own, from the Zod
// schema at the boundary, so there is exactly one definition of what a valid answer is and the
// client cannot disagree with it (`CLAUDE.md` §2, R-T4). Client-side validation here is a
// convenience and nothing more: the browser's `required`, and the greyed-out button on the consent
// step. Both only decline to send a request the server would refuse anyway — `consentSchema` is
// still the one thing that decides whether consent was given (ADR-0019 item 2).
//
// It carries no styling either: every element on the screen is a component from `@/ui`, so how
// this form looks is decided there and not here (`src/ui/index.ts`).
import { useCallback, useState, type ReactElement } from 'react';

import { CONSENT_TEXT, CONSENT_TEXT_VERSION } from '@/consent/text';
import { INTAKE_STEPS, type IntakeStep } from '@/intake/answers';
import { CONDITION_OPTIONS, GLP1_OPTIONS } from '@/intake/options';
import {
  Button,
  ButtonRow,
  Card,
  Choice,
  ErrorText,
  Field,
  Prose,
  StepIndicator,
  TextAreaField,
  TextField,
} from '@/ui';

export interface Bounds {
  readonly heightCm: { readonly min: number; readonly max: number };
  readonly weightKg: { readonly min: number; readonly max: number };
  /** `YYYY-MM-DD`, from the server's day, so the date picker cannot offer a year the API refuses. */
  readonly dob: { readonly min: string; readonly max: string };
}

interface Issue {
  readonly path: string;
  readonly message: string;
}

/** The submit response as the server sends it. The patient's screen reads `state` and no more. */
interface Submitted {
  readonly state: string;
  readonly outcome: string;
  readonly reasons: readonly string[];
  readonly rulesetVersion: string;
}

const TITLES: Record<IntakeStep, string> = {
  consent: 'Consent',
  identity: 'About you',
  metrics: 'Height and weight',
  medications: 'Medication',
  conditions: 'Medical conditions',
};

/**
 * The screens, in the order `INTAKE_STEPS` gives (ADR-0019) — consent first, so no answer is sent
 * before permission to process it exists. The order is not repeated here: this form and the create
 * route read the same list, so the screen a patient sees first is the step the server expects.
 */
const STEPS: readonly { readonly step: IntakeStep; readonly title: string }[] = INTAKE_STEPS.map(
  (step) => ({ step, title: TITLES[step] }),
);

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

  /**
   * Saves the current step and, on the last one, submits. The server decides both.
   *
   * The first step creates the draft; every later one saves into it (ADR-0016). A page view is not
   * an intake, so nothing is sent until the patient has answered something, and re-entry is held
   * off by `busy` alone — React flushes that state update before it processes the next click.
   */
  const advance = useCallback(async (): Promise<void> => {
    const current = STEPS[index];
    if (current === undefined) return;
    setBusy(true);
    setIssues([]);
    setFailure(null);
    try {
      const saved =
        intakeId === null
          ? await fetch('/api/intakes', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(answersFor(current.step)),
            })
          : await fetch(`/api/intakes/${intakeId}`, {
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

      // The draft's id comes back from the request that created it; later steps echo it.
      const { id } = (await saved.json()) as { id: string };
      if (intakeId === null) setIntakeId(id);

      if (index < STEPS.length - 1) {
        setIndex(index + 1);
        return;
      }

      const response = await fetch(`/api/intakes/${id}/submit`, { method: 'POST' });
      if (response.status === 400) {
        const body = (await response.json()) as { issues?: Issue[] };
        setIssues(body.issues ?? []);
        return;
      }
      if (!response.ok) throw new Error(`the server answered ${response.status}`);
      setSubmitted((await response.json()) as Submitted);
    } catch {
      setFailure('We could not reach the server. Your answers are still here; please try again.');
    } finally {
      setBusy(false);
    }
  }, [answersFor, index, intakeId]);

  if (submitted !== null) return <Result submitted={submitted} />;

  const current = STEPS[index];
  if (current === undefined) return <ErrorText>This form has no such step.</ErrorText>;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void advance();
      }}
    >
      <StepIndicator index={index} count={STEPS.length} title={current.title} />

      <Card>
        {current.step === 'identity' && (
          <>
            <TextField
              label="Full name"
              message={messageFor(issues, 'fullName')}
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
              }}
              required
            />
            <TextField
              label="Email address"
              message={messageFor(issues, 'email')}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              required
            />
            <TextField
              label="Date of birth"
              message={messageFor(issues, 'dob')}
              type="date"
              min={bounds.dob.min}
              max={bounds.dob.max}
              value={dob}
              onChange={(e) => {
                setDob(e.target.value);
              }}
              required
            />
          </>
        )}

        {current.step === 'metrics' && (
          <>
            <TextField
              label="Height in centimetres"
              hint={`Between ${bounds.heightCm.min} and ${bounds.heightCm.max}.`}
              message={messageFor(issues, 'heightCm')}
              type="number"
              inputMode="numeric"
              value={heightCm}
              onChange={(e) => {
                setHeightCm(e.target.value);
              }}
              required
            />
            <TextField
              label="Weight in kilograms"
              hint={`Between ${bounds.weightKg.min} and ${bounds.weightKg.max}, one decimal place.`}
              message={messageFor(issues, 'weightKg')}
              type="number"
              step="0.1"
              inputMode="decimal"
              value={weightKg}
              onChange={(e) => {
                setWeightKg(e.target.value);
              }}
              required
            />
          </>
        )}

        {current.step === 'medications' && (
          <>
            <Field
              label="Are you currently using a GLP-1 medication?"
              hint="These are medicines such as Ozempic, Wegovy, Mounjaro, Saxenda or Trulicity."
              message={messageFor(issues, 'glp1Declared')}
            >
              <Choice
                type="radio"
                name="glp1Declared"
                checked={glp1Declared === true}
                onChange={() => {
                  setGlp1Declared(true);
                }}
                required
              >
                Yes
              </Choice>
              <Choice
                type="radio"
                name="glp1Declared"
                checked={glp1Declared === false}
                onChange={() => {
                  setGlp1Declared(false);
                  setGlp1([]);
                }}
              >
                No
              </Choice>
            </Field>

            {glp1Declared === true && (
              <Field label="Which one?" message={messageFor(issues, 'glp1')}>
                {GLP1_OPTIONS.map((option) => (
                  <Choice
                    key={option.value}
                    type="checkbox"
                    checked={glp1.includes(option.value)}
                    onChange={() => {
                      setGlp1(toggle(glp1, option.value));
                    }}
                  >
                    {option.label}
                  </Choice>
                ))}
              </Field>
            )}

            <TextAreaField
              label="Any other medication you take"
              hint={
                glp1Declared === true
                  ? 'If your GLP-1 medication is not in the list above, write its name here.'
                  : 'Leave this empty if there is none.'
              }
              message={messageFor(issues, 'otherMedications')}
              rows={3}
              value={otherMedications}
              onChange={(e) => {
                setOtherMedications(e.target.value);
              }}
            />
          </>
        )}

        {current.step === 'conditions' && (
          <>
            <Field
              label="Has a doctor diagnosed you with any of these?"
              message={messageFor(issues, 'conditions')}
            >
              {CONDITION_OPTIONS.map((option) => (
                <Choice
                  key={option.value}
                  type="checkbox"
                  checked={conditions.includes(option.value)}
                  onChange={() => {
                    setConditions(toggle(conditions, option.value));
                  }}
                >
                  {option.label}
                </Choice>
              ))}
            </Field>
            <TextAreaField
              label="Anything else we should know about your health"
              hint="Leave this empty if there is nothing."
              message={messageFor(issues, 'otherConditions')}
              rows={3}
              value={otherConditions}
              onChange={(e) => {
                setOtherConditions(e.target.value);
              }}
            />
          </>
        )}

        {current.step === 'consent' && (
          <>
            <Prose text={CONSENT_TEXT} />
            <Field label="" message={messageFor(issues, 'granted')}>
              <Choice
                type="checkbox"
                checked={granted}
                onChange={(e) => {
                  setGranted(e.target.checked);
                }}
              >
                I have read the statement above and I agree.
              </Choice>
            </Field>
          </>
        )}

        {/* An issue no field on this step owns — a whole-step refinement, or a step still missing
            at submit — is shown here rather than swallowed. */}
        {issues
          .filter((issue) => !FIELDS[current.step].includes(issue.path))
          .map((issue) => (
            <ErrorText key={`${issue.path}:${issue.message}`}>{issue.message}</ErrorText>
          ))}
        {failure !== null && <ErrorText>{failure}</ErrorText>}
      </Card>

      <ButtonRow>
        {index > 0 && (
          <Button
            onClick={() => {
              setIndex(index - 1);
            }}
            disabled={busy}
          >
            Back
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={!agreedIfAsked(current.step, granted)}
        >
          {index < STEPS.length - 1 ? 'Next' : 'Submit'}
        </Button>
      </ButtonRow>
    </form>
  );
}

/**
 * What the patient is told afterwards: one sentence, and who decides next.
 *
 * Not the engine's explanation lines and not the ruleset version (ADR-0020). R-B8 and R-B9 are
 * unaffected — the outcome still carries its explanation and the intake still stores the version
 * that judged it; both are for the reviewer reading the case, not for the patient reading a screen.
 */
function Result({ submitted }: { submitted: Submitted }): ReactElement {
  const headline: Record<string, string> = {
    auto_cleared: 'Thank you — your intake is with our care team.',
    auto_flagged: 'Thank you — a member of our care team will look at your answers.',
    auto_rejected: 'Thank you. Based on your answers, our programme is not suitable for you.',
  };
  return (
    <Card title={headline[submitted.state] ?? 'Thank you.'}>
      <p>A doctor makes the final decision; nothing here is one.</p>
    </Card>
  );
}

/** The field paths each step renders, so an issue naming anything else is shown for the step. */
const FIELDS: Record<IntakeStep, readonly string[]> = {
  identity: ['fullName', 'email', 'dob'],
  metrics: ['heightCm', 'weightKg'],
  medications: ['glp1Declared', 'glp1', 'otherMedications'],
  conditions: ['conditions', 'otherConditions'],
  // `textVersion` is deliberately absent: no field on this step renders it, so an issue naming it
  // — the consent text changed under a patient who still has the old one open — falls through to
  // the step-level messages in the card and is shown rather than filtered into silence.
  consent: ['granted'],
};

/**
 * Whether this step's answer may be sent yet. Only the consent step has one: a patient who has not
 * ticked the box has not consented, and the button says so by going grey rather than by sending a
 * request that comes back 400. Every other step is the server's to judge.
 */
const agreedIfAsked = (step: IntakeStep, granted: boolean): boolean =>
  step !== 'consent' || granted;

const messageFor = (issues: readonly Issue[], path: string): string | undefined =>
  issues.find((issue) => issue.path === path)?.message;

const toggle = (values: readonly string[], value: string): string[] =>
  values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
