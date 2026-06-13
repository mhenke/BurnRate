import { strict as assert } from 'node:assert';
import { describe, it, vi, afterEach } from 'vitest';
import { createGitHubClient } from '../../src/github/client.js';

describe('github client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a github client with correct enterprise and org', () => {
    const client = createGitHubClient('token', 'acme', 'acme-inc');
    assert.equal(client.enterprise, 'acme');
    assert.equal(client.org, 'acme-inc');
    assert.equal(typeof client.fetchSignedUrl, 'function');
    assert.ok(client.octokit);
  });

  it('fetchSignedUrl fetches and parses json successfully', async () => {
    const client = createGitHubClient('token', 'acme', 'acme-inc');
    const mockResponse = { data: 'test' };
    
    // Mock global fetch
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await client.fetchSignedUrl('https://example.com/signed-url');
    assert.deepEqual(result, mockResponse);
    assert.equal(fetchMock.mock.calls[0][0], 'https://example.com/signed-url');
  });

  it('fetchSignedUrl throws error when response is not ok', async () => {
    const client = createGitHubClient('token', 'acme', 'acme-inc');
    
    // Mock global fetch
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
    vi.stubGlobal('fetch', fetchMock);

    await assert.rejects(
      () => client.fetchSignedUrl('https://example.com/bad-url'),
      /Signed URL fetch failed: 404 Not Found/
    );
  });
});
