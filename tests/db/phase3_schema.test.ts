import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import * as schema from '../../src/db/schema.js';

describe('phase 3 schema', () => {
  it('defines budget_snapshots for both postgres and sqlite', () => {
    assert.ok(schema.budgetSnapshotsPg, 'budgetSnapshotsPg should be defined');
    assert.ok(schema.budgetSnapshotsSq, 'budgetSnapshotsSq should be defined');
  });
  it('defines notification_log for both postgres and sqlite', () => {
    assert.ok(schema.notificationLogPg, 'notificationLogPg should be defined');
    assert.ok(schema.notificationLogSq, 'notificationLogSq should be defined');
  });
});
