import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import * as schema from '../../src/db/schema.js';

describe('schema', () => {
  it('defines the expected tables for both postgres and sqlite', () => {
    assert.ok(schema.rawReportsPg, 'rawReportsPg should be defined');
    assert.ok(schema.rawReportsSq, 'rawReportsSq should be defined');
    assert.ok(schema.usersPg, 'usersPg should be defined');
    assert.ok(schema.usersSq, 'usersSq should be defined');
    assert.ok(schema.dailyUsagePg, 'dailyUsagePg should be defined');
    assert.ok(schema.dailyUsageSq, 'dailyUsageSq should be defined');
    assert.ok(schema.teamUsagePg, 'teamUsagePg should be defined');
    assert.ok(schema.teamUsageSq, 'teamUsageSq should be defined');
    assert.ok(schema.classificationHistoryPg, 'classificationHistoryPg should be defined');
    assert.ok(schema.classificationHistorySq, 'classificationHistorySq should be defined');
    assert.ok(schema.poolSnapshotsPg, 'poolSnapshotsPg should be defined');
    assert.ok(schema.poolSnapshotsSq, 'poolSnapshotsSq should be defined');
  });
});
