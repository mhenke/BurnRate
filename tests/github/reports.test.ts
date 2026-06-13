import { strict as assert } from 'node:assert';
import { describe, it, vi } from 'vitest';
import { buildReportUrls, fetchReport } from '../../src/github/reports.js';
import { fetchAllSeats } from '../../src/github/seats.js';

describe('reports and seats API', () => {
  it('builds the correct report URL with date', () => {
    assert.equal(
      buildReportUrls('acme', 'enterprise-1-day', '2026-06-12')[0],
      '/enterprises/acme/copilot/metrics/reports/enterprise-1-day?day=2026-06-12'
    );
    assert.equal(
      buildReportUrls('acme', 'enterprise-28-day')[0],
      '/enterprises/acme/copilot/metrics/reports/enterprise-28-day'
    );
  });

  it('buildReportUrls throws on 1-day report when day is missing', () => {
    assert.throws(() => buildReportUrls('acme', 'enterprise-1-day'), /day is required/);
  });

  it('fetchReport requests the correct URL and returns data', async () => {
    const mockData = { download_links: ['https://example.com/link'], report_day: '2026-06-12' };
    const octokitMock = {
      request: vi.fn().mockResolvedValue({ data: mockData }),
    };
    const client = {
      octokit: octokitMock,
      enterprise: 'acme',
      fetchSignedUrl: async () => ({}),
    };

    const result = await fetchReport(client, 'enterprise-1-day', '2026-06-12');
    assert.deepEqual(result, mockData);
    assert.equal(octokitMock.request.mock.calls[0][0], 'GET /enterprises/acme/copilot/metrics/reports/enterprise-1-day?day=2026-06-12');
  });

  it('fetchAllSeats paginately fetches seats', async () => {
    const seatsPage1 = [{ assignee: { login: 'user1' } }] as any[];
    const seatsPage2 = [{ assignee: { login: 'user2' } }] as any[];
    
    const iteratorMock = {
      async *[Symbol.asyncIterator]() {
        yield { data: { seats: seatsPage1 } };
        yield { data: { seats: seatsPage2 } };
      }
    };
    const paginateMock = {
      iterator: vi.fn().mockReturnValue(iteratorMock),
    };
    
    const client: any = {
      octokit: {
        paginate: paginateMock,
        rest: {
          enterpriseAdmin: {
            listCopilotSeatsForEnterprise: {}
          }
        }
      },
      enterprise: 'acme',
      org: 'acme-inc'
    };

    const result = await fetchAllSeats(client);
    assert.deepEqual(result, [...seatsPage1, ...seatsPage2]);
    assert.equal(paginateMock.iterator.mock.calls[0][1].enterprise, 'acme');
  });
});
