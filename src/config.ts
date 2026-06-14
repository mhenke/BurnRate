import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

export type BurnrateThresholds = {
  alert: { warningPct: number; escalationPct: number; criticalPct: number };
  classify: { extremePct: number; highPct: number; mediumPct: number };
  forecast: { trendSlope: number; anomalyZscore: number };
};

export const DEFAULT_THRESHOLDS: BurnrateThresholds = {
  alert: { warningPct: 90, escalationPct: 100, criticalPct: 110 },
  classify: { extremePct: 0.85, highPct: 0.60, mediumPct: 0.25 },
  forecast: { trendSlope: 0.1, anomalyZscore: 2.5 },
};

export type BurnrateConfig = {
  github: { enterprise: string; org: string; token: string };
  postgres: { url: string };
  thresholds?: Partial<BurnrateThresholds>;
};

/**
 * Merge user-supplied thresholds with defaults.
 */
export function resolveThresholds(
  thresholds: BurnrateConfig['thresholds'] = {},
): BurnrateThresholds {
  return {
    alert: { ...DEFAULT_THRESHOLDS.alert, ...thresholds.alert },
    classify: { ...DEFAULT_THRESHOLDS.classify, ...thresholds.classify },
    forecast: { ...DEFAULT_THRESHOLDS.forecast, ...thresholds.forecast },
  };
}

function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => process.env[name] ?? '');
}

function expandConfig<T>(obj: T): T {
  if (typeof obj === 'string') return expandEnv(obj) as T;
  if (obj && typeof obj === 'object') {
    const result: any = Array.isArray(obj) ? [] : {};
    for (const key of Object.keys(obj as any)) {
      result[key] = expandConfig((obj as any)[key]);
    }
    return result;
  }
  return obj;
}

/**
 * Load and validate the BurnRate YAML config file.
 */
export function loadConfig(filePath: string): BurnrateConfig {
  let fileConfig: Partial<BurnrateConfig> = {};

  try {
    const yamlContent = readFileSync(filePath, 'utf8');
    fileConfig = expandConfig(parse(yamlContent)) as Partial<BurnrateConfig>;
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  const enterprise = process.env.GITHUB_ENTERPRISE || fileConfig.github?.enterprise;
  const org = process.env.GITHUB_ORG || fileConfig.github?.org;
  const token = process.env.GITHUB_TOKEN || fileConfig.github?.token;
  const url = process.env.DATABASE_URL || fileConfig.postgres?.url;

  if (!enterprise) throw new Error('Missing burnrate.yml github.enterprise');
  if (!org) throw new Error('Missing burnrate.yml github.org');
  if (!token) throw new Error('Missing burnrate.yml github.token');
  if (!url) throw new Error('Missing burnrate.yml postgres.url');

  return {
    github: { enterprise, org, token },
    postgres: { url },
    thresholds: fileConfig.thresholds,
  };
}

