import type { DbClient } from '../db/client.js';
import type {
  BurnRateAlert,
  NotificationChannel,
  NotificationResult,
  NotificationProviderConfig,
} from './types.js';
import { type NotificationProvider, alertMeetsMinLevel } from './provider.js';
import { SlackProvider } from './providers/slack.js';
import { GitHubIssuesProvider } from './providers/github_issues.js';
import { TeamsProvider } from './providers/teams.js';
import { OutlookProvider } from './providers/outlook.js';
import * as queries from '../db/queries.js';

export { sanitizeErrorMessage } from './sanitize.js';

const BUILTIN_PROVIDERS: Record<string, new (config: NotificationProviderConfig) => NotificationProvider> = {
  slack: SlackProvider,
  github_issues: GitHubIssuesProvider,
  teams: TeamsProvider,
  outlook: OutlookProvider,
};

export type NotificationDispatchResult = {
  alertId: string;
  results: NotificationResult[];
};

export class NotificationService {
  private providers: NotificationProvider[] = [];

  constructor(
    private db: DbClient,
    providerConfigs: NotificationProviderConfig[],
    private renotifyHours: number = 24,
    private escalateDays: number = 3,
  ) {
    this.providers = providerConfigs
      .filter((c) => c.enabled !== false)
      .map((c) => this.createProvider(c))
      .filter((p): p is NotificationProvider => p !== null);
  }

  async dispatch(
    alert: BurnRateAlert,
    snapshotDate: string,
    notificationType: string = 'budget_alert',
    force: boolean = false,
  ): Promise<NotificationDispatchResult> {
    const results: NotificationResult[] = [];

    for (const provider of this.providers) {
      const meetsMinLevel = force || alertMeetsMinLevel(alert.level, provider.minLevel);
      if (!meetsMinLevel) {
        continue;
      }

      const result = await this.sendAndLog(provider, alert, snapshotDate, notificationType);
      results.push(result);
    }

    return { alertId: alert.id, results };
  }

  private async sendAndLog(
    provider: NotificationProvider,
    alert: BurnRateAlert,
    snapshotDate: string,
    notificationType: string,
  ): Promise<NotificationResult> {
    try {
      const result = await provider.send(alert);
      await this.logNotification(snapshotDate, provider.name, notificationType, {
        success: result.success,
        externalId: result.externalId,
        errorMessage: result.errorMessage,
      });
      return { channel: provider.name, ...result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.logNotification(snapshotDate, provider.name, notificationType, {
        success: false,
        errorMessage,
      });
      return { success: false, channel: provider.name, errorMessage };
    }
  }

  private async logNotification(
    snapshotDate: string,
    channel: NotificationChannel,
    notificationType: string,
    result: { success: boolean; externalId?: string; errorMessage?: string },
  ): Promise<void> {
    await queries.insertNotificationLog(this.db, {
      snapshotDate,
      channel: channel as 'slack' | 'github_issue',
      notificationType,
      externalId: result.externalId || undefined,
      payload: {},
      success: result.success,
      errorMessage: result.errorMessage,
    });
  }

  private createProvider(config: NotificationProviderConfig): NotificationProvider | null {
    const ProviderClass = BUILTIN_PROVIDERS[config.type];
    if (!ProviderClass) {
      return null;
    }
    try {
      return new ProviderClass(config);
    } catch {
      return null;
    }
  }
}
