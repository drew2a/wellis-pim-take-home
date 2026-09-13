import Link from 'next/link';
import type { ReactElement } from 'react';

export default function Home(): ReactElement {
  return (
    <main>
      <h1>Wellis Intake</h1>
      <ul>
        <li>
          <Link href="/intake">Start an intake</Link> — the patient-facing questionnaire.
        </li>
      </ul>
      <p className="hint">
        The review console is not built yet; see <code>README.md</code> for what is in scope.
      </p>
    </main>
  );
}
