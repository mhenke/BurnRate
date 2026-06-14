import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export type ValueTier = 'critical' | 'normal' | 'low_priority';

export type ValueConfig = {
  critical: { teams: string[]; title_patterns?: string[] };
  normal: { teams: string[]; title_patterns?: string[] };
  low_priority: { teams: string[]; title_patterns?: string[] };
};

function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => process.env[name] ?? '');
}

/**
 * Load and parse the value tier YAML config file.
 */
export function loadValueConfig(filePath: string): ValueConfig {
  const yamlContent = readFileSync(filePath, 'utf8');
  const parsed = parse(expandEnv(yamlContent)) as Partial<ValueConfig>;

  // Validate required keys
  const required = ['critical', 'normal', 'low_priority'] as const;
  for (const key of required) {
    if (!parsed[key]) {
      throw new Error(`Missing value_config.yml key: ${key}`);
    }
    if (!Array.isArray(parsed[key]?.teams)) {
      throw new Error(`value_config.yml ${key}.teams must be an array`);
    }
  }

  return parsed as ValueConfig;
}

/**
 * Resolve a team name to its configured value tier.
 */
export function resolveValueTier(team: string | null, config: ValueConfig): ValueTier {
  if (!team) return 'normal';

  const normalizedTeam = team.toLowerCase().trim();

  // First match wins
  if (config.critical.teams.some(t => t.toLowerCase().trim() === normalizedTeam)) {
    return 'critical';
  }
  if (config.low_priority.teams.some(t => t.toLowerCase().trim() === normalizedTeam)) {
    return 'low_priority';
  }
  // Default to normal (includes unknown teams and explicit normal list)
  return 'normal';
}
