import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import type { DbClient } from './client.js';
import { runner } from './adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readMigrationSQL(dialect: 'pg' | 'sqlite'): string[] {
  const migrationsDir = resolve(__dirname, 'migrations', dialect);
  const journal = JSON.parse(
    readFileSync(resolve(migrationsDir, 'meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ tag: string }> };

  const statements: string[] = [];
  for (const entry of journal.entries) {
    const sqlContent = readFileSync(resolve(migrationsDir, `${entry.tag}.sql`), 'utf8');
    for (const stmt of sqlContent.split('--> statement-breakpoint\n')) {
      const trimmed = stmt.trim();
      if (trimmed.length > 0) statements.push(trimmed);
    }
  }
  return statements;
}

/**
 * Run all database migrations: create tables and indexes if they do not exist.
 * Automatically selects PostgreSQL or SQLite migration files based on the client.
 * Migration files are generated via `drizzle-kit generate --config=drizzle.<dialect>.config.ts`.
 */
export async function runMigrations(db: DbClient): Promise<void> {
  const dialect = db.isSqlite ? 'sqlite' : 'pg';
  const statements = readMigrationSQL(dialect);

  const r = runner(db);
  for (const stmt of statements) {
    if (db.isSqlite) {
      r.run(sql.raw(stmt));
    } else {
      await r.execute(sql.raw(stmt));
    }
  }
}

const argv1 = process.argv[1];
const isMain = argv1 && (
  resolve(argv1) === resolve(fileURLToPath(import.meta.url)) ||
  resolve(argv1) === resolve(fileURLToPath(import.meta.url)).replace(/\.[jt]s$/, '') ||
  argv1.endsWith('/migrate') ||
  argv1.endsWith('/migrate.js') ||
  argv1.endsWith('/migrate.ts')
);

if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Error: DATABASE_URL environment variable is required.');
    process.exit(1);
  }
  const { initDb, closeDb } = await import('./client.js');
  const db = initDb(url);
  try {
    await runMigrations(db);
    console.log('Migrations completed successfully.');
  } catch (err) {
    console.error('Migrations failed:', err);
    process.exit(1);
  } finally {
    await closeDb();
  }
}
