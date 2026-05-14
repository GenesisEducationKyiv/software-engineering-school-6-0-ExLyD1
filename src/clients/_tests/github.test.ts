import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGitHubClient } from '../github.ts';
import { GitHubApiError, InvalidRepoFormatError } from '../../errors/index.ts';

const BASE_URL = 'https://api.github.com';

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('createGitHubClient', () => {
    describe('getLatestRelease', () => {
        it('returns release data on 200', async () => {
            const release = { tag_name: 'v1.2.3', name: 'Release 1.2.3' };
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => release,
            });

            const client = createGitHubClient(BASE_URL);
            const result = await client.getLatestRelease('microsoft/vscode');
            expect(result).toEqual(release);
            expect(mockFetch).toHaveBeenCalledWith(
                `${BASE_URL}/repos/microsoft/vscode/releases/latest`,
                expect.any(Object),
            );
        });

        it('returns null on 404 (repo has no releases, e.g. uses tags only)', async () => {
            mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

            const client = createGitHubClient(BASE_URL);
            const result = await client.getLatestRelease('golang/go');
            expect(result).toBeNull();
        });

        it('throws on 429 rate limit', async () => {
            mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });

            const client = createGitHubClient(BASE_URL);
            await expect(client.getLatestRelease('microsoft/vscode')).rejects.toThrow(
                GitHubApiError,
            );
        });

        it('throws on 500 server error', async () => {
            mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

            const client = createGitHubClient(BASE_URL);
            await expect(client.getLatestRelease('microsoft/vscode')).rejects.toThrow(
                GitHubApiError,
            );
        });

        it('throws on invalid repo format', async () => {
            const client = createGitHubClient(BASE_URL);
            await expect(client.getLatestRelease('not-a-valid-repo')).rejects.toThrow(
                InvalidRepoFormatError,
            );
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('passes Authorization header when token is provided', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ tag_name: 'v1.0.0' }),
            });

            const client = createGitHubClient(BASE_URL, 'my-token');
            await client.getLatestRelease('microsoft/vscode');

            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: 'token my-token' }),
                }),
            );
        });
    });
});
