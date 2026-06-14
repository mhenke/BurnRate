import type { BurnRateAlert, NotificationProviderConfig } from '../types.js';
import { BaseProvider } from '../provider.js';

export class TeamsProvider extends BaseProvider {
  readonly name = 'teams';

  private webhookUrl: string;

  constructor(config: NotificationProviderConfig) {
    super(config.minLevel as BaseProvider['minLevel'] | undefined);
    this.webhookUrl = config.webhookUrl as string;
  }

  async send(alert: BurnRateAlert): Promise<{ success: boolean; externalId?: string; errorMessage?: string }> {
    const themeColor = alert.level === 'critical' ? 'FF0000'
      : alert.level === 'escalation' ? 'FFA500'
      : alert.level === 'warning' ? 'FFD700'
      : '00FF00';

    const facts = [{ name: 'Alert Level', value: alert.level.toUpperCase() }];

    const data = alert.data;
    if (data.totalBudget !== undefined) facts.push({ name: 'Total Budget', value: `$${Number(data.totalBudget).toFixed(2)}` });
    if (data.budgetUsed !== undefined) facts.push({ name: 'Budget Used', value: `$${Number(data.budgetUsed).toFixed(2)}` });
    if (data.pctUsed !== undefined) facts.push({ name: '% Used', value: `${Number(data.pctUsed).toFixed(1)}%` });
    if (data.pctElapsed !== undefined) facts.push({ name: '% Elapsed', value: `${Number(data.pctElapsed).toFixed(1)}%` });

    const payload = {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: alert.subject,
      themeColor,
      title: alert.subject,
      text: alert.body,
      sections: [
        {
          facts,
          markdown: true,
        },
      ],
    };

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Teams webhook returned ${response.status} ${response.statusText}`);
    }

    return { success: true, externalId: 'teams' };
  }
}
