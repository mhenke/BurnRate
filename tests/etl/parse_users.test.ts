import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { parseEnterpriseReportToUsers } from '../../src/etl/parse_users.js';
import { parseDailyUsage } from '../../src/etl/parse_enterprise.js';
import { parseTeamUsage } from '../../src/etl/parse_teams.js';
import { parseSeatsToUsers } from '../../src/etl/parse_seats.js';

describe('ETL parse functions', () => {
  it('parses enterprise report to users', () => {
    const rows = parseEnterpriseReportToUsers('acme', 'acme-inc', {
      report_day: '2026-06-12',
      data: [{ github_login: 'jdoe' }],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].githubLogin, 'jdoe');
    assert.equal(rows[0].enterprise, 'acme');
    assert.equal(rows[0].org, 'acme-inc');
  });

  it('parses daily usage report', () => {
    const report = {
      report_day: '2026-06-12',
      data: [{
        github_login: 'jdoe',
        credits_used: 150.5,
        tokens_input: 1000,
        tokens_output: 2000,
        chat_requests: 10,
        agent_requests: 5,
        accepted_lines: 50,
        suggested_lines: 100,
        model_breakdown: { gpt4: 10 },
        ide_breakdown: { vscode: 10 },
        language_breakdown: { typescript: 10 }
      }]
    };
    const rows = parseDailyUsage(report);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].usageDate, '2026-06-12');
    assert.equal(rows[0].githubLogin, 'jdoe');
    assert.equal(rows[0].credits, '150.5'); // numeric column in schema is string/numeric
    assert.equal(rows[0].tokensInput, 1000n);
    assert.equal(rows[0].tokensOutput, 2000n);
    assert.equal(rows[0].chatRequests, 10);
    assert.equal(rows[0].agentRequests, 5);
    assert.equal(rows[0].acceptedLines, 50);
    assert.equal(rows[0].suggestedLines, 100);
    assert.equal(rows[0].acceptanceRate, '0.5000');
    assert.equal(rows[0].creditsPerAccLoc, '3.0100');
  });

  it('parses team usage report', () => {
    const report = {
      report_day: '2026-06-12',
      data: [{
        team: 'platform',
        credits_used: 500,
        active_users: 5,
        avg_acceptance_rate: 0.45
      }]
    };
    const rows = parseTeamUsage(report);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].usageDate, '2026-06-12');
    assert.equal(rows[0].team, 'platform');
    assert.equal(rows[0].credits, '500');
    assert.equal(rows[0].activeUsers, 5);
    assert.equal(rows[0].avgAcceptanceRate, '0.4500');
  });

  it('parses seat data to users list', () => {
    const seats = [
      {
        assignee: { login: 'user1' },
        created_at: '2026-01-01T00:00:00Z',
        last_activity_at: '2026-06-12T12:00:00Z'
      }
    ] as any[];
    const rows = parseSeatsToUsers('acme', 'acme-inc', seats);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].githubLogin, 'user1');
    assert.equal(rows[0].enterprise, 'acme');
    assert.equal(rows[0].org, 'acme-inc');
    assert.equal(rows[0].seatCreatedAt, '2026-01-01T00:00:00Z');
    assert.equal(rows[0].lastActivityAt, '2026-06-12T12:00:00Z');
  });
});
