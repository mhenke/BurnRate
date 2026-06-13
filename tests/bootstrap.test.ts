import { it, expect } from 'vitest';

it('imports the main module', async () => {
  await expect(import('../src/index.js')).resolves.toBeDefined();
});
