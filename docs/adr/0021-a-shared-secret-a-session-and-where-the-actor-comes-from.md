# ADR-0021: A shared secret, a session, and where the actor comes from

- **Status:** proposed
- **Date:** 2026-09-13
- **Deciders:** Andrei Andreev
- **Requirements:** R-B16, R-B19, R-B20, R-C8, R-S4, R-T4 · **Resolves:** Q8 (neither A nor B: A
  with a door) · **Amends:** ADR-0014 item 4 ("No SSO, no login, no sessions")

## Context and problem statement

ADR-0014 item 4 recorded Q8's default A — a reviewer is identified, not authenticated — and said
so plainly: "No SSO, no login, no sessions". That was written for a branch whose reviewer edges had
no routes. Part C gives them routes, and two things about the console change what "identification"
has to mean.

First, **the actor becomes client-supplied.** An audit entry's `actor` is evidence, and R-B20 asks
it to say who let a decision through. A console that posts `{reviewerId, note}` lets the caller
name the actor, and a name the caller chose is not evidence of anything — it is the same field
filled in by the same hand that took the action. The role gate of ADR-0014 item 3 has the same
problem one layer down: if the request body says `role: doctor`, the gate that stops an ops
reviewer approving a course of treatment is a value the ops reviewer sent.

Second, **the console is a URL.** It is deployed on Vercel (ADR-0003) over a database holding 2477
patients' names, dates of birth, BSNs and medical answers, and it writes to them. An unauthenticated
public URL over that is not a scope cut, it is a data breach with a README entry.

Neither is an argument for building real authentication in a seven-day assignment. Both are
arguments that the actor must come from somewhere the caller cannot write, and that the door must
be shut to someone who has not been given the key.

## Decision drivers

- The actor on an audit entry must not be a value the caller chose (R-B20, `CLAUDE.md` §5).
- The client carries no business rules; the server is the only authority on the role gate
  (`CLAUDE.md` §2, R-T4, R-B16).
- A public URL over patient data gets a lock, however simple.
- A missing secret must fail loudly, never fail open (`CLAUDE.md` §2).
- YAGNI: a seven-day assignment does not get user management, password reset or SSO, and what it
  does get must be described honestly rather than dressed up as authentication (R-S4).

## Considered options

1. **As ADR-0014 wrote it.** The console sends the reviewer id in the request body; no gate.
2. **A shared console secret and a signed session cookie.** `/login` takes the secret and a
   reviewer picked from the seeded list; one `currentReviewer()` reads the session; the actor and
   the role come from it.
3. **Real authentication.** Per-reviewer credentials, password hashing, reset, lockout.

## Decision outcome

Chosen option: **Option 2**.

Option 1 was right while nothing could be written from a browser and is wrong now: it makes the
audit's actor and the role gate both forgeable by the caller they exist to constrain. Option 3 is
Q8's answer B — a day of work on its own, on the part of the assignment that is graded least — and
it would still not be the auth a real deployment uses, which is SSO against the clinic's identity
provider. Option 2 buys the two properties that matter (the actor is not client-supplied; the door
is shut) for about eighty lines, and leaves the SSO-shaped hole exactly where a real deployment
plugs one in.

### 1. The secret

`CONSOLE_SECRET`, **required**, validated by Zod in `src/env.ts` at the process boundary like every
other variable (ADR-0003), minimum 32 characters. Required rather than optional, because the
failure mode being prevented here is a console served with no gate: an optional secret that
defaults to "no session needed" is precisely the silent fallback `CLAUDE.md` §2 forbids. The cost
is that `npm run import` on a machine with no console also wants the variable set — accepted, since
ADR-0003 makes the importer and the console one deployable with one environment, and
`.env.example`, the CI workflow and `README.md` carry it.

It is compared in constant time (`crypto.timingSafeEqual` over equal-length digests, so the
comparison does not leak the secret's length either), and it is never sent to the client, logged,
or included in an error message.

### 2. The session

A cookie named `wellis_console`, whose value is `<reviewer id>.<issued at>.<hmac>`, the HMAC being
SHA-256 over the first two parts keyed by `CONSOLE_SECRET`. `httpOnly`, `SameSite=Lax`, `Path=/`,
`Secure` outside development, `Max-Age` twelve hours — a clinic day, after which the reviewer logs
in again.

- **The cookie carries an id, never a role.** `currentReviewer()` reads the id and loads the
  `reviewers` row; `name` and `role` come from the database on every request. A role changed by the
  seed takes effect on the next request, and a forged role is not expressible even if the signature
  were broken.
- **A session naming a reviewer who no longer exists is no session**, not an error and not a
  half-session: the row is the identity.
- Rotating `CONSOLE_SECRET` invalidates every session, which is the only revocation this design
  has, and is stated as such.

### 3. `currentReviewer()` is the only way in

One helper, `src/console/session.ts`, used by every console page and every mutating route:

- A page with no session **redirects** to `/login`; a route with no session answers **401**.
- The actor of every write — a transition, a merge, an item resolution, a BSN reveal — is the
  session's reviewer: `audit_entries.actor` is their name as it is now, `actor_reviewer_id` their
  id (ADR-0014 item 4).
- **No route schema has an actor field.** The Zod schemas at the boundary do not declare
  `reviewerId`, `actor` or `role`, so a body carrying one is rejected rather than ignored. There is
  no code path from a request body to an audit entry's actor.
- The role gate stays exactly where ADR-0014 item 3 put it — inside `checkTransition`, fed from the
  session's reviewer — and the console additionally hides the buttons it knows will be refused.
  Hiding is a courtesy; the refusal is the rule.

### 4. What this is not, stated in `README.md`

It authenticates **the console**, not the person. Anyone holding the shared secret may pick any
reviewer from the list, so the role **separates duties between colleagues; it does not resist an
attacker who is already inside** — which is what ADR-0014 item 4 already said about the role and
stays true. There is no registration, no password reset, no per-reviewer credential, no lockout and
no audit of failed logins. Those are the scope cut (R-S4), and the sentence `README.md` carries is:
**a real deployment plugs SSO in here.**

### Consequences

- Good: an audit entry's actor and the role that gated the decision both come from a value the
  caller cannot write. R-B20's "who" is evidence again.
- Good: the deployed console is not readable by anyone with the URL.
- Good: one helper is the single place the question "who is doing this" is answered, so a new route
  cannot invent a second answer.
- Bad: it amends an accepted ADR two branches after it was accepted. Accepted: ADR-0014 item 4 was
  right for a branch with no routes, and this is the supersede path the lifecycle exists for.
- Bad: a shared secret is one credential for the whole team, and rotating it logs everyone out.
  Accepted and named; it is the honest shape of "identification plus a door".
- Bad: `CONSOLE_SECRET` is now required for the importer too. Accepted; one deployable, one
  environment.
- Neutral: sessions are stateless — no table, no store. Revocation is secret rotation.

### Confirmation

- Unit tests: a cookie with a tampered id, a tampered timestamp or a tampered signature verifies as
  no session; an expired one verifies as no session; a valid one round-trips.
- Unit test: the secret comparison rejects a wrong secret of the same length and of a different
  length.
- Integration test iterating the console's mutating routes: every one answers **401** without a
  session and writes nothing.
- Integration test: every console page redirects to `/login` without a session.
- Integration test: a session for a deleted reviewer is refused.
- Integration test: an `ops` session posting approve gets **403** and leaves `intakes.state` and
  `audit_entries` unchanged; a `doctor` session succeeds and the audit entry carries that doctor's
  `actor_reviewer_id`.
- A test asserts no route schema declares an actor, reviewer or role field.
- `npm run check` fails with the environment message when `CONSOLE_SECRET` is absent.

## More information

- `QUESTIONS.md` Q8; ADR-0014 item 3 (the role gate) and item 4 (the actor model this amends);
  ADR-0003 (one deployable, Zod at the boundary); `REQUIREMENTS.md` R-B20, R-S4.
- `docs/console-stories.md` S-22 (the story this answers) and D-4 (the disagreement that raised it).
