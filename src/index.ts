import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { loadConfig, resolveThresholds, type BurnrateConfig } from './config.js';
import { initDb, closeDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createGitHubClient } from './github/client.js';
import { runObserveOnlyPipeline } from './etl/pipeline.js';
import { computeForecast, buildForecastInput } from './forecast/engine.js';
import { runClassify } from './classify/runner.js';
import type { NotificationProviderConfig } from './notifications/types.js';
import { runBudgetSync } from './budget/budget_sync.js';
import { daysAgo } from './constants.js';
import * as queries from './db/queries.js';
import { slurpArg, parseClassifyArgs, parseEtlArgs } from './cli/args.js';

config();

const DEFAULT_CONFIG_PATH = 'config/burnrate.yml';

function getConfig(): BurnrateConfig {
  const cfgPath = process.env.BURNRATE_CONFIG ?? DEFAULT_CONFIG_PATH;
  return loadConfig(cfgPath);
}

async function runClassificationCommand(opts: { configPath: string; valueConfigPath: string; report: boolean }) {
  const cfg = getConfig();
  const resolvedThresholds = resolveThresholds(cfg.thresholds);
  const db = initDb(cfg.postgres.url);

  try {
    const result = await runClassify(db, {
      valueConfigPath: opts.valueConfigPath,
      reason: 'manual',
      showReport: opts.report,
      classifyThresholds: resolvedThresholds.classify,
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

    const rows = await queries.getDailyUsageSummary(db, daysAgo(30));
    const poolTotal = await queries.getLatestPoolTotal(db);
    const forecast = computeForecast(buildForecastInput(rows, poolTotal));

    console.log(JSON.stringify(forecast, null, 2));

    await closeDb();
    return;
  }

  if (command === 'classify') {
    const parsed = parseClassifyArgs(argv.slice(3));
    const configPath = process.env.BURNRATE_CONFIG ?? DEFAULT_CONFIG_PATH;
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

    const notificationProviders: NotificationProviderConfig[] = [];

    if (slackWebhookUrl) {
      notificationProviders.push({
        type: 'slack',
        webhookUrl: slackWebhookUrl,
      });
    }

    notificationProviders.push({
      type: 'github_issues',
      owner: issueRepoOwner,
      repo: issueRepoName,
      token: issueRepoToken,
    });

    if (cfg.notifications?.providers) {
      notificationProviders.push(...cfg.notifications.providers);
    }

    const result = await runBudgetSync({
      db,
      github: gh,
      notificationProviders,
      renotifyHours: cfg.notifications?.renotifyHours,
      escalateDays: cfg.notifications?.escalateDays,
      dryRun,
    });

    if (jsonLogs) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Budget sync complete: ${result.snapshotDate} - ${result.alertLevel} (${result.pctUsed.toFixed(1)}% used)`);
      if (result.notificationsDispatched > 0) console.log(`${result.notificationsDispatched} notification(s) sent`);
      if (result.errors.length > 0) console.error('Errors:', result.errors.join(', '));
    }

    await closeDb();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

// Allow direct execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
