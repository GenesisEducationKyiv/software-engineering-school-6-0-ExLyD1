import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLatestRelease } from '../github';

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
    process.env.GITHUB_BASE_URL = 'https://api.github.com';
    process.env.GITHUB_TOKEN = '';
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('getLatestRelease', () => {
    it('returns release data on 200', async () => {
        const release = { tag_name: 'v1.2.3', name: 'Release 1.2.3' };
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => release,
        });

        const result = await getLatestRelease('microsoft/vscode');
        expect(result).toEqual(release);
        expect(mockFetch).toHaveBeenCalledWith(
            'https://api.github.com/repos/microsoft/vscode/releases/latest',
            expect.any(Object),
        );
    });

    it('returns null on 404 (repo has no releases, e.g. uses tags only)', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 404,
        });

        const result = await getLatestRelease('golang/go');
        expect(result).toBeNull();
    });

    it('throws on 429 rate limit', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 429,
        });

        await expect(getLatestRelease('microsoft/vscode')).rejects.toThrow('GitHub API error: 429');
    });

    it('throws on 500 server error', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
        });

        await expect(getLatestRelease('microsoft/vscode')).rejects.toThrow('GitHub API error: 500');
    });

    it('throws on invalid repo format', async () => {
        await expect(getLatestRelease('not-a-valid-repo')).rejects.toThrow(
            'Invalid repository format',
        );
        expect(mockFetch).not.toHaveBeenCalled();
    });
});
