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

export function parseClassifyArgs(argv: string[]): { report: boolean } {
  let report = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--report') {
      report = true;
      continue;
    }

    throw new Error(`Unknown classify flag: ${arg}`);
  }

  return { report };
}

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

export function parseEnforceArgs(argv: string[]): { report: boolean; dryRun: boolean } {
  let report = false;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--report') { report = true; continue; }
    if (arg === '--dry-run') { dryRun = true; continue; }

    throw new Error(`Unknown enforce flag: ${arg}`);
  }

  return { report, dryRun };
}
