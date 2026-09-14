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
//
// `./Document.tsx` is deliberately **not** re-exported here. It calls `next/font/google`, which is
// a build-time transform and throws under Vitest, and this barrel is reached from every screen —
// so `app/layout.tsx` imports it by path and nothing else pays for it.
export { Badge, StateBadge } from './Badge';
export { DecisionBar, ENTER, type DecisionAction, type DecisionVariant } from './DecisionBar';
export {
  Banner,
  CompareCard,
  ConsoleFrame,
  DetailBody,
  DetailEmpty,
  DetailHeader,
  DetailPane,
  DetailSection,
  EvidenceCard,
  Explainer,
  FindingsCard,
  MergeFields,
  Folded,
  type CompareColumn,
  type CompareRow,
  type EvidenceRow,
  type Finding,
  type MergeField,
  type MergeOption,
} from './Detail';
export { QueuePane, type QueueChoice, type QueueItem } from './Queue';
export {
  Dot,
  Mono,
  Rail,
  RailBrand,
  RailButton,
  RailKind,
  RailKinds,
  RailLabel,
  RailNav,
  RailNavLink,
  RailUser,
} from './Rail';
export { Button, ButtonRow, NEEDS_A_NOTE, type ButtonVariant } from './Button';
export { Card, Stack } from './Card';
export { Definitions, Raw, type Definition } from './Definitions';
export { Choice, Field, TextAreaField, TextField } from './Field';
export { Caption, PageHeader, SectionTitle } from './Header';
export { Page, PageTitle } from './Page';
export { StepIndicator } from './Steps';
export { Table, type Column } from './Table';
export { ErrorText, Hint, Lead, Prose } from './Text';
export {
  DOT_CLASSES,
  REVIEW_ITEM_TONES,
  STATE_TONES,
  humanise,
  titled,
  toneForReviewItem,
  toneForState,
  type Tone,
} from './tones';
