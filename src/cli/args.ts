/**
 * CLI argument parsing helpers for BurnRate commands.
 *
 * Extracted from index.ts so the CLI dispatch layer stays thin and these
 * helpers can be tested and reused if the CLI grows further commands.
 *
 * Design note: `slurpArg` handles both `--flag=value` and `--flag value`
 * forms so callers do not need to pre-normalize argv.
 */
import { existsSync } from 'node:fs';

/** Parse a single flag value that may be given as `--flag=val` or `--flag val`. */
export function slurpArg(argv: string[], i: number, flag: string): { value: string; nextIndex: number } {
  const arg = argv[i];
  if (arg.startsWith(flag + '=')) {
    return { value: arg.slice((flag + '=').length), nextIndex: i };
  }
  const next = argv[i + 1];
  if (!next || next.startsWith('--')) {
    throw new Error(`Missing value after ${flag}`);
  }
  return { value: next, nextIndex: i + 1 };
}

/** Parse flags for the `classify` sub-command. */
export function parseClassifyArgs(argv: string[]): { valueConfigPath: string; report: boolean } {
  let valueConfigPath = process.env.VALUE_CONFIG_PATH ?? 'config/value_config.yml';
  let report = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--report') {
      report = true;
      continue;
    }

    if (arg.startsWith('--value-config')) {
      const { value, nextIndex } = slurpArg(argv, index, '--value-config');
      valueConfigPath = value;
      index = nextIndex;
      continue;
    }

    throw new Error(`Unknown classify flag: ${arg}`);
  }

  if (!process.env.VALUE_CONFIG_PATH && valueConfigPath === 'config/value_config.yml' && !existsSync(valueConfigPath)) {
    valueConfigPath = 'config/value_config.sample.yml';
  }

  return { valueConfigPath, report };
}

/** Parse flags for the `etl` sub-command. */
export function parseEtlArgs(argv: string[]): { day: string; userSupplied: boolean } {
  let userSupplied = false;
  let day: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg.startsWith('--day')) {
      const { value, nextIndex } = slurpArg(argv, index, '--day');
      day = value;
      userSupplied = true;
      index = nextIndex;
      continue;
    }

    throw new Error(`Unknown etl flag: ${arg}`);
  }

  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error('Day must be in YYYY-MM-DD format');
  }

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return {
    day: day ?? yesterday,
    userSupplied,
  };
}
