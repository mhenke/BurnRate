import { Octokit } from 'octokit';
import { URL } from 'node:url';

export const GITHUB_API_VERSION = '2026-03-10';

export type GitHubClient = {
  octokit: Octokit;
  enterprise: string;
  org: string;
  fetchSignedUrl: <T>(url: string) => Promise<T>;
};

/**
 * Create a GitHub API client with Octokit, configured for the target org or enterprise.
 */
export function createGitHubClient(token: string, enterprise: string | undefined, org: string): GitHubClient {
  enterprise = enterprise ?? '';
  const octokit = new Octokit({
    auth: token,
    baseUrl: 'https://api.github.com',
    request: {
      timeout: 15000,
      headers: {
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
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

