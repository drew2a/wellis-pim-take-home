// The design system. One rule governs this directory:
//
//   Tailwind utility classes appear ONLY in files under `src/ui/`. Pages, forms and (next) the
//   review console compose these components and carry no `className` of their own.
//
// The point is reviewability: how the product looks is decided in this handful of files, not
// spread across every screen. ESLint enforces it — a `className` attribute anywhere else under
// `src/` fails `npm run lint` (see `eslint.config.ts`).
//
// The tokens the classes here refer to — colours, the font stack — are the `@theme` block in
// `src/app/globals.css`.
export { Badge, StateBadge } from './Badge';
export { Button, ButtonRow, type ButtonVariant } from './Button';
export { Card } from './Card';
export { Choice, Field, TextAreaField, TextField } from './Field';
export { Page, PageTitle } from './Page';
export { StepIndicator } from './Steps';
export { Table, type Column } from './Table';
export { ErrorText, Findings, Hint, Lead, Prose } from './Text';
export { REVIEW_ITEM_TONES, STATE_TONES, humanise, toneForState, type Tone } from './tones';
