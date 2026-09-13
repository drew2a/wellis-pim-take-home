import { IBM_Plex_Mono, Instrument_Sans } from 'next/font/google';
import type { ReactElement, ReactNode } from 'react';

// Self-hosted at build time by `next/font`, so the product has no runtime dependency on Google's
// CDN and no layout shift while a face loads. The two families are the typographic rule of the
// console: prose in the sans, identifiers — ids, rule codes, counts, dates, field names — in the
// mono (ADR-0028). Only 400 and 500 of the mono are loaded; nothing sets it bolder than that.
const sans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

/**
 * The document frame. It is here rather than in `app/layout.tsx` because the font variables are a
 * `className` on `<html>`, and classes live only in this directory (ADR-0018) — but it is imported
 * by path rather than through `./index.ts`, because `next/font/google` is a build-time transform
 * that throws under Vitest, and the barrel is reached from every screen a test renders.
 */
export function Document({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
