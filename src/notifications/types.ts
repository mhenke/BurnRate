import type { AlertLevel } from '../constants.js';

export type NotificationChannel = string;

export type NotificationResult = {
  success: boolean;
  channel: NotificationChannel;
  externalId?: string;
  errorMessage?: string;
};

export interface BurnRateAlert {
  id: string;
  timestamp: Date;
  level: AlertLevel;
  persistentDays: number;
  type: 'budget' | 'pool' | 'user' | 'team';
  subject: string;
  body: string;
  data: Record<string, unknown>;
  tags: string[];
}

export type NotificationProviderConfig = {
  type: string;
  enabled?: boolean;
  minLevel?: AlertLevel;
  [key: string]: unknown;
};

export type NotificationsConfig = {
  renotifyHours?: number;
  escalateDays?: number;
  providers: NotificationProviderConfig[];
};
