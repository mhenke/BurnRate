import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import pg from 'pg';
import Database from 'better-sqlite3';

import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export type DbClient = (NodePgDatabase<any> | BetterSQLite3Database<any>) & { isSqlite: boolean };

// Module-level singletons — intentional for a CLI tool where each process
// lifetime initializes exactly one database connection. If this module is
// ever used in a long-lived server process, replace with explicit dependency
// injection to support connection pooling per request or per tenant.
let db: DbClient | null = null;
let pgPool: pg.Pool | null = null;
let sqliteDb: Database.Database | null = null;

/**
 * Initialize a database connection. Detects PostgreSQL vs SQLite from the URL scheme.
 */
export function initDb(connectionString: string): DbClient {
  if (connectionString.startsWith('postgres') || connectionString.startsWith('postgresql')) {
    const poolSize = parseInt(process.env.DB_POOL_SIZE ?? '5', 10);
    pgPool = new pg.Pool({ connectionString, max: Math.max(1, poolSize) });
    db = Object.assign(drizzlePg({ client: pgPool }), { isSqlite: false });
  } else {
    // SQLite: either a file path or :memory:
    sqliteDb = new Database(connectionString === ':memory:' ? ':memory:' : connectionString);
    db = Object.assign(drizzleSqlite({ client: sqliteDb }), { isSqlite: true });
  }
  return db;
}

/**
 * Return the active database client. Throws if not initialized.
 */
export function getDb(): DbClient {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

/**
 * Close the database connection and clean up resources.
 */
export async function closeDb(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
  }
  db = null;
}
