import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

export type BurnrateConfig = {
  github: { enterprise: string; org: string; token: string };
  postgres: { url: string };
};

function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => process.env[name] ?? '');
}

export function loadConfig(filePath: string): BurnrateConfig {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = parse(expandEnv(raw)) as Partial<BurnrateConfig>;
  if (!parsed.github?.enterprise) throw new Error('Missing burnrate.yml github.enterprise');
  if (!parsed.github?.org) throw new Error('Missing burnrate.yml github.org');
  if (!parsed.github?.token) throw new Error('Missing burnrate.yml github.token');
  if (!parsed.postgres?.url) throw new Error('Missing burnrate.yml postgres.url');
  return parsed as BurnrateConfig;
}
