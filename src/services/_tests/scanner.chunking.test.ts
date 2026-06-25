import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { fetchRepoUpdates } from '../scanner.ts';
import type { WatchedRepo, GitHubClient } from '../../types/index.ts';
import { GitHubApiError } from '../../errors/index.ts';
import { SCAN_CHUNK_SIZE } from '../../constants/index.ts';

function makeRepo(id: number): WatchedRepo {
    return { id, owner_repo: `org/repo-${id}`, last_seen_tag: 'v1.0.0' };
}

function makeGithub(tag = 'v2.0.0'): GitHubClient {
    return {
        getLatestRelease: vi.fn().mockResolvedValue({ tag_name: tag, name: `Release ${tag}` }),
    };
}

const silentLog = { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;

beforeEach(() => {
    vi.clearAllMocks();
});

describe('fetchRepoUpdates chunking', () => {
    it(`${SCAN_CHUNK_SIZE} repos are all processed in one batch`, async () => {
        const repos = Array.from({ length: SCAN_CHUNK_SIZE }, (_, i) => makeRepo(i + 1));
        const github = makeGithub();
        const result = await fetchRepoUpdates(repos, github, silentLog);
        expect(result).not.toBe('rate_limited');
        expect(Array.isArray(result)).toBe(true);
        expect((result as unknown[]).length).toBe(SCAN_CHUNK_SIZE);
        expect(github.getLatestRelease).toHaveBeenCalledTimes(SCAN_CHUNK_SIZE);
    });

    it(`${SCAN_CHUNK_SIZE + 1} repos are processed in two batches`, async () => {
        const repos = Array.from({ length: SCAN_CHUNK_SIZE + 1 }, (_, i) => makeRepo(i + 1));
        const github = makeGithub();
        const result = await fetchRepoUpdates(repos, github, silentLog);
        expect(result).not.toBe('rate_limited');
        expect((result as unknown[]).length).toBe(SCAN_CHUNK_SIZE + 1);
        expect(github.getLatestRelease).toHaveBeenCalledTimes(SCAN_CHUNK_SIZE + 1);
    });

    it('returns rate_limited when rate limit hit in second batch', async () => {
        const repos = Array.from({ length: SCAN_CHUNK_SIZE + 1 }, (_, i) => makeRepo(i + 1));
        const github: GitHubClient = {
            getLatestRelease: vi
                .fn()
                .mockResolvedValueOnce({ tag_name: 'v2.0.0', name: 'v2' })
                .mockResolvedValueOnce({ tag_name: 'v2.0.0', name: 'v2' })
                .mockResolvedValueOnce({ tag_name: 'v2.0.0', name: 'v2' })
                .mockResolvedValueOnce({ tag_name: 'v2.0.0', name: 'v2' })
                .mockResolvedValueOnce({ tag_name: 'v2.0.0', name: 'v2' })
                .mockResolvedValueOnce({ tag_name: 'v2.0.0', name: 'v2' })
                .mockResolvedValueOnce({ tag_name: 'v2.0.0', name: 'v2' })
                .mockResolvedValueOnce({ tag_name: 'v2.0.0', name: 'v2' })
                .mockResolvedValueOnce({ tag_name: 'v2.0.0', name: 'v2' })
                .mockResolvedValueOnce({ tag_name: 'v2.0.0', name: 'v2' })
                .mockRejectedValue(new GitHubApiError(429)),
        };
        const result = await fetchRepoUpdates(repos, github, silentLog);
        expect(result).toBe('rate_limited');
    });

    it('returns rate_limited immediately when rate limit hit in first batch', async () => {
        const repos = [makeRepo(1)];
        const github: GitHubClient = {
            getLatestRelease: vi.fn().mockRejectedValue(new GitHubApiError(429)),
        };
        const result = await fetchRepoUpdates(repos, github, silentLog);
        expect(result).toBe('rate_limited');
    });
});
