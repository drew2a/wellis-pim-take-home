import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Wellis Intake',
  description: 'Patient intake and eligibility assessment',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
