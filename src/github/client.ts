import { Octokit } from 'octokit';

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
      headers: {
        'X-GitHub-Api-Version': '2026-03-10',
      },
    },
  });

  async function fetchSignedUrl<T>(url: string): Promise<T> {
    // Signed URLs expire — fetch and parse immediately
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Signed URL fetch failed: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  return { octokit, enterprise, org, fetchSignedUrl };
}
