import { Octokit } from 'octokit';
import { URL } from 'node:url';

export type GitHubClient = {
  octokit: Octokit;
  enterprise: string;
  org: string;
  fetchSignedUrl: <T>(url: string) => Promise<T>;
};

export function createGitHubClient(token: string, enterprise: string, org: string): GitHubClient {
  const octokit = new Octokit({
    auth: token,
    baseUrl: 'https://api.github.com',
    request: {
      timeout: 15000,
      headers: {
        'X-GitHub-Api-Version': '2026-03-10',
      },
    },
  });

  async function fetchSignedUrl<T>(urlStr: string): Promise<T> {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') {
      throw new Error('SSRF Prevention: Only HTTPS is permitted');
    }

    const allowedHosts = [
      'api.github.com',
      'github.com',
      'github-cloud.s3.amazonaws.com',
      'github-cloud.githubusercontent.com'
    ];

    const isWhitelisted = allowedHosts.some(
      allowed => parsed.hostname === allowed || parsed.hostname.endsWith('.' + allowed)
    );

    if (!isWhitelisted) {
      throw new Error(`SSRF Prevention: Host ${parsed.hostname} is not whitelisted`);
    }

    // Signed URLs expire — fetch and parse immediately
    const response = await fetch(urlStr, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      throw new Error(`Signed URL fetch failed: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  return { octokit, enterprise, org, fetchSignedUrl };
}

