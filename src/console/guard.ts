// The page half of ADR-0021 item 3. A console *route* answers 401 and a console *page* redirects
// to `/login`, so this is the one line every page under `/console` starts with.
//
// Separate from `./reviewer.ts` because it reaches for `next/navigation`, which only exists inside
// a rendering request; keeping it here leaves `currentReviewer()` callable from a test.
import { redirect } from 'next/navigation';

import { currentReviewer, type ConsoleReviewer } from './reviewer';

export async function requireReviewer(): Promise<ConsoleReviewer> {
  const reviewer = await currentReviewer();
  // `redirect` throws, so nothing below it runs and no patient data is read, let alone rendered.
  if (reviewer === null) redirect('/login');
  return reviewer;
}
