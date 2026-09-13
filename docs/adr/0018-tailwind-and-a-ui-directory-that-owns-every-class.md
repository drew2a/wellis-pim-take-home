# ADR-0018: Tailwind v4, and one directory that owns every utility class

- **Status:** accepted
- **Date:** 2026-09-13
- **Deciders:** Andrei Andreev
- **Requirements:** R-T4, R-T7, R-S4 · **Amends:** ADR-0003 (adds the styling toolchain to the
  fixed stack)

## Context and problem statement

ADR-0003 fixed the stack down to the ORM and the test runner but said nothing about CSS, because
until the intake flow shipped there were no screens. There are now two — the home page and the
five-step intake form — and the review console is next, which is the screen the assignment
actually grades. The first version of the form was styled with hand-written rules in
`globals.css` keyed to element and class names, and it rendered black-on-black for anyone whose
OS was in dark mode, because nothing owned the page's background. That is the cheap version of
the real problem: with no stated rule about where styling lives, it accumulates in whichever file
is open, and "what does this product look like" stops having an answer a reviewer can read.

## Decision drivers

- The review console is the graded screen. Its styling decisions should be made once and read in
  one place, not rediscovered per component.
- Deterministic and explainable beats clever (ASSIGNMENT.md §3B) — for the CSS as much as the
  rules engine. A reviewer should be able to see every colour the product can use.
- KISS and YAGNI (`CLAUDE.md` §2): a seven-day assignment does not get a component library, a
  theming layer, or a dark mode.
- Conventions in this repo are mechanically enforced, not manually reviewed (`CLAUDE.md` §2).

## Considered options

1. **Hand-written CSS** in `globals.css`, keyed to semantic class names.
2. **CSS Modules**, one stylesheet per component.
3. **A component library** (MUI, shadcn/ui, Chakra).
4. **Tailwind v4, confined to `src/ui/`** by a lint rule.

## Decision outcome

Chosen option: **Option 4** — Tailwind v4 as the toolchain, plus the constraint that makes it
reviewable.

Option 1 is what was there, and it failed: with no boundary, the rules drifted and the tokens were
implicit. Option 2 scopes the CSS but does not *centralise* it — thirty stylesheets is still thirty
places a colour can be invented. Option 3 buys polished widgets and costs a dependency tree, a
theming system to learn, and an override layer to fight; the form here is five steps of native
inputs, and the console is a table with badges. Neither justifies it.

### 1. Tailwind v4, configured in CSS

`tailwindcss` and `@tailwindcss/postcss` as dev dependencies, a four-line `postcss.config.mjs` that
Next picks up on its own. v4 has no JavaScript config file: the entire configuration is the
`@theme` block at the top of `src/app/globals.css`, so the design tokens — nine greys, one accent,
six state hues, the font stack — are a list a reviewer reads in forty lines. A colour that is not
in that block cannot be used.

### 2. Utility classes live only in `src/ui/`

`src/ui/` holds the design system: `Badge`, `Button`, `Card`, `Field`, `Page`, `Steps`, `Table`,
`Text`, and `tones.ts`, which maps every intake state and review-item type to one of the six state
hues. Pages, the intake form and the console compose these and carry no `className` and no `style`
of their own.

This is enforced, not asked for: `eslint.config.ts` restricts the `className` and `style` JSX
attributes everywhere under `src/` except `src/ui/`, so a class written on a screen fails
`npm run lint`.

### 3. One theme, light

No dark mode, and `color-scheme: light` on the page so the browser's own widgets — the date
picker, scrollbars — stay on the same side. A dark theme is a second full set of colour decisions
to get right, and a reviewer opening these screens does not need one. Recorded as a scope cut, not
an oversight.

### Consequences

- Good: every visual decision in the product is in one directory of nine small files, and the
  palette is a single `@theme` block.
- Good: the console gets its components already built and already accessible — a state badge is
  `<StateBadge>`, not a colour choice made again.
- Bad: the lint rule is absolute, so a genuine one-off needs a new component in `src/ui/` rather
  than a class on the spot. Accepted: that is the point, and the cost is one small file.
- Bad: two more build dependencies and a PostCSS step. Both are dev-only.
- Neutral: the components are presentational and hold no business rules, so R-T4 is untouched —
  they are not tested directly; the screens that use them are.

### Confirmation

- `npm run lint` fails on a `className` or a `style` attribute in any `src/**/*.tsx` outside
  `src/ui/`.
- `grep -rn 'className' src --include='*.tsx' | grep -v '^src/ui/'` returns nothing.
- `npm run build` emits every custom utility the components use; the built CSS is the check that a
  token exists.

## More information

- ADR-0003 (the stack this amends), `src/ui/index.ts` (the rule, stated where it is worked in),
  `src/app/globals.css` (`@theme`, the tokens).
- Written after the fact, on the branch that introduced the change (`feature/ui-baseline`), which
  `CLAUDE.md` §1 requires to happen before implementation — it did not. Recorded here rather than
  left unrecorded.
