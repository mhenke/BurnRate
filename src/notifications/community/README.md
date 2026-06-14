# Writing a BurnRate Notification Provider

BurnRate's notification system uses a provider plugin pattern. Each channel (Slack,
Teams, Outlook, GitHub Issues, Discord, etc.) is a separate provider that implements
one interface. This keeps channel logic isolated and makes it easy to add new channels.

## The Interface

```typescript
import type { BurnRateAlert, NotificationResult } from 'burnrate/notifications';

export interface NotificationProvider {
  /** Unique channel identifier (e.g. 'discord', 'pagerduty'). */
  readonly name: string;

  /** Minimum alert level this provider should receive. */
  readonly minLevel: AlertLevel;

  /** Send the alert. Return success/failure — never throw. */
  send(alert: BurnRateAlert): Promise<Omit<NotificationResult, 'channel'>>;
}
```

## The Alert Type

Every provider receives the same structured alert:

```typescript
interface BurnRateAlert {
  id: string;                // unique alert ID for dedup
  timestamp: Date;           // when the alert was generated
  level: AlertLevel;         // 'ok' | 'warning' | 'escalation' | 'critical'
  persistentDays: number;    // consecutive days at this level
  type: 'budget' | 'pool' | 'user' | 'team';
  subject: string;           // one-line summary
  body: string;              // full plain text description
  data: Record<string, unknown>;  // alert-specific rich data (budget numbers, etc.)
  tags: string[];            // ['budget', 'critical', ...]
}
```

Use `subject` + `body` for simple text delivery. Reach into `data` for rich formatting
(Adaptive Cards, HTML email, embeds).

## BaseProvider

Extend `BaseProvider` for automatic `minLevel` handling:

```typescript
import { BaseProvider } from 'burnrate/notifications';

export class DiscordProvider extends BaseProvider {
  readonly name = 'discord';

  constructor(config: NotificationProviderConfig) {
    super(config.minLevel as AlertLevel | undefined);
    // read your config fields
  }

  async send(alert: BurnRateAlert): Promise<{ success: boolean; externalId?: string }> {
    // format and POST to Discord webhook
    const response = await fetch(this.webhookUrl, { ... });
    return { success: response.ok, externalId: 'discord' };
  }
}
```

## Registering Your Provider

### Option A: PR into BurnRate

1. Add your provider class in `src/notifications/providers/`
2. Register it in `src/notifications/service.ts` BUILTIN_PROVIDERS map
3. Submit a PR

### Option B: Separate npm package

1. Publish your provider as `burnrate-provider-discord`
2. Users import and register it in their config

## Configuration

Users enable your provider in `burnrate.yml`:

```yaml
notifications:
  renotifyHours: 24
  escalateDays: 3
  providers:
    - type: discord
      enabled: true
      minLevel: warning         # only warning/critical/escalation
      webhookUrl: ${DISCORD_WEBHOOK_URL}
```

## Testing

Your provider constructor receives arbitrary config. This means you can pass custom
test values without coupling to BurnRate internals.

## Alternatives for Microsoft 365

### Teams via Graph API (instead of webhook)

```typescript
POST https://graph.microsoft.com/v1.0/teams/{team-id}/channels/{channel-id}/messages
```

Requires Azure app registration with `ChannelMessage.Send` permission (application,
not delegated). Uses the same client credentials flow as the Outlook provider.

### Outlook via SMTP (instead of Graph API)

For environments without Graph API access, an SMTP provider is straightforward:

```typescript
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: config.smtpHost,
  port: config.smtpPort,
  auth: { user: config.smtpUser, pass: config.smtpPass },
});
```

Both Graph API and SMTP providers implement the same `NotificationProvider` interface
— users pick whichever fits their infrastructure.
