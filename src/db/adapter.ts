import { sql, type SQL } from 'drizzle-orm';
import type { DbClient } from './client.js';

/**
 * Database query adapter for multi-dialect (PostgreSQL + SQLite) apps.
 *
 * Drizzle's {@link https://orm.drizzle.team PgTable} and
 * {@link https://orm.drizzle.team SQLiteTable} types are structurally
 * incompatible at the TypeScript level — you cannot pass a union of both
 * to `db.select(from)`. Every query must operate on tables from a single
 * dialect.
 *
 * This module centralizes three dialect-resolution operations under
 * explicit names so callers don't scatter `(db as any)` and inline
 * ternaries across the codebase. The `any` cast on `dbHandle` is a
 * deliberate tradeoff: it trades compile-time query safety for the
 * ability to share query logic across dialects without per-dialect code
 * duplication. Callers recover safety by applying `as Type[]` casts on
 * query results.
 *
 * This pattern is common in open-source multi-dialect Drizzle apps
 * (n8n, nocodb, emdash).
 */
export function dbHandle(db: DbClient) {
  return db as any;
}

export { dbHandle as runner };

export function dialectTable(db: { isSqlite: boolean }, pgTable: any, sqTable: any) {
  return (db.isSqlite ? sqTable : pgTable);
}

export function dialectNow(db: DbClient): SQL<unknown> {
  return db.isSqlite ? sql`CURRENT_TIMESTAMP` : sql`now()`;
}
