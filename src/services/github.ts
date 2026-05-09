import type { GitHubClient, GitHubRelease } from '../types/index.ts';
import { REPO_REGEX } from '../constants/index.ts';

export const createGitHubClient = (baseUrl: string, token?: string): GitHubClient => {
    const getLatestRelease = async (repo: string): Promise<GitHubRelease | null> => {
        if (!REPO_REGEX.test(repo)) {
            throw new Error('Invalid repository format');
        }

        const response = await fetch(`${baseUrl}/repos/${repo}/releases/latest`, {
            headers: token
                ? {
                      Authorization: `token ${token}`,
                      'X-GitHub-Api-Version': '2026-03-10',
                  }
                : { 'X-GitHub-Api-Version': '2026-03-10' },
            method: 'GET',
        });

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }

        return response.json();
    };

    return { getLatestRelease };
};
