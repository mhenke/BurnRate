import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { loadValueConfig, resolveValueTier } from '../../src/classify/value_config.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('value config', () => {
  it('loads valid config and resolves tiers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'burnrate-'));
    const file = join(dir, 'value_config.yml');
    writeFileSync(
      file,
      `critical:\n  teams:\n    - platform\n  title_patterns:\n    - ".*engineer.*"\nnormal:\n  teams:\n    - product\nlow_priority:\n  teams:\n    - marketing\n`,
      'utf8',
    );

    const config = loadValueConfig(file);
    assert.deepEqual(config.critical.teams, ['platform']);
    assert.deepEqual(config.normal.teams, ['product']);
    assert.deepEqual(config.low_priority.teams, ['marketing']);

    // Case-insensitive matching
    assert.equal(resolveValueTier('Platform', config), 'critical');
    assert.equal(resolveValueTier('platform', config), 'critical');
    assert.equal(resolveValueTier('PRODUCT', config), 'normal');
    assert.equal(resolveValueTier('marketing', config), 'low_priority');

    // Unknown team defaults to normal
    assert.equal(resolveValueTier('unknown', config), 'normal');

    // Null team defaults to normal
    assert.equal(resolveValueTier(null, config), 'normal');

    // title_patterns is ignored (forward-compatible)
    assert.ok('title_patterns' in config.critical);
  });

  it('throws on missing file', () => {
    assert.throws(() => loadValueConfig('/nonexistent/file.yml'), /ENOENT/);
  });

  it('throws on missing required keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'burnrate-'));
    const file = join(dir, 'value_config.yml');
    writeFileSync(file, `critical:\n  teams:\n    - platform\n`, 'utf8');
    assert.throws(() => loadValueConfig(file), /Missing value_config.yml key: normal/);
  });

  it('throws on malformed teams array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'burnrate-'));
    const file = join(dir, 'value_config.yml');
    writeFileSync(file, `critical:\n  teams: platform\n`, 'utf8');
    assert.throws(() => loadValueConfig(file), /must be an array/);
  });
});
