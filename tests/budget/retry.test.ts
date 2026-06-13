import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { withRetry } from '../../src/budget/retry.js';

describe('retry utility', () => {
  it('exports withRetry function', () => {
    assert.equal(typeof withRetry, 'function');
  });

  it('resolves immediately on success', async () => {
    const result = await withRetry(() => Promise.resolve('ok'), {
      maxAttempts: 3,
      delays: [100, 200],
    });
    assert.equal(result, 'ok');
  });

  it('retries on failure and eventually succeeds', async () => {
    let attempts = 0;
    const result = await withRetry(() => {
      attempts++;
      return attempts === 3 ? Promise.resolve('ok') : Promise.reject(new Error('fail'));
    }, {
      maxAttempts: 3,
      delays: [10, 10],
      delayFn: () => Promise.resolve(),
    });
    assert.equal(result, 'ok');
    assert.equal(attempts, 3);
  });

  it('throws after exhausting all retries', async () => {
    const fn = () => Promise.reject(new Error('persistent'));
    await assert.rejects(
      () => withRetry(fn, { maxAttempts: 3, delays: [10, 10], delayFn: () => Promise.resolve() }),
      /persistent/,
    );
  });

  it('calls onRetry callback between attempts', async () => {
    const calls: Array<{ attempt: number; error: string }> = [];
    let attempts = 0;
    await withRetry(() => {
      attempts++;
      return attempts === 2 ? Promise.resolve('ok') : Promise.reject(new Error('fail'));
    }, {
      maxAttempts: 3,
      delays: [10, 10],
      delayFn: () => Promise.resolve(),
      onRetry: (attempt, error) => calls.push({ attempt, error: error.message }),
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].attempt, 1);
    assert.equal(calls[0].error, 'fail');
  });

  it('uses injectable delayFn', async () => {
    const delays: number[] = [];
    const delayFn = async (ms: number) => { delays.push(ms); };
    let attempts = 0;
    await withRetry(() => {
      attempts++;
      return attempts === 2 ? Promise.resolve('ok') : Promise.reject(new Error('fail'));
    }, {
      maxAttempts: 3,
      delays: [50, 100],
      delayFn,
    });
    assert.deepEqual(delays, [50]);
  });

  it('wraps non-Error throws in Error', async () => {
    const fn = () => Promise.reject('string error');
    await assert.rejects(
      () => withRetry(fn, { maxAttempts: 1, delays: [], delayFn: () => Promise.resolve() }),
      /string error/,
    );
  });
});
