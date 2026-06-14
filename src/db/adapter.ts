import { sql, type SQL } from 'drizzle-orm';
import type { DbClient } from './client.js';

/**
 * Unified database query adapter. Drizzle's PgTable and SQLiteTable types
 * are structurally incompatible at the TypeScript level, so multi-dialect
 * apps use "isSqlite" branching with explicit casts. This module
 * centralizes those three ops under clear names.
 *
 * Real-world precedent: n8n, nocodb, and emdash all use variants of
 * isSqlite/isPostgres branching with explicit any-casts.
 */
export function runner(db: DbClient) {
  return db as any;
}

export function dialectTable(db: { isSqlite: boolean }, pgTable: any, sqTable: any) {
  return (db.isSqlite ? sqTable : pgTable);
}

export function dialectNow(db: DbClient): SQL<unknown> {
  return db.isSqlite ? sql`CURRENT_TIMESTAMP` : sql`now()`;
}
