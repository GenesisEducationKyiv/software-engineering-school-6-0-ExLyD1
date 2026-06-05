import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { runScanCycle } from '../scanner.service.ts';
import { GitHubApiError } from '../../shared/github/github.errors.ts';
import type { DbPool } from '../../shared/db/db.types.ts';
import type { GitHubClient, GitHubRelease } from '../../shared/github/github.types.ts';
import type { WatchedRepo } from '../scanner.types.ts';

vi.mock('../scanner.repository.ts', () => ({
    getWatchedRepos: vi.fn(),
    updateLastSeenTag: vi.fn().mockResolvedValue(undefined),
}));

import { getWatchedRepos, updateLastSeenTag } from '../scanner.repository.ts';

const mockGetWatchedRepos = vi.mocked(getWatchedRepos);
const mockUpdateLastSeenTag = vi.mocked(updateLastSeenTag);

function buildDeps(watchedRepos: WatchedRepo[] = []) {
    mockGetWatchedRepos.mockResolvedValue(watchedRepos);

    const github: GitHubClient = { getLatestRelease: vi.fn() };
    const onRelease = vi.fn().mockResolvedValue(undefined);
    const log = { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
    const db = {} as DbPool;

    return { github, onRelease, log, db };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('runScanCycle', () => {
    it('does nothing when there are no watched repos', async () => {
        const { github, onRelease, log, db } = buildDeps([]);

        await runScanCycle(db, github, log, onRelease);

        expect(github.getLatestRelease).not.toHaveBeenCalled();
        expect(onRelease).not.toHaveBeenCalled();
    });

    it('does NOT dispatch when tag is unchanged', async () => {
        const repo: WatchedRepo = { id: 1, owner_repo: 'org/repo', last_seen_tag: 'v1.0.0' };
        const { github, onRelease, log, db } = buildDeps([repo]);

        vi.mocked(github.getLatestRelease).mockResolvedValue({
            tag_name: 'v1.0.0',
        } as GitHubRelease);

        await runScanCycle(db, github, log, onRelease);

        expect(github.getLatestRelease).toHaveBeenCalledWith('org/repo');
        expect(onRelease).not.toHaveBeenCalled();
        expect(mockUpdateLastSeenTag).not.toHaveBeenCalled();
    });

    it('calls onRelease with repo id, name and new tag when a new release is detected', async () => {
        const repo: WatchedRepo = { id: 7, owner_repo: 'org/repo', last_seen_tag: 'v1.0.0' };
        const { github, onRelease, log, db } = buildDeps([repo]);

        vi.mocked(github.getLatestRelease).mockResolvedValue({
            tag_name: 'v2.0.0',
        } as GitHubRelease);

        await runScanCycle(db, github, log, onRelease);

        expect(onRelease).toHaveBeenCalledOnce();
        expect(onRelease).toHaveBeenCalledWith(7, 'org/repo', 'v2.0.0');
    });

    it('updates last_seen_tag when a new release is detected', async () => {
        const repo: WatchedRepo = { id: 7, owner_repo: 'org/repo', last_seen_tag: 'v1.0.0' };
        const { github, onRelease, log, db } = buildDeps([repo]);

        vi.mocked(github.getLatestRelease).mockResolvedValue({
            tag_name: 'v2.0.0',
        } as GitHubRelease);

        await runScanCycle(db, github, log, onRelease);

        expect(mockUpdateLastSeenTag).toHaveBeenCalledWith(db, 7, 'v2.0.0');
    });

    it('updates last_seen_tag before dispatching the release', async () => {
        const repo: WatchedRepo = { id: 1, owner_repo: 'org/repo', last_seen_tag: 'v1.0.0' };
        const { github, onRelease, log, db } = buildDeps([repo]);

        vi.mocked(github.getLatestRelease).mockResolvedValue({
            tag_name: 'v2.0.0',
        } as GitHubRelease);

        const callOrder: string[] = [];
        mockUpdateLastSeenTag.mockImplementation(async () => {
            callOrder.push('update');
        });
        onRelease.mockImplementation(async () => {
            callOrder.push('release');
        });

        await runScanCycle(db, github, log, onRelease);

        expect(callOrder).toEqual(['update', 'release']);
    });

    it('aborts scan cycle when any repo in a batch hits the rate limit', async () => {
        const repos: WatchedRepo[] = [
            { id: 1, owner_repo: 'rate-limited/repo', last_seen_tag: 'v1.0.0' },
            { id: 2, owner_repo: 'org/other-repo', last_seen_tag: 'v2.0.0' },
        ];
        const { github, onRelease, log, db } = buildDeps(repos);

        vi.mocked(github.getLatestRelease)
            .mockRejectedValueOnce(new GitHubApiError(429))
            .mockResolvedValueOnce({ tag_name: 'v3.0.0' } as GitHubRelease);

        await runScanCycle(db, github, log, onRelease);

        expect(github.getLatestRelease).toHaveBeenCalledTimes(2);
        expect(onRelease).not.toHaveBeenCalled();
        expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({ repository: 'rate-limited/repo' }),
            expect.stringContaining('aborting scan cycle'),
        );
    });
});
