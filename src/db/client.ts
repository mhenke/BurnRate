import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import pg from 'pg';
import Database from 'better-sqlite3';

import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export type DbClient = NodePgDatabase<any> | BetterSQLite3Database<any>;

let db: DbClient | null = null;
let pgPool: pg.Pool | null = null;
let sqliteDb: Database.Database | null = null;

export function initDb(connectionString: string): DbClient {
  if (connectionString.startsWith('postgres') || connectionString.startsWith('postgresql')) {
    pgPool = new pg.Pool({ connectionString, max: 5 });
    db = drizzlePg({ client: pgPool });
  } else {
    // SQLite: either a file path or :memory:
    sqliteDb = new Database(connectionString === ':memory:' ? ':memory:' : connectionString);
    db = drizzleSqlite({ client: sqliteDb });
  }
  return db;
}

export function getDb(): DbClient {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

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
