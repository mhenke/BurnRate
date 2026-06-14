import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { config } from 'dotenv';
import { loadConfig, type BurnrateConfig } from './config.js';
import { initDb, closeDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createGitHubClient } from './github/client.js';
import { runObserveOnlyPipeline } from './etl/pipeline.js';
import { computeForecast } from './forecast/engine.js';
import { runClassify } from './classify/runner.js';
import { runBudgetSync } from './budget/budget_sync.js';
import { daysAgo } from './constants.js';
import * as queries from './db/queries.js';

config();

function getConfig(): BurnrateConfig {
  const cfgPath = process.env.BURNRATE_CONFIG ?? 'config/burnrate.yml';
  return loadConfig(cfgPath);
}

async function runClassificationCommand(opts: { configPath: string; valueConfigPath: string; report: boolean }) {
  const cfg = getConfig();
  const db = initDb(cfg.postgres.url);

  try {
    const result = await runClassify(db, {
      valueConfigPath: opts.valueConfigPath,
      reason: 'manual',
      showReport: opts.report,
    });

    if (opts.report) {
      console.log(JSON.stringify({
        total_users: result.totalUsers,
        changed_users: result.changedUsers,
        tier_counts: result.tierCounts,
        missing_team_count: result.missingTeamCount,
      }, null, 2));
    } else {
      console.log(`Classification complete: ${result.changedUsers} of ${result.totalUsers} users changed`);
    }
  } finally {
    await closeDb();
  }
}

function parseClassifyArgs(argv: string[]): { valueConfigPath: string; report: boolean } {
  let valueConfigPath = process.env.VALUE_CONFIG_PATH ?? 'config/value_config.yml';
  let report = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--report') {
      report = true;
      continue;
    }

    if (arg === '--value-config') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('Missing value config path after --value-config');
      }
      valueConfigPath = next;
      index += 1;
      continue;
    }

    if (arg.startsWith('--value-config=')) {
      valueConfigPath = arg.slice('--value-config='.length);
      continue;
    }

    throw new Error(`Unknown classify flag: ${arg}`);
  }

  if (!process.env.VALUE_CONFIG_PATH && valueConfigPath === 'config/value_config.yml' && !existsSync(valueConfigPath)) {
    valueConfigPath = 'config/value_config.sample.yml';
  }

  return { valueConfigPath, report };
}


/**
 * CLI entrypoint. Dispatches to etl, forecast, classify, budget-sync, or check.
 */
export async function main(argv: string[]): Promise<void> {
  const command = argv[2] ?? 'check';

  if (command === 'check') {
    console.log('BurnRate — Copilot spend visibility');
    console.log('Config check: OK');
    return;
  }

  if (command === 'etl') {
    const cfg = getConfig();
    const db = initDb(cfg.postgres.url);
    const gh = createGitHubClient(cfg.github.token, cfg.github.enterprise, cfg.github.org);

    const { day: targetDay, userSupplied } = parseEtlArgs(argv.slice(3));
    console.log(`ETL target day: ${targetDay}${userSupplied ? ' (manual/backfill)' : ''}`);
    await runMigrations(db);
    const result = await runObserveOnlyPipeline(gh, db, targetDay);
    
    if (result.errors.length > 0) {
      console.error(`ETL completed with ${result.errors.length} error(s):`);
      for (const error of result.errors) {
        console.error(`  - ${error}`);
      }
      // Exit with error if all fetches failed
      if (result.errors.some(e => e.includes('CRITICAL'))) {
        process.exit(1);
      }
    } else {
      console.log(`ETL complete: ${result.rawStored} raw reports stored, ${result.usageUpserted} usage records upserted`);
    }

    await closeDb();
    return;
  }

  if (command === 'forecast') {
    const cfg = getConfig();
    const db = initDb(cfg.postgres.url);

    const dateString = daysAgo(30);

    const rows = await queries.getDailyUsageSummary(db, dateString);
    const poolTotal = await queries.getLatestPoolTotal(db);

    const now = new Date();
    const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const dailyCredits = rows.map((r: any) => Number(r.credits));
    const creditsUsedMtd = rows
      .filter((r: any) => r.usage_date >= firstOfMonth)
      .reduce((sum: number, r: any) => sum + Number(r.credits), 0);

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    let daysElapsed = now.getDate();
    const mtdRows = rows.filter((r: any) => r.usage_date >= firstOfMonth);
    if (mtdRows.length > 0) {
      const latestMtdRow = mtdRows[mtdRows.length - 1];
      const parts = latestMtdRow.usage_date.split('-');
      if (parts.length === 3) {
        daysElapsed = parseInt(parts[2], 10);
      }
    }

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

  if (command === 'classify') {
    const parsed = parseClassifyArgs(argv.slice(3));
    const configPath = process.env.BURNRATE_CONFIG ?? 'config/burnrate.yml';
    await runClassificationCommand({
      configPath,
      valueConfigPath: parsed.valueConfigPath,
      report: parsed.report,
    });
    return;
  }

  if (command === 'budget-sync') {
    let dryRun = false;
    let jsonLogs = false;
    const args = argv.slice(3);

    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === '--dry-run') {
        dryRun = true;
      } else if (arg === '--json-logs') {
        jsonLogs = true;
      } else if (arg === '--help' || arg === '-h') {
        console.log('Usage: budget-sync [--dry-run] [--json-logs]');
        console.log('');
        console.log('Options:');
        console.log('  --dry-run     Run without writing to database or sending notifications');
        console.log('  --json-logs   Output results as JSON');
        console.log('  --help, -h    Show this help message');
        return;
      }
    }

    const cfg = getConfig();
    const db = initDb(cfg.postgres.url);
    const gh = createGitHubClient(cfg.github.token, cfg.github.enterprise, cfg.github.org);

    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
    const issueRepoOwner = cfg.github.org;
    const issueRepoName = process.env.BUDGET_ISSUE_REPO ?? 'burnrate';
    const issueRepoToken = cfg.github.token;

    const result = await runBudgetSync({
      db,
      github: gh,
      slackWebhookUrl,
      issueRepoOwner,
      issueRepoName,
      issueRepoToken,
      dryRun,
    });

    if (jsonLogs) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Budget sync complete: ${result.snapshotDate} - ${result.alertLevel} (${result.pctUsed.toFixed(1)}% used)`);
      if (result.slackNotified) console.log('Slack notification sent');
      if (result.issueNotified) console.log('GitHub issue created');
      if (result.errors.length > 0) console.error('Errors:', result.errors.join(', '));
    }

    await closeDb();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseEtlArgs(argv: string[]): { day: string; userSupplied: boolean } {
  let userSupplied = false;
  let day: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--day') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('Missing value after --day');
      }
      day = next;
      userSupplied = true;
      index += 1;
      continue;
    }

    if (arg.startsWith('--day=')) {
      day = arg.slice('--day='.length);
      userSupplied = true;
      continue;
    }

    throw new Error(`Unknown etl flag: ${arg}`);
  }

  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error('Day must be in YYYY-MM-DD format');
  }

  return {
    day: day ?? formatIsoDate(new Date(Date.now() - 86400000)),
    userSupplied,
  };
}

// Allow direct execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
