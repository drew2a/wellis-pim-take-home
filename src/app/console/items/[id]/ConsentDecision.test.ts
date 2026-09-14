// Which buttons a consent item offers. The bug this pins: the two establish actions are the only
// route into ADR-0025, and they appear on exactly the items whose derived state is `conflict` —
// so a `conflicted` that came back false for all seven of them left the decision unreachable.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { ConsentDecision } = await import('./ConsentDecision');

const buttons = (conflicted: boolean): string =>
  renderToStaticMarkup(
    // `children` is the evidence pane, which this test is not about. It goes in the props because
    // the component declares it required and a `.test.ts` file has no JSX to pass it with — the
    // unit suite is `src/**/*.test.ts`.
    // eslint-disable-next-line react/no-children-prop -- no JSX here; see above.
    createElement(ConsentDecision, {
      itemId: 'item-1',
      after: '/console',
      conflicted,
      children: null,
    }),
  ).replace(/<[^>]*>/gu, ' ');

describe('the buttons a consent item offers', () => {
  it('offers both states to establish when the log contradicts itself', () => {
    const shown = buttons(true);
    expect(shown).toContain('Consent is granted');
    expect(shown).toContain('Consent is revoked');
  });

  // A revocation that is unambiguous is acted on, not overridden (ADR-0025 §3).
  it('offers neither when the state is derivable', () => {
    const shown = buttons(false);
    expect(shown).not.toContain('Consent is');
    expect(shown).toContain('Record it and close');
  });
});
