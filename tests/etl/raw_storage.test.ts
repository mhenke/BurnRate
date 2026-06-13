import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { normalizeRawReport } from '../../src/etl/raw_storage.js';

describe('raw storage normalization', () => {
  it('normalizes raw report data', () => {
    const result = normalizeRawReport({
      report_type: 'users-1-day',
      report_date: '2026-06-12',
      source_url: 'https://example.com',
      payload: {}
    });
    assert.equal(result.report_date, '2026-06-12');
    assert.equal(result.report_type, 'users-1-day');
    assert.ok(result.fetched_at);
  });
});
