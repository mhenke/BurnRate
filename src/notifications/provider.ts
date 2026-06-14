import type { BurnRateAlert, NotificationChannel, NotificationResult } from './types.js';
import type { AlertLevel } from '../constants.js';

const DEFAULT_MIN_LEVEL: AlertLevel = 'warning';

const LEVEL_WEIGHT: Record<AlertLevel, number> = {
  ok: 0,
  warning: 1,
  escalation: 2,
  critical: 3,
};

export interface NotificationProvider {
  readonly name: NotificationChannel;
  readonly minLevel: AlertLevel;

  send(alert: BurnRateAlert): Promise<Omit<NotificationResult, 'channel'>>;
}

export function alertMeetsMinLevel(alertLevel: AlertLevel, minLevel: AlertLevel): boolean {
  return LEVEL_WEIGHT[alertLevel] >= LEVEL_WEIGHT[minLevel];
}

export abstract class BaseProvider implements NotificationProvider {
  abstract readonly name: NotificationChannel;

  readonly minLevel: AlertLevel;

  constructor(minLevel?: AlertLevel) {
    this.minLevel = minLevel ?? DEFAULT_MIN_LEVEL;
  }

  abstract send(alert: BurnRateAlert): Promise<Omit<NotificationResult, 'channel'>>;
}
