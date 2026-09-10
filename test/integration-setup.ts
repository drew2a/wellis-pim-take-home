// Integration tests need a real Postgres (CLAUDE.md §8). Without a connection string the
// whole run is skipped, loudly, instead of failing on a connection error that hides the cause.
export function setup(): void {
  if (process.env['DATABASE_URL'] === undefined) {
    process.stderr.write(
      'DATABASE_URL is not set: skipping integration tests. Run `npm run db:up` and set DATABASE_URL (see .env.example).\n',
    );
    process.exit(0);
  }
}
