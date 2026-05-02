import type { GitHubRelease } from '../types/index.ts';
import { REPO_REGEX } from '../constants/index.ts';

export const getLatestRelease = async (repo: string): Promise<GitHubRelease | null> => {
    if (!REPO_REGEX.test(repo)) {
        throw new Error('Invalid repository format');
    }

    const response = await fetch(`${process.env.GITHUB_BASE_URL}/repos/${repo}/releases/latest`, {
        headers: process.env.GITHUB_TOKEN
            ? {
                  Authorization: `token ${process.env.GITHUB_TOKEN}`,
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
