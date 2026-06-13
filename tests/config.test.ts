import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('config', () => {
  it('throws when environment variables are missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'burnrate-'));
    const file = join(dir, 'burnrate.yml');
    // Ensure the relevant env variables are cleared for this test
    const oldToken = process.env.GITHUB_TOKEN;
    const oldUrl = process.env.DATABASE_URL;
    delete process.env.GITHUB_TOKEN;
    delete process.env.DATABASE_URL;

    try {
      writeFileSync(
        file,
        `github:\n  enterprise: acme\n  org: acme-inc\n  token: \${GITHUB_TOKEN}\npostgres:\n  url: \${DATABASE_URL}\n`,
        'utf8',
      );
      assert.throws(() => loadConfig(file), /Missing burnrate.yml/);
    } finally {
      process.env.GITHUB_TOKEN = oldToken;
      process.env.DATABASE_URL = oldUrl;
    }
  });

  it('loads valid configuration and expands env variables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'burnrate-'));
    const file = join(dir, 'burnrate.yml');
    
    // Set test environment variables
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test';

    try {
      writeFileSync(
        file,
        `github:\n  enterprise: acme\n  org: acme-inc\n  token: \${GITHUB_TOKEN}\npostgres:\n  url: \${DATABASE_URL}\n`,
        'utf8',
      );
      const config = loadConfig(file);
      assert.equal(config.github.enterprise, 'acme');
      assert.equal(config.github.org, 'acme-inc');
      assert.equal(config.github.token, 'test-token');
      assert.equal(config.postgres.url, 'postgresql://localhost:5432/test');
    } finally {
      delete process.env.GITHUB_TOKEN;
      delete process.env.DATABASE_URL;
    }
  });
});
