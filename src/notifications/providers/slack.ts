import type { BurnRateAlert, NotificationProviderConfig } from '../types.js';
import { BaseProvider } from '../provider.js';
import { sanitizeErrorMessage } from '../sanitize.js';

export class SlackProvider extends BaseProvider {
  readonly name = 'slack';

  private webhookUrl: string;
  private channel: string;
  private username: string;

  constructor(config: NotificationProviderConfig) {
    super(config.minLevel as BaseProvider['minLevel'] | undefined);
    this.webhookUrl = config.webhookUrl as string;
    this.channel = (config.channel as string) || '#alerts';
    this.username = (config.username as string) || 'BurnRate Bot';
  }

  async send(alert: BurnRateAlert): Promise<{ success: boolean; externalId?: string; errorMessage?: string }> {
    const color = alert.level === 'critical' ? 'danger'
      : alert.level === 'escalation' ? 'warning'
      : alert.level === 'warning' ? 'warning'
      : 'good';

    const fields = [
      { title: 'Alert Level', value: alert.level.toUpperCase(), short: true },
    ];

    const data = alert.data;
    if (data.totalBudget !== undefined) {
      fields.push({ title: 'Total Budget', value: `$${Number(data.totalBudget).toFixed(2)}`, short: true });
    }
    if (data.budgetUsed !== undefined) {
      fields.push({ title: 'Budget Used', value: `$${Number(data.budgetUsed).toFixed(2)}`, short: true });
    }
    if (data.budgetRemaining !== undefined) {
      fields.push({ title: 'Budget Remaining', value: `$${Number(data.budgetRemaining).toFixed(2)}`, short: true });
    }
    if (data.pctUsed !== undefined) {
      fields.push({ title: '% Used', value: `${Number(data.pctUsed).toFixed(1)}%`, short: true });
    }
    if (data.pctElapsed !== undefined) {
      fields.push({ title: '% Elapsed', value: `${Number(data.pctElapsed).toFixed(1)}%`, short: true });
    }

    const payload = {
      channel: this.channel,
      username: this.username,
      icon_emoji: ':warning:',
      attachments: [
        {
          color,
          title: alert.subject,
          text: alert.body,
          fields,
          footer: `BurnRate Alert • ${alert.id}`,
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
      throw new Error(`Slack webhook returned ${response.status} ${response.statusText}`);
    }

    return { success: true, externalId: this.channel };
  }
}
