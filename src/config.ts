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

function expandEnvObj(obj: any): any {
  if (typeof obj === 'string') {
    return expandEnv(obj);
  }
  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj)) {
      return obj.map(expandEnvObj);
    }
    const result: any = {};
    for (const key of Object.keys(obj)) {
      result[key] = expandEnvObj(obj[key]);
    }
    return result;
  }
  return obj;
}

export function loadConfig(filePath: string): BurnrateConfig {
  let fileConfig: Partial<BurnrateConfig> = {};

  try {
    const raw = readFileSync(filePath, 'utf8');
    fileConfig = expandEnvObj(parse(raw)) as Partial<BurnrateConfig>;
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
  };
}

