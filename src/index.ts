import { config } from 'dotenv';
import { loadConfig, type BurnrateConfig } from './config.js';
import { initDb, closeDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createGitHubClient } from './github/client.js';
import { runObserveOnlyPipeline } from './etl/pipeline.js';
import { computeForecast } from './forecast/engine.js';
import { sql } from 'drizzle-orm';

config();

function getConfig(): BurnrateConfig {
  const cfgPath = process.env.BURNRATE_CONFIG ?? 'config/burnrate.yml';
  return loadConfig(cfgPath);
}

async function runQuery<T>(db: any, querySql: string): Promise<T[]> {
  const isSqlite = typeof db.run === 'function';
  if (isSqlite) {
    return db.all(sql.raw(querySql)) as T[];
  } else {
    const res = await db.execute(sql.raw(querySql));
    return res.rows as T[];
  }
}

export async function main(argv: string[]): Promise<void> {
  const command = argv[2] ?? 'check';

  if (command === 'check') {
    console.log('BurnRate Phase 1 — observe-only');
    console.log('Config check: OK');
    return;
  }

  if (command === 'etl') {
    const cfg = getConfig();
    const db = initDb(cfg.postgres.url);
    const gh = createGitHubClient(cfg.github.token, cfg.github.enterprise, cfg.github.org);

    await runMigrations(db);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const result = await runObserveOnlyPipeline(gh, db, yesterday);
    console.log(`ETL complete: ${result.rawStored} raw reports stored`);

    await closeDb();
    return;
  }

  if (command === 'forecast') {
    const cfg = getConfig();
    const db = initDb(cfg.postgres.url);
    const isSqlite = typeof db.run === 'function';

    const query = isSqlite
      ? `SELECT usage_date, SUM(credits) as credits
         FROM daily_usage
         WHERE usage_date >= date('now', '-30 days')
         GROUP BY usage_date
         ORDER BY usage_date`
      : `SELECT usage_date, SUM(credits) as credits
         FROM daily_usage
         WHERE usage_date >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY usage_date
         ORDER BY usage_date`;

    const rows = await runQuery<{ usage_date: string; credits: any }>(db, query);

    const dailyCredits = rows.map((r) => Number(r.credits));
    const creditsUsedMtd = dailyCredits
      .filter((_, i) => i >= rows.length - new Date().getDate())
      .reduce((a, b) => a + b, 0);

    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = now.getDate();

    const poolRows = await runQuery<{ total_credits: any }>(
      db,
      `SELECT total_credits FROM pool_snapshots ORDER BY snapshot_date DESC LIMIT 1`
    );
    const poolTotal = poolRows.length > 0 ? Number(poolRows[0].total_credits) : 0;

    const forecast = computeForecast({
      dailyCredits,
      poolTotal,
      creditsUsedMtd,
      daysInMonth,
      daysElapsed,
    });

    console.log(JSON.stringify(forecast, null, 2));

    await closeDb();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

// Allow direct execution
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  main(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
