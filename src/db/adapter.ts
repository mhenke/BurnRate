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
 * ternaries across the codebase. The `any` cast on `dialectDb` is a
 * deliberate tradeoff: it trades compile-time query safety for the
 * ability to share query logic across dialects without per-dialect code
 * duplication. Callers recover safety by applying `as Type[]` casts on
 * query results.
 *
 * This pattern is common in open-source multi-dialect Drizzle apps
 * (n8n, nocodb, emdash).
 */

/**
 * Return the database client cast to `any` so shared query builders can
 * operate across both PostgreSQL and SQLite without per-dialect branches.
 * The cast is intentional — see module JSDoc for the rationale.
 *
 * @param db Typed {@link DbClient} (PG or SQLite + `isSqlite` flag).
 * @returns The same client instance, typed as `any`.
 */
export function dialectDb(db: DbClient) {
  return db as any;
}

export { dialectDb as runner };

/**
 * Select the correct Drizzle table object for the active dialect.
 *
 * @param db Database client carrying the `isSqlite` discriminator.
 * @param pgTable The PostgreSQL variant of the table.
 * @param sqTable The SQLite variant of the table.
 * @returns `sqTable` when running against SQLite, `pgTable` otherwise.
 */
export function dialectTable(db: { isSqlite: boolean }, pgTable: any, sqTable: any) {
  return (db.isSqlite ? sqTable : pgTable);
}

/**
 * Return a dialect-appropriate SQL expression for the current timestamp.
 *
 * - PostgreSQL: `now()`
 * - SQLite:     `CURRENT_TIMESTAMP`
 *
 * @param db Database client carrying the `isSqlite` discriminator.
 * @returns A Drizzle {@link SQL} fragment usable in `.set()` and `.values()`.
 */
export function dialectNow(db: DbClient): SQL<unknown> {
  return db.isSqlite ? sql`CURRENT_TIMESTAMP` : sql`now()`;
}
