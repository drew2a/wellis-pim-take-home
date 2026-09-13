// ADR-0024: a console page reads through `src/repo/` and renders. It does not hold SQL of its own,
// and it does not fetch its own API. This is the mechanical half of that rule — the half a review
// would otherwise have to catch by eye.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function pagesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...pagesUnder(path));
    else if (entry === 'page.tsx' || entry.endsWith('.tsx')) found.push(path);
  }
  return found;
}

const COMPONENTS = pagesUnder('src/app').filter((path) => !path.endsWith('.test.tsx'));

describe('every page and component under src/app', () => {
  it.each(COMPONENTS)('%s holds no query of its own', (path) => {
    const source = readFileSync(path, 'utf8');
    // The table definitions and the query builder are the database layer. A screen that needs a
    // number a repository function does not return gets a function, not a query (ADR-0024).
    expect(source).not.toContain("from 'drizzle-orm'");
    expect(source).not.toContain("from '@/db/schema'");
  });

  // A server calling itself over HTTP to reach its own process is a moving part with no reader.
  it.each(COMPONENTS.filter((path) => path.endsWith('page.tsx')))(
    '%s does not fetch the console over HTTP',
    (path) => {
      expect(readFileSync(path, 'utf8')).not.toMatch(/fetch\(\s*['"`]https?:/);
    },
  );
});
